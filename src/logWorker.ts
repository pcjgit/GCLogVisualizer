import { parseLogFile } from './LogParser';

self.onmessage = async (e: MessageEvent) => {
  try {
    const file = e.data as File;
    const text = await file.text();

    const parsedData = parseLogFile(text);

    let foundTime: { date: string, time: string, tz: string } | string | null = null;
    const fullGcIndex = text.indexOf('Upgrade To Full GC');
    if (fullGcIndex !== -1) {
      const lineStartIndex = text.lastIndexOf('\n', fullGcIndex);
      const start = lineStartIndex === -1 ? 0 : lineStartIndex + 1;
      const line = text.substring(start, fullGcIndex);
      const firstBracket = line.indexOf('[');
      const closeBracket = line.indexOf(']', firstBracket);
      if (firstBracket !== -1 && closeBracket !== -1) {
        const timeStr = line.substring(firstBracket + 1, closeBracket);
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
          foundTime = { date, time, tz };
        } else {
          foundTime = timeStr;
        }
      }
    }

    self.postMessage({ type: 'SUCCESS', parsedData, foundTime });
  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
