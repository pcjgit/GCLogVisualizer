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

  // Matches first bracket group, e.g. [2026-04-15T10:27:57.630+0000] or [1.234s]
  const timeRegex = /^\[([^\]]+)\]/;

  lines.forEach((line) => {
    let beforeVal: number | undefined, beforeUnit: string | undefined, afterVal: number | undefined, afterUnit: string | undefined;
    let reachingSafepointNs: number | undefined;
    
    const shenMatch = line.match(shenandoahRegex);
    const zgcMatch = line.match(zgcRegex);
    const spMatch = line.match(safepointRegex);
    
    if (shenMatch) {
      beforeVal = parseFloat(shenMatch[1]);
      beforeUnit = shenMatch[2].toUpperCase();
      afterVal = parseFloat(shenMatch[3]);
      afterUnit = shenMatch[4].toUpperCase();
    } else if (zgcMatch) {
      beforeVal = parseFloat(zgcMatch[1]);
      beforeUnit = zgcMatch[2].toUpperCase();
      afterVal = parseFloat(zgcMatch[3]);
      afterUnit = zgcMatch[4].toUpperCase();
    } else if (spMatch) {
      reachingSafepointNs = parseFloat(spMatch[1]);
    } else {
      return; 
    }

    const timeMatch = line.match(timeRegex);
    if (!timeMatch) return;

    let timeValue: string | number = timeMatch[1];
    let timeLabel = timeValue;
    // Check if relative time like "10.23s"
    if (typeof timeValue === 'string' && timeValue.endsWith('s') && !isNaN(parseFloat(timeValue))) {
       timeValue = parseFloat(timeValue);
       timeLabel = `${timeValue}s`;
    } else {
       // Try parsing as date
       const d = new Date(timeValue as string);
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
      rawTime: timeMatch[1],
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
  });

  return data;
}
