import { parseLogFile } from './LogParser';

self.onmessage = async (e: MessageEvent) => {
  try {
    const file = e.data as File;
    const text = await file.text();

    const { gcData, pauseData, stats, fullGCTime } = parseLogFile(text);

    self.postMessage({ type: 'SUCCESS', gcData, pauseData, stats, fullGCTime });
  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
