export interface LogData {
  rawTime: string;
  timeValue: string | number;
  timeLabel: string;
  beforeGC?: number;
  afterGC?: number;
  reachingSafepointTime?: number; // time in ms
}

// Optimization: Move closure outside of massive parsing loop
// to prevent repeated function allocations and excessive GC overhead
const normalize = (val: number | undefined, unit: string | undefined) => {
  if (val === undefined || unit === undefined) return undefined;
  if (unit === 'K' || unit === 'k') return val / 1024;
  if (unit === 'G' || unit === 'g') return val * 1024;
  return val; // Assume M by default or no unit
};

export function parseLogFile(fileContent: string): LogData[] {
  const lines = fileContent.split('\n');

  // ⚡ Bolt: Pre-allocate the data array to the maximum possible size (lines.length)
  // and assign by index instead of using Array.prototype.push().
  // This prevents V8 from constantly reallocating the underlying array memory
  // as it grows to hundreds of thousands of items, reducing parse time significantly.
  const data: LogData[] = new Array(lines.length);
  let dataIndex = 0;

  // Shenandoah format: 738M->674M(5928M)  
  const shenandoahRegex = /(\d+(?:\.\d+)?)([KMGkmg]?)->(\d+(?:\.\d+)?)([KMGkmg]?)\((\d+(?:\.\d+)?)([KMGkmg]?)\)/;
  
  // ZGC format: 2936M(18%)->2910M(18%)
  const zgcRegex = /(\d+(?:\.\d+)?)([KMGkmg]?)\(\d*%\)->(\d+(?:\.\d+)?)([KMGkmg]?)\(\d*%\)/;

  // Optimization: Reuse a single Date object across the massive parsing loop
  // to prevent allocating hundreds of thousands of Date instances, which
  // causes significant garbage collection overhead and blocks the main thread.
  const reusableDate = new Date();

  // Optimization: Cache the last parsed timestamp
  // GC logs often contain many consecutive lines with the exact same timestamp.
  // Caching the last parsed time avoids expensive Date.parse() and string formatting calls.
  let lastTimeStr = "";
  let lastTimeValue: string | number = "";
  let lastTimeLabel = "";

  // Optimization: Use standard for-loop and early string filtering
  // to avoid running regexes on every log line, reducing parsing time.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let beforeVal: number | undefined, beforeUnit: string | undefined, afterVal: number | undefined, afterUnit: string | undefined;
    let reachingSafepointNs: number | undefined;
    
    // ⚡ Bolt: Fast string indexing checks using indexOf before doing regex operations.
    // indexOf is generally significantly faster than includes() and regex matching
    // inside hot loops processing massive inputs like JVM logs.
    const isGC = line.indexOf('->') !== -1;
    const safepointIndex = isGC ? -1 : line.indexOf('Reaching safepoint: ');
    const isSafepoint = safepointIndex !== -1;
    
    if (!isGC && !isSafepoint) {
      continue;
    }

    const firstBracketIndex = line.indexOf('[');
    const closingBracketIndex = line.indexOf(']', firstBracketIndex);
    if (firstBracketIndex === -1 || closingBracketIndex === -1) {
      continue;
    }

    if (isGC) {
      // ⚡ Bolt: Use Regex.exec() instead of String.match() in tight loops
      // since exec() is faster and doesn't create as much intermediate array allocations.
      // ⚡ Bolt: Use unary `+` operator instead of parseFloat(), and avoid `.toUpperCase()`
      // to reduce CPU instructions and object allocations in a loop of 100k+ iterations.
      const shenMatch = shenandoahRegex.exec(line);
      if (shenMatch) {
        beforeVal = +(shenMatch[1]);
        beforeUnit = shenMatch[2];
        afterVal = +(shenMatch[3]);
        afterUnit = shenMatch[4];
      } else {
        const zgcMatch = zgcRegex.exec(line);
        if (zgcMatch) {
          beforeVal = +(zgcMatch[1]);
          beforeUnit = zgcMatch[2];
          afterVal = +(zgcMatch[3]);
          afterUnit = zgcMatch[4];
        } else {
          continue;
        }
      }
    } else {
      // ⚡ Bolt: Replace Regex with fast string extraction for safepoint time.
      // Reaching safepoint: \d+ ns
      const nsStartIndex = safepointIndex + 20; // 'Reaching safepoint: '.length = 20
      const nsEndIndex = line.indexOf(' ns', nsStartIndex);
      if (nsEndIndex !== -1) {
        reachingSafepointNs = +(line.substring(nsStartIndex, nsEndIndex));
      } else {
        continue;
      }
    }

    const timeStr = line.substring(firstBracketIndex + 1, closingBracketIndex);
    let timeValue: string | number = timeStr;
    let timeLabel = timeStr;

    if (timeStr === lastTimeStr) {
      timeValue = lastTimeValue;
      timeLabel = lastTimeLabel;
    } else if (typeof timeValue === 'string') {
      // Check if relative time like "10.23s"
      // ⚡ Bolt: Fast extraction using slice before casting with unary `+`
      // because +("10.23s") evaluates to NaN, whereas parseFloat("10.23s") parses it correctly.
      if (timeValue.endsWith('s')) {
         const numericPart = +(timeValue.slice(0, -1));
         if (!isNaN(numericPart)) {
           timeValue = numericPart;
           timeLabel = `${timeValue}s`;
         }
      }
      // If it wasn't a valid 's' format or parsing failed, try Date parsing.
      if (typeof timeValue === 'string') {
         // Try parsing as date
         // Optimization: Use Date.parse to avoid allocating Invalid Date objects for non-date strings
         const parsedTime = Date.parse(timeValue);
         if (!isNaN(parsedTime)) {
            timeValue = parsedTime;
            reusableDate.setTime(parsedTime);

            // Optimization: Avoid slow toLocaleTimeString in massive loop
            const h = reusableDate.getHours();
            const m = reusableDate.getMinutes();
            const s = reusableDate.getSeconds();
            timeLabel = `${h < 10 ? '0' + h : h}:${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
         }
      }

      // Update cache
      lastTimeStr = timeStr;
      lastTimeValue = timeValue;
      lastTimeLabel = timeLabel;
    }

    const beforeMB = normalize(beforeVal, beforeUnit);
    const afterMB = normalize(afterVal, afterUnit);

    const logEntry: LogData = {
      rawTime: timeStr,
      timeValue,
      timeLabel,
    };

    if (beforeMB !== undefined && afterMB !== undefined) {
      // Optimization: Math.round avoids expensive string allocations of toFixed/parseFloat
      logEntry.beforeGC = Math.round(beforeMB * 100) / 100;
      logEntry.afterGC = Math.round(afterMB * 100) / 100;
    }

    if (reachingSafepointNs !== undefined) {
      // Convert nanoseconds to milliseconds
      logEntry.reachingSafepointTime = Math.round(reachingSafepointNs / 100) / 10000;
    }

    data[dataIndex++] = logEntry;
  }

  // ⚡ Bolt: Trim the pre-allocated array down to its actual used size
  data.length = dataIndex;

  return data;
}
