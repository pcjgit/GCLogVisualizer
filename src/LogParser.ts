export interface LogData {
  rawTime: string;
  timeValue: string | number;
  timeLabel: string;
  beforeGC?: number;
  afterGC?: number;
  reachingSafepointTime?: number; // time in ms
}

export function parseLogFile(fileContent: string): LogData[] {
  const lines = fileContent.split('\n');
  const data: LogData[] = [];

  // Shenandoah format: 738M->674M(5928M)  
  const shenandoahRegex = /(\d+(?:\.\d+)?)([KMGkmg]?)->(\d+(?:\.\d+)?)([KMGkmg]?)\((\d+(?:\.\d+)?)([KMGkmg]?)\)/;
  
  // ZGC format: 2936M(18%)->2910M(18%)
  const zgcRegex = /(\d+(?:\.\d+)?)([KMGkmg]?)\(\d*%\)->(\d+(?:\.\d+)?)([KMGkmg]?)\(\d*%\)/;
  
  // Safepoint format: Reaching safepoint: 222321200 ns
  const safepointRegex = /Reaching safepoint: (\d+) ns/;

  // Optimization: Use standard for-loop and early string filtering
  // to avoid running regexes on every log line, reducing parsing time.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let beforeVal: number | undefined, beforeUnit: string | undefined, afterVal: number | undefined, afterUnit: string | undefined;
    let reachingSafepointNs: number | undefined;
    
    const isGC = line.includes('->');
    const isSafepoint = !isGC && line.includes('Reaching safepoint:');
    
    if (!isGC && !isSafepoint) {
      continue;
    }

    const firstBracketIndex = line.indexOf('[');
    const closingBracketIndex = line.indexOf(']', firstBracketIndex);
    if (firstBracketIndex === -1 || closingBracketIndex === -1) {
      continue;
    }

    if (isGC) {
      const shenMatch = line.match(shenandoahRegex);
      if (shenMatch) {
        beforeVal = parseFloat(shenMatch[1]);
        beforeUnit = shenMatch[2].toUpperCase();
        afterVal = parseFloat(shenMatch[3]);
        afterUnit = shenMatch[4].toUpperCase();
      } else {
        const zgcMatch = line.match(zgcRegex);
        if (zgcMatch) {
          beforeVal = parseFloat(zgcMatch[1]);
          beforeUnit = zgcMatch[2].toUpperCase();
          afterVal = parseFloat(zgcMatch[3]);
          afterUnit = zgcMatch[4].toUpperCase();
        } else {
          continue;
        }
      }
    } else {
      const spMatch = line.match(safepointRegex);
      if (spMatch) {
        reachingSafepointNs = parseFloat(spMatch[1]);
      } else {
        continue;
      }
    }

    const timeStr = line.substring(firstBracketIndex + 1, closingBracketIndex);
    let timeValue: string | number = timeStr;
    let timeLabel = timeStr;

    // Check if relative time like "10.23s"
    if (timeValue.endsWith('s') && !isNaN(parseFloat(timeValue))) {
       timeValue = parseFloat(timeValue);
       timeLabel = `${timeValue}s`;
    } else {
       // Try parsing as date
       const d = new Date(timeValue);
       if (!isNaN(d.getTime())) {
          timeValue = d.getTime();
          timeLabel = d.toLocaleTimeString(); // More readable for charts
       }
    }

    // Normalize to Megabytes
    const normalize = (val: number | undefined, unit: string | undefined) => {
      if (val === undefined || unit === undefined) return undefined;
      if (unit === 'K') return val / 1024;
      if (unit === 'G') return val * 1024;
      return val; // Assume M by default or no unit
    };

    const beforeMB = normalize(beforeVal, beforeUnit);
    const afterMB = normalize(afterVal, afterUnit);

    const logEntry: LogData = {
      rawTime: timeStr,
      timeValue,
      timeLabel,
    };

    if (beforeMB !== undefined && afterMB !== undefined) {
      logEntry.beforeGC = parseFloat(beforeMB.toFixed(2));
      logEntry.afterGC = parseFloat(afterMB.toFixed(2));
    }

    if (reachingSafepointNs !== undefined) {
      // Convert nanoseconds to milliseconds
      logEntry.reachingSafepointTime = parseFloat((reachingSafepointNs / 1_000_000).toFixed(4));
    }

    data.push(logEntry);
  }

  return data;
}
