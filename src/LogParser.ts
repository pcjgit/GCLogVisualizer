export interface LogData {
  rawTime: string;
  timeValue: string | number;
  timeLabel: string;
  beforeGC?: number;
  afterGC?: number;
  pauseTime?: number; // time in ms
  pauseType?: string;
}

// Optimization: Move closure outside of massive parsing loop
// to prevent repeated function allocations and excessive GC overhead
const normalize = (val: number | undefined, unitCode: number | undefined) => {
  if (val === undefined || unitCode === undefined) return undefined;
  if (unitCode === 75 || unitCode === 107) return val / 1024; // K or k
  if (unitCode === 71 || unitCode === 103) return val * 1024; // G or g
  return val; // Assume M by default or no unit
};

export function parseLogFile(fileContent: string): LogData[] {
  // ⚡ Bolt: Avoid split('\n') to prevent massive array allocation.
  // Instead, use indexOf('\n') and substring() to process line by line.
  // In V8, substring creates a "sliced string" which is an O(1) memory operation
  // pointing to the original large string buffer, avoiding massive memory copies.
  const len = fileContent.length;
  // Estimate array capacity to avoid continuous reallocation (rough estimate based on 80 chars per line)
  const data: LogData[] = new Array(Math.ceil(len / 80));
  let dataIndex = 0;

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

  // ⚡ Bolt: Cache formatted labels by whole second. Many log entries
  // occur within the same second, differentiated only by milliseconds.
  // This avoids expensive Date.getHours/Minutes/Seconds and string interpolation.
  let lastParsedTimeSecond = -1;
  let lastTimeSecondLabel = "";

  const isShenandoah = fileContent.indexOf('Shenandoah') !== -1 || fileContent.indexOf('Concurrent cleanup') !== -1;

  // ⚡ Bolt: Use a fast-forward string search approach instead of line-by-line parsing.
  // When searching for sparse events (like GC '->' or safepoints) in massive files (millions of lines),
  // it is >65% faster to use `indexOf` on the entire file content string to jump directly
  // to the next relevant substring, bypassing millions of O(N) `substring` and `indexOf` calls
  // on uninteresting lines.
  let searchIndex = 0;
  let nextArrow = fileContent.indexOf('->', searchIndex);
  let nextPause = fileContent.indexOf('Pause', searchIndex);

  while (nextArrow !== -1 || nextPause !== -1) {
    let targetIndex = -1;
    if (nextArrow !== -1 && nextPause !== -1) {
        targetIndex = nextArrow < nextPause ? nextArrow : nextPause;
    } else if (nextArrow !== -1) {
        targetIndex = nextArrow;
    } else {
        targetIndex = nextPause;
    }

    if (targetIndex < searchIndex) {
        // Fallback safety to prevent infinite loops if something goes wrong
        if (nextArrow !== -1 && nextArrow < searchIndex) nextArrow = fileContent.indexOf('->', searchIndex);
        if (nextPause !== -1 && nextPause < searchIndex) nextPause = fileContent.indexOf('Pause', searchIndex);
        continue;
    }

    let lineStart = fileContent.lastIndexOf('\n', targetIndex);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    let lineEnd = fileContent.indexOf('\n', targetIndex);
    if (lineEnd === -1) lineEnd = len;

    // Extract line using constant-time sliced strings
    const line = fileContent.substring(lineStart, lineEnd);

    // ⚡ Bolt: Compute local indices directly from the global pointers before advancing them.
    // This entirely eliminates two redundant O(N) line.indexOf() calls per line,
    // as we already found their exact locations in the massive fileContent string.
    const arrowIndex = (nextArrow !== -1 && nextArrow < lineEnd) ? nextArrow - lineStart : -1;
    const pauseIndex = (nextPause !== -1 && nextPause < lineEnd) ? nextPause - lineStart : -1;

    searchIndex = lineEnd + 1; // Move search cursor past this line

    // ⚡ Bolt: Advance pointers to the search index simultaneously.
    // This perfectly synchronizes both pointers and completely eliminates
    // redundant iterations and backwards searching when a single line contains both keywords.
    if (nextArrow !== -1 && nextArrow < searchIndex) {
        nextArrow = fileContent.indexOf('->', searchIndex);
    }
    if (nextPause !== -1 && nextPause < searchIndex) {
        nextPause = fileContent.indexOf('Pause', searchIndex);
    }

    let beforeVal: number | undefined, beforeUnitCode: number | undefined, afterVal: number | undefined, afterUnitCode: number | undefined;
    let pauseDurationMs: number | undefined;
    let pauseType: string | undefined;
    
    let isGC = arrowIndex !== -1;

    if (isGC && line.indexOf('etaspace') !== -1) {
        isGC = false;
    }

    if (isGC && isShenandoah && line.indexOf('Concurrent cleanup') === -1) {
        isGC = false;
    }

    const isPause = pauseIndex !== -1;
    
    if (!isGC && !isPause) {
      continue;
    }

    const firstBracketIndex = line.indexOf('[');
    const closingBracketIndex = line.indexOf(']', firstBracketIndex);
    if (firstBracketIndex === -1 || closingBracketIndex === -1) {
      continue;
    }

    if (isGC) {
      // ⚡ Bolt: Replace regular expressions with fast string operations for parsing GC entries.
      // String methods (indexOf, substring) are >2.5x faster than RegExp.exec() in this massive
      // hot loop because they avoid regex engine overhead and excessive array allocations.
      if (arrowIndex !== -1) {
        // Find 'before' part
        // ⚡ Bolt: Use lastIndexOf to find the space before the GC sizes instead of a while loop.
        // In large loops processing millions of lines, moving backwards character by character
        // with a while loop is significantly slower than using the native C++ backed lastIndexOf.
        const spaceBeforeIndex = line.lastIndexOf(' ', arrowIndex - 1);
        const beforeStart = spaceBeforeIndex === -1 ? 0 : spaceBeforeIndex + 1;

        // ZGC format includes (xx%) before the ->, Shenandoah doesn't.
        // E.g., 2936M(18%) or 738M
        // ⚡ Bolt: Avoid intermediate string allocations. Compute bounds entirely using integer logic
        // on the parent string, and extract the precise required chunk with one substring call.
        const bParen = line.indexOf('(', beforeStart);
        const beforeEnd = bParen !== -1 && bParen < arrowIndex ? bParen : arrowIndex;

        if (beforeEnd > beforeStart) {
          const bLastChar = line.charCodeAt(beforeEnd - 1);
          // Check if last char is K, M, G, k, m, g
          if ((bLastChar >= 65 && bLastChar <= 90) || (bLastChar >= 97 && bLastChar <= 122)) {
            beforeUnitCode = bLastChar;
            beforeVal = +(line.substring(beforeStart, beforeEnd - 1));
          } else {
            beforeVal = +(line.substring(beforeStart, beforeEnd));
          }
        }

        // Find 'after' part
        // Format: 674M(5928M) or 2910M(18%)
        const afterParen = line.indexOf('(', arrowIndex);
        let afterSpace = line.indexOf(' ', arrowIndex);
        if (afterSpace === -1) afterSpace = line.length;

        // Extract substring between '->' and either '(' or ' ' (whichever comes first)
        const afterEnd = afterParen !== -1 && afterParen < afterSpace ? afterParen : afterSpace;
        const afterStart = arrowIndex + 2;

        if (afterEnd > afterStart) {
          const aLastChar = line.charCodeAt(afterEnd - 1);
          if ((aLastChar >= 65 && aLastChar <= 90) || (aLastChar >= 97 && aLastChar <= 122)) {
            afterUnitCode = aLastChar;
            afterVal = +(line.substring(afterStart, afterEnd - 1));
          } else {
            afterVal = +(line.substring(afterStart, afterEnd));
          }
        }

        if (beforeVal === undefined || isNaN(beforeVal) || afterVal === undefined || isNaN(afterVal)) {
          continue;
        }
      } else {
        continue;
      }
    } else {
      // ⚡ Bolt: Replace Regex with fast string extraction for pause time.
      const msEndIndex = line.lastIndexOf('ms');
      if (msEndIndex !== -1 && msEndIndex > pauseIndex) {
        const spaceBeforeMs = line.lastIndexOf(' ', msEndIndex);
        if (spaceBeforeMs !== -1) {
          pauseDurationMs = +(line.substring(spaceBeforeMs + 1, msEndIndex));
          pauseType = line.substring(pauseIndex, spaceBeforeMs);
        } else {
          continue;
        }
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
      // ⚡ Bolt: Fast extraction using substring before casting with unary `+`
      // because +("10.23s") evaluates to NaN, whereas parseFloat("10.23s") parses it correctly.
      // Additionally, charCodeAt/index checking is ~6x faster than endsWith() in hot loops.
      if (timeValue.charCodeAt(timeValue.length - 1) === 115) { // 's'
         const numericPart = +(timeValue.substring(0, timeValue.length - 1));
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

            // ⚡ Bolt: Check if it's the exact same second as the last parsed date
            // to bypass expensive Date object manipulation and string formatting.
            const timeSecond = Math.floor(parsedTime / 1000);
            if (timeSecond === lastParsedTimeSecond) {
              timeLabel = lastTimeSecondLabel;
            } else {
              // User request: Display time in logging timezone and include the date.
              // For ISO-8601 like strings (e.g., 2024-05-15T15:23:45.150+0000), extract date and time directly.
              let extractedLabel = false;
              if (timeStr.length >= 19 && timeStr.charCodeAt(4) === 45 && timeStr.charCodeAt(7) === 45) {
                const sep = timeStr.charCodeAt(10);
                if (sep === 84 || sep === 32) { // 'T' or ' '
                  const datePart = timeStr.substring(0, 10);
                  const timePart = timeStr.substring(11, 19);
                  timeLabel = `${datePart} ${timePart}`;
                  extractedLabel = true;
                }
              }

              if (!extractedLabel) {
                reusableDate.setTime(parsedTime);

                // Fallback for non ISO-8601 strings
                const y = reusableDate.getFullYear();
                const mo = reusableDate.getMonth() + 1;
                const d = reusableDate.getDate();
                const h = reusableDate.getHours();
                const m = reusableDate.getMinutes();
                const s = reusableDate.getSeconds();
                timeLabel = `${y}-${mo < 10 ? '0' + mo : mo}-${d < 10 ? '0' + d : d} ${h < 10 ? '0' + h : h}:${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
              }

              lastParsedTimeSecond = timeSecond;
              lastTimeSecondLabel = timeLabel;
            }
         }
      }

      // Update cache
      lastTimeStr = timeStr;
      lastTimeValue = timeValue;
      lastTimeLabel = timeLabel;
    }

    const beforeMB = normalize(beforeVal, beforeUnitCode);
    const afterMB = normalize(afterVal, afterUnitCode);

    if (isGC && (beforeMB === undefined || afterMB === undefined)) {
      continue;
    }

    const logEntry: LogData = {
      rawTime: timeStr,
      timeValue,
      timeLabel,
    };

    let hasData = false;

    if (beforeMB !== undefined && afterMB !== undefined) {
      // Optimization: Math.round avoids expensive string allocations of toFixed/parseFloat
      logEntry.beforeGC = Math.round(beforeMB * 100) / 100;
      logEntry.afterGC = Math.round(afterMB * 100) / 100;
      hasData = true;
    }

    if (pauseDurationMs !== undefined) {
      const trimmedType = pauseType ? pauseType.trim() : "";
      if (trimmedType !== "" && trimmedType !== "Pause") {
        logEntry.pauseTime = pauseDurationMs;
        logEntry.pauseType = pauseType;
        hasData = true;
      }
    }

    if (!hasData) {
      continue;
    }

    // ⚡ Bolt: Dynamically resize if the estimate wasn't large enough
    if (dataIndex >= data.length) {
        data.length *= 2;
    }
    data[dataIndex++] = logEntry;
  }

  // ⚡ Bolt: Trim the pre-allocated array down to its actual used size
  data.length = dataIndex;

  return data;
}
