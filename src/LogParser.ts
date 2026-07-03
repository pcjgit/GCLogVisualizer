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

// ⚡ Bolt: Fast-path for ISO-8601 like: 2024-05-15T15:23:45.150+0000
// Avoids expensive Date.parse() for the most common JVM log format.
// Optimized to accept (str, start, end) to bypass intermediate substring allocations.
const parseISO8601FastPath = (str: string, start: number, end: number): number => {
  const length = end - start;
  if (length >= 23 && str.charCodeAt(start + 4) === 45 && str.charCodeAt(start + 7) === 45) {
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
      let tzOffsetMs = 0;
      let i = 19;

      if (str.charCodeAt(start + i) === 46) { // '.'
         ms = (str.charCodeAt(start + 20) - 48) * 100 +
              (str.charCodeAt(start + 21) - 48) * 10 +
              (str.charCodeAt(start + 22) - 48);
         i = 23;
      }

      const tzSign = str.charCodeAt(start + i);
      if (tzSign === 43 || tzSign === 45) { // '+' or '-'
         // Verify timezone is in +HHMM / -HHMM format without colon
         if (length >= i + 5 && str.charCodeAt(start + i + 3) !== 58) { // 58 is ':'
             const tzHour = (str.charCodeAt(start + i + 1) - 48) * 10 +
                            (str.charCodeAt(start + i + 2) - 48);
             const tzMin = (str.charCodeAt(start + i + 3) - 48) * 10 +
                           (str.charCodeAt(start + i + 4) - 48);
             tzOffsetMs = (tzHour * 60 + tzMin) * 60000;
             let parsedTime = Date.UTC(year, month, day, hour, minute, second, ms);
             if (tzSign === 43) parsedTime -= tzOffsetMs;
             else if (tzSign === 45) parsedTime += tzOffsetMs;
             return parsedTime;
         }
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

  const isShenandoah = fileContent.length > 5242880
    ? fileContent.substring(0, 5242880).indexOf('Concurrent cleanup') !== -1
    : fileContent.indexOf('Concurrent cleanup') !== -1;

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

    const gcKeywordGlobalIndex = (nextGC !== -1 && nextGC < lineEnd) ? nextGC : -1;
    const pauseGlobalIndex = (nextPause !== -1 && nextPause < lineEnd) ? nextPause : -1;
    const fullGCGlobalIndex = (nextFullGC !== -1 && nextFullGC < lineEnd) ? nextFullGC : -1;

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
    
    if (fullGCGlobalIndex !== -1 && fullGCTime === null) {
      const firstBracket = fileContent.indexOf('[', lineStart);
      const closeBracket = fileContent.indexOf(']', firstBracket);
      if (firstBracket !== -1 && closeBracket !== -1 && closeBracket < lineEnd) {
        const timeStr = fileContent.substring(firstBracket + 1, closeBracket);
        const tIndex = timeStr.indexOf('T');
        if (tIndex !== -1) {
          const date = timeStr.substring(0, tIndex);
          let tz = '';
          let time = '';
          const tzMatch = timeStr.substring(tIndex + 1).match(/([+-]\d{4}|Z)$/);
          if (tzMatch) {
            tz = tzMatch[1];
            time = timeStr.substring(tIndex + 1, timeStr.length - tz.length);
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

    let isGC = gcKeywordGlobalIndex !== -1;

    // Additional filtering for Metaspace lines
    if (isGC) {
        const etaspaceIndex = fileContent.indexOf('etaspace', lineStart);
        if (etaspaceIndex !== -1 && etaspaceIndex < lineEnd) {
            isGC = false;
        }
    }

    const isPause = pauseGlobalIndex !== -1;
    
    if (!isGC && !isPause) {
      continue;
    }

    const firstBracketIndex = fileContent.indexOf('[', lineStart);
    const closingBracketIndex = fileContent.indexOf(']', firstBracketIndex);
    if (firstBracketIndex === -1 || closingBracketIndex === -1 || closingBracketIndex > lineEnd) {
      continue;
    }

    if (isGC) {
      // Find the actual arrow if we used a keyword search
      const arrowIndex = fileContent.indexOf('->', gcKeywordGlobalIndex);
      if (arrowIndex !== -1 && arrowIndex < lineEnd) {
        const spaceBeforeIndex = fileContent.lastIndexOf(' ', arrowIndex - 1);
        const beforeStart = (spaceBeforeIndex === -1 || spaceBeforeIndex < lineStart) ? lineStart : spaceBeforeIndex + 1;

        const bParen = fileContent.indexOf('(', beforeStart);
        const beforeEnd = (bParen !== -1 && bParen < arrowIndex) ? bParen : arrowIndex;

        if (beforeEnd > beforeStart) {
          const bLastChar = fileContent.charCodeAt(beforeEnd - 1);
          if ((bLastChar >= 65 && bLastChar <= 90) || (bLastChar >= 97 && bLastChar <= 122)) {
            beforeUnitCode = bLastChar;
            beforeVal = +(fileContent.substring(beforeStart, beforeEnd - 1));
          } else {
            beforeVal = +(fileContent.substring(beforeStart, beforeEnd));
          }
        }

        const afterParen = fileContent.indexOf('(', arrowIndex);
        let afterSpace = fileContent.indexOf(' ', arrowIndex);
        if (afterSpace === -1 || afterSpace > lineEnd) afterSpace = lineEnd;

        const afterEnd = (afterParen !== -1 && afterParen < afterSpace) ? afterParen : afterSpace;
        const afterStart = arrowIndex + 2;

        if (afterEnd > afterStart) {
          const aLastChar = fileContent.charCodeAt(afterEnd - 1);
          if ((aLastChar >= 65 && aLastChar <= 90) || (aLastChar >= 97 && aLastChar <= 122)) {
            afterUnitCode = aLastChar;
            afterVal = +(fileContent.substring(afterStart, afterEnd - 1));
          } else {
            afterVal = +(fileContent.substring(afterStart, afterEnd));
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
      const msEndIndex = fileContent.lastIndexOf('ms', lineEnd);
      if (msEndIndex !== -1 && msEndIndex >= lineStart && msEndIndex > pauseGlobalIndex) {
        const spaceBeforeMs = fileContent.lastIndexOf(' ', msEndIndex);
        if (spaceBeforeMs !== -1 && spaceBeforeMs >= lineStart) {
          pauseDurationMs = +(fileContent.substring(spaceBeforeMs + 1, msEndIndex));
          pauseType = fileContent.substring(pauseGlobalIndex, spaceBeforeMs);
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

    const globalTimeStart = firstBracketIndex + 1;
    const globalTimeEnd = closingBracketIndex;

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
           timeLabel = `${timeValue}s`;
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
                if (sep === 84 || sep === 32) { // 'T' or ' '
                  const datePart = timeStr.substring(0, 10);
                  const timePart = timeStr.substring(11, 19);
                  timeLabel = `${datePart} ${timePart}`;
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
