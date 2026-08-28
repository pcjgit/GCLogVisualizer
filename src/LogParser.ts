export interface LogData {
  timeValue: string | number;
  timeLabel: string;
  beforeGC?: number;
  afterGC?: number;
  pauseTime?: number; // time in ms
  pauseType?: string;
}

export type FullGCTime = { date: string, time: string, tz: string } | string | null;

export interface GCStats {
  maxMemoryBefore: number;
  maxMemoryAfter: number;
  avgRecovered: string | number;
  totalParsed: number;
}

export interface ParseResult {
  gcData: LogData[];
  pauseData: LogData[];
  stats: GCStats;
  fullGCTime: FullGCTime;
}

// Optimization: Move closure outside of massive parsing loop
// to prevent repeated function allocations and excessive GC overhead
const normalize = (val: number | undefined, unitCode: number | undefined) => {
  if (val === undefined || unitCode === undefined) return undefined;
  if (unitCode === 75 || unitCode === 107) return val / 1024; // K or k
  if (unitCode === 71 || unitCode === 103) return val * 1024; // G or g
  return val; // Assume M by default or no unit
};

// ⚡ Bolt: Fast-path for ISO-8601 like: 2024-05-15T15:23:45.150+0000, +00:00, or Z
// Avoids expensive Date.parse() for standard JVM log ISO-8601 formats.
// Accepts (str, start, end) to bypass intermediate substring allocations.
const parseISO8601FastPath = (str: string, start: number, end: number): number => {
  const length = end - start;
  if (length >= 19 && str.charCodeAt(start + 4) === 45 && str.charCodeAt(start + 7) === 45) {
    const sep = str.charCodeAt(start + 10);
    if (sep === 84 || sep === 32) { // 'T' or ' '
      const year = (str.charCodeAt(start + 0) - 48) * 1000 +
                   (str.charCodeAt(start + 1) - 48) * 100 +
                   (str.charCodeAt(start + 2) - 48) * 10 +
                   (str.charCodeAt(start + 3) - 48);
      const month = (str.charCodeAt(start + 5) - 48) * 10 +
                    (str.charCodeAt(start + 6) - 48) - 1;
      const day = (str.charCodeAt(start + 8) - 48) * 10 +
                  (str.charCodeAt(start + 9) - 48);
      const hour = (str.charCodeAt(start + 11) - 48) * 10 +
                   (str.charCodeAt(start + 12) - 48);
      const minute = (str.charCodeAt(start + 14) - 48) * 10 +
                     (str.charCodeAt(start + 15) - 48);
      const second = (str.charCodeAt(start + 17) - 48) * 10 +
                     (str.charCodeAt(start + 18) - 48);

      let ms = 0;
      let i = 19;

      if (length >= 23 && str.charCodeAt(start + 19) === 46) { // '.'
         ms = (str.charCodeAt(start + 20) - 48) * 100 +
              (str.charCodeAt(start + 21) - 48) * 10 +
              (str.charCodeAt(start + 22) - 48);
         i = 23;
      }

      if (i >= length) {
        return Date.UTC(year, month, day, hour, minute, second, ms);
      }

      const tzSign = str.charCodeAt(start + i);
      if (tzSign === 90) { // 'Z'
        return Date.UTC(year, month, day, hour, minute, second, ms);
      }

      if (tzSign === 43 || tzSign === 45) { // '+' or '-'
         let tzHour = 0;
         let tzMin = 0;
         if (length >= i + 6 && str.charCodeAt(start + i + 3) === 58) { // +HH:MM / -HH:MM
             const h1 = str.charCodeAt(start + i + 1);
             const h2 = str.charCodeAt(start + i + 2);
             const m1 = str.charCodeAt(start + i + 4);
             const m2 = str.charCodeAt(start + i + 5);
             if (h1 >= 48 && h1 <= 57 && h2 >= 48 && h2 <= 57 && m1 >= 48 && m1 <= 57 && m2 >= 48 && m2 <= 57) {
               tzHour = (h1 - 48) * 10 + (h2 - 48);
               tzMin = (m1 - 48) * 10 + (m2 - 48);
             } else {
               return NaN;
             }
         } else if (length >= i + 5 && str.charCodeAt(start + i + 3) !== 58) { // +HHMM / -HHMM
             const h1 = str.charCodeAt(start + i + 1);
             const h2 = str.charCodeAt(start + i + 2);
             const m1 = str.charCodeAt(start + i + 3);
             const m2 = str.charCodeAt(start + i + 4);
             if (h1 >= 48 && h1 <= 57 && h2 >= 48 && h2 <= 57 && m1 >= 48 && m1 <= 57 && m2 >= 48 && m2 <= 57) {
               tzHour = (h1 - 48) * 10 + (h2 - 48);
               tzMin = (m1 - 48) * 10 + (m2 - 48);
             } else {
               return NaN;
             }
         } else {
             return NaN;
         }

         const tzOffsetMs = (tzHour * 60 + tzMin) * 60000;
         let parsedTime = Date.UTC(year, month, day, hour, minute, second, ms);
         if (tzSign === 43) parsedTime -= tzOffsetMs;
         else if (tzSign === 45) parsedTime += tzOffsetMs;
         return parsedTime;
      }
    }
  }
  return NaN;
};

