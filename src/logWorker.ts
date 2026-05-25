import { parseLogFile } from './LogParser';

self.onmessage = async (e: MessageEvent) => {
  try {
    const file = e.data as File;
    const text = await file.text();

    const { data: parsedData, fullGCTime: foundTime } = parseLogFile(text);

    self.postMessage({ type: 'SUCCESS', parsedData, foundTime });
  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
