## 2026-04-29 - [Avoid spread operator on massive log arrays]
**Learning:** Using `Math.max(...array)` on arrays built from parsed GC log files in this application is an anti-pattern. Because the user provides the GC log, the number of data points can easily exceed V8's call stack limit (usually ~100k-125k items), leading to a hard crash (`RangeError: Maximum call stack size exceeded`).
**Action:** When calculating statistics or bounds over parsed log data arrays, always use standard loops (like a `for` loop or `Array.prototype.reduce`) instead of the spread operator to ensure stability regardless of the uploaded log size.
## 2025-05-01 - [O(N) vs O(K) in array downsampling]
**Learning:** Found a significant UI bottleneck where downsampling logic for the chart was recalculating on every component render using a slow `.filter` on potentially very large arrays (GC logs can be hundreds of thousands of lines).
**Action:** Always wrap expensive data transformations in React with `useMemo`. When downsampling an array by taking every Nth element, use a `for` loop that skips elements (`i += step`) instead of `filter`, reducing time complexity from O(N) to O(K) (where K is the target array length, which is ~30-100x faster).

## 2024-05-02 - [LogParser.ts Regex Bottleneck]
**Learning:** Heavy use of regular expressions over millions of lines in `LogParser.ts` can cause a severe CPU bottleneck in browser execution. Array iteration methods like `forEach` and closures add measurable overhead on large inputs. Over 80% of JVM log lines are usually noise that don't match the regexes.
**Action:** Always pre-filter long log files with fast string checking methods (`includes`, `indexOf`) to skip noise before applying complex Regex. Replace `forEach` with traditional `for` loops for massive array iterations in browser performance paths.