export function parseLogFile(fileContent: string): ParseResult {
  const len = fileContent.length;

  // ⚡ Bolt: Pre-allocate arrays with a more realistic initial capacity based on file size
  // to minimize expensive V8 array reallocations. A typical JVM log line is ~100-200 chars.
  const estimatedEntries = Math.max(1000, Math.floor(len / 200));
  const gcData: LogData[] = new Array(estimatedEntries);
  let gcDataIndex = 0;
  const pauseData: LogData[] = new Array(estimatedEntries);
  let pauseDataIndex = 0;
  let totalParsed = 0;

  let maxMemoryBefore = 0;
  let maxMemoryAfter = 0;
  let totalRecovered = 0;
  let gcCount = 0;

  const reusableDate = new Date();

  let lastTimeStr = "";
  let lastTimeValue: string | number = "";
  let lastTimeLabel = "";

  let lastParsedTimeSecond = -1;
  let lastTimeSecondLabel = "";

  const isShenandoah = fileContent.lastIndexOf('Concurrent cleanup', 5242880) !== -1;

  // ⚡ Bolt: If it's Shenandoah, we only care about memory transitions on "Concurrent cleanup" lines.
  // By searching for the keyword directly instead of generic "->", we skip thousands of irrelevant
  // GC phase lines that don't contribute to memory visualization, significantly speeding up the skip.
  const gcKeyword = isShenandoah ? 'Concurrent cleanup' : '->';

  let searchIndex = 0;
  let nextGC = fileContent.indexOf(gcKeyword, searchIndex);
  let nextPause = fileContent.indexOf('Pause', searchIndex);
  let nextFullGC = fileContent.indexOf('Upgrade To Full GC', searchIndex);
  let fullGCTime: FullGCTime = null;

  while (nextGC !== -1 || nextPause !== -1 || nextFullGC !== -1) {
    let targetIndex = -1;
    if (nextGC !== -1) targetIndex = nextGC;
    if (nextPause !== -1 && (targetIndex === -1 || nextPause < targetIndex)) targetIndex = nextPause;
    if (nextFullGC !== -1 && (targetIndex === -1 || nextFullGC < targetIndex)) targetIndex = nextFullGC;

    if (targetIndex < searchIndex) {
        if (nextGC !== -1 && nextGC < searchIndex) nextGC = fileContent.indexOf(gcKeyword, searchIndex);
        if (nextPause !== -1 && nextPause < searchIndex) nextPause = fileContent.indexOf('Pause', searchIndex);
        if (nextFullGC !== -1 && nextFullGC < searchIndex) nextFullGC = fileContent.indexOf('Upgrade To Full GC', searchIndex);
        continue;
    }

    let lineStart = fileContent.lastIndexOf('\n', targetIndex);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    let lineEnd = fileContent.indexOf('\n', targetIndex);
    if (lineEnd === -1) lineEnd = len;

    const line = fileContent.substring(lineStart, lineEnd);

    const gcKeywordIndex = (nextGC !== -1 && nextGC < lineEnd) ? nextGC - lineStart : -1;
    const pauseIndex = (nextPause !== -1 && nextPause < lineEnd) ? nextPause - lineStart : -1;
    const fullGCIndex = (nextFullGC !== -1 && nextFullGC < lineEnd) ? nextFullGC - lineStart : -1;

    searchIndex = lineEnd + 1;

    if (nextGC !== -1 && nextGC < searchIndex) {
        nextGC = fileContent.indexOf(gcKeyword, searchIndex);
    }
    if (nextPause !== -1 && nextPause < searchIndex) {
        nextPause = fileContent.indexOf('Pause', searchIndex);
    }
    if (nextFullGC !== -1 && nextFullGC < searchIndex) {
        nextFullGC = fileContent.indexOf('Upgrade To Full GC', searchIndex);
    }

    let beforeVal: number | undefined, beforeUnitCode: number | undefined, afterVal: number | undefined, afterUnitCode: number | undefined;
    let pauseDurationMs: number | undefined;
    let pauseType: string | undefined;
    
    if (fullGCIndex !== -1 && fullGCTime === null) {
      const firstBracket = line.indexOf('[');
      const closeBracket = line.indexOf(']', firstBracket);
      if (firstBracket !== -1 && closeBracket !== -1) {
        const timeStr = line.substring(firstBracket + 1, closeBracket);
        const tIndex = timeStr.indexOf('T');
        if (tIndex !== -1) {
          const date = timeStr.substring(0, tIndex);
          let tz = '';
          let time = '';

          // ⚡ Bolt: Replace Regex with fast string extraction for timezone suffix.
          // Avoiding .match() and regex compilation for this simple suffix check
          // provides a significant speedup in parsing time.
          const timeStrLen = timeStr.length;
          const lastChar = timeStr.charCodeAt(timeStrLen - 1);
          let tzLen = 0;

          if (lastChar === 90) { // 'Z'
            tzLen = 1;
          } else if (timeStrLen >= tIndex + 1 + 5) {
            const tzSign = timeStr.charCodeAt(timeStrLen - 5);
            if (tzSign === 43 || tzSign === 45) { // '+' or '-'
              const c1 = timeStr.charCodeAt(timeStrLen - 4);
              const c2 = timeStr.charCodeAt(timeStrLen - 3);
              const c3 = timeStr.charCodeAt(timeStrLen - 2);
              const c4 = lastChar;
              // Ensure strict digit validation
              if (
                c1 >= 48 && c1 <= 57 &&
                c2 >= 48 && c2 <= 57 &&
                c3 >= 48 && c3 <= 57 &&
                c4 >= 48 && c4 <= 57
              ) {
                tzLen = 5;
              }
            }
          }

          if (tzLen > 0) {
            tz = timeStr.substring(timeStrLen - tzLen);
            time = timeStr.substring(tIndex + 1, timeStrLen - tzLen);
          } else {
            time = timeStr.substring(tIndex + 1);
          }

          fullGCTime = { date, time, tz };
        } else {
          fullGCTime = timeStr;
        }
      } else {
          fullGCTime = "Found";
      }
    }

    let isGC = gcKeywordIndex !== -1;

    // Additional filtering for Metaspace lines
    if (isGC && line.indexOf('etaspace') !== -1) {
        isGC = false;
    }

    const isPause = pauseIndex !== -1;
    
    if (!isGC && !isPause) {
      continue;
    }

    const firstBracketIndex = line.charCodeAt(0) === 91 ? 0 : line.indexOf('[');
    const closingBracketIndex = line.indexOf(']', firstBracketIndex);
    if (firstBracketIndex === -1 || closingBracketIndex === -1) {
      continue;
    }

    if (isGC) {
      // ⚡ Bolt: If not Shenandoah, gcKeyword is already '->', so gcKeywordIndex is the arrowIndex
      const arrowIndex = isShenandoah ? line.indexOf('->', gcKeywordIndex) : gcKeywordIndex;
      if (arrowIndex !== -1) {
        const spaceBeforeIndex = line.lastIndexOf(' ', arrowIndex - 1);
        const beforeStart = spaceBeforeIndex === -1 ? 0 : spaceBeforeIndex + 1;

        const bParen = line.indexOf('(', beforeStart);
        const beforeEnd = bParen !== -1 && bParen < arrowIndex ? bParen : arrowIndex;

        if (beforeEnd > beforeStart) {
          const bLastChar = line.charCodeAt(beforeEnd - 1);
          if ((bLastChar >= 65 && bLastChar <= 90) || (bLastChar >= 97 && bLastChar <= 122)) {
            beforeUnitCode = bLastChar;
            beforeVal = +(line.substring(beforeStart, beforeEnd - 1));
          } else {
            beforeVal = +(line.substring(beforeStart, beforeEnd));
          }
        }

        const afterParen = line.indexOf('(', arrowIndex);
        let afterSpace = line.indexOf(' ', arrowIndex);
        if (afterSpace === -1) afterSpace = line.length;

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
          isGC = false;
        }
      } else {
        isGC = false;
      }
    }

    if (isPause) {
      const msEndIndex = line.lastIndexOf('ms');
      if (msEndIndex !== -1 && msEndIndex > pauseIndex) {
        const spaceBeforeMs = line.lastIndexOf(' ', msEndIndex);
        if (spaceBeforeMs !== -1) {
          pauseDurationMs = +(line.substring(spaceBeforeMs + 1, msEndIndex));
          pauseType = line.substring(pauseIndex, spaceBeforeMs);
        } else {
          pauseDurationMs = undefined;
        }
      } else {
        pauseDurationMs = undefined;
      }
    }

    if (!isGC && (pauseDurationMs === undefined)) {
        continue;
    }

    const globalTimeStart = lineStart + firstBracketIndex + 1;
    const globalTimeEnd = lineStart + closingBracketIndex;

    let timeValue: string | number;
    let timeLabel: string;

    if (lastTimeStr && fileContent.startsWith(lastTimeStr, globalTimeStart) && (globalTimeEnd - globalTimeStart) === lastTimeStr.length) {
      timeValue = lastTimeValue;
      timeLabel = lastTimeLabel;
    } else {
      const timeStr = fileContent.substring(globalTimeStart, globalTimeEnd);
      timeValue = timeStr;
      timeLabel = timeStr;

      if (timeValue.charCodeAt(timeValue.length - 1) === 115) { // 's'
         const numericPart = +(timeValue.substring(0, timeValue.length - 1));
         if (!isNaN(numericPart)) {
           timeValue = numericPart;
           timeLabel = timeValue + 's';
         }
      }

      if (typeof timeValue === 'string') {
         let parsedTime = parseISO8601FastPath(fileContent, globalTimeStart, globalTimeEnd);

         if (isNaN(parsedTime)) {
             parsedTime = Date.parse(timeValue);
         }

         if (!isNaN(parsedTime)) {
            timeValue = parsedTime;

            const timeSecond = Math.floor(parsedTime / 1000);
            if (timeSecond === lastParsedTimeSecond) {
              timeLabel = lastTimeSecondLabel;
            } else {
              let extractedLabel = false;
              if (timeStr.length >= 19 && timeStr.charCodeAt(4) === 45 && timeStr.charCodeAt(7) === 45) {
                const sep = timeStr.charCodeAt(10);
                if (sep === 84) { // 'T'
                  // ⚡ Bolt: Direct string concatenation avoids intermediate datePart/timePart allocations
                  timeLabel = timeStr.substring(0, 10) + ' ' + timeStr.substring(11, 19);
                  extractedLabel = true;
                } else if (sep === 32) { // ' '
                  timeLabel = timeStr.substring(0, 19);
                  extractedLabel = true;
                }
              }

              if (!extractedLabel) {
                reusableDate.setTime(parsedTime);

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

      lastTimeStr = timeStr;
      lastTimeValue = timeValue;
      lastTimeLabel = timeLabel;
    }

    const beforeMB = normalize(beforeVal, beforeUnitCode);
    const afterMB = normalize(afterVal, afterUnitCode);

    let hasAnyDataForThisLine = false;

    if (isGC && beforeMB !== undefined && afterMB !== undefined) {
      const bRounded = Math.round(beforeMB * 100) / 100;
      const aRounded = Math.round(afterMB * 100) / 100;

      // ⚡ Bolt: Eliminate object spread and create objects directly.
      // This reduces object allocations and CPU overhead in hot loops.
      const gcEntry: LogData = {
        timeValue,
        timeLabel,
        beforeGC: bRounded,
        afterGC: aRounded
      };

      if (gcDataIndex >= gcData.length) gcData.length *= 2;
      gcData[gcDataIndex++] = gcEntry;

      // Update stats
      if (bRounded > maxMemoryBefore) maxMemoryBefore = bRounded;
      if (aRounded > maxMemoryAfter) maxMemoryAfter = aRounded;
      totalRecovered += (bRounded - aRounded);
      gcCount++;
      hasAnyDataForThisLine = true;
    }

    if (pauseDurationMs !== undefined) {
      const trimmedType = pauseType ? pauseType.trim() : "";
      if (trimmedType !== "" && trimmedType !== "Pause") {
        // ⚡ Bolt: Direct object creation instead of spread operator.
        const pauseEntry: LogData = {
          timeValue,
          timeLabel,
          pauseTime: pauseDurationMs,
          pauseType: trimmedType
        };

        if (pauseDataIndex >= pauseData.length) pauseData.length *= 2;
        pauseData[pauseDataIndex++] = pauseEntry;
        hasAnyDataForThisLine = true;
      }
    }

    if (hasAnyDataForThisLine) {
        totalParsed++;
    }
  }

  gcData.length = gcDataIndex;
  pauseData.length = pauseDataIndex;

  const stats: GCStats = {
      maxMemoryBefore,
      maxMemoryAfter,
      avgRecovered: gcCount > 0 ? (totalRecovered / gcCount).toFixed(2) : 0,
      totalParsed
  };

  return { gcData, pauseData, stats, fullGCTime };
}
