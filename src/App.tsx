import React, { useState, useCallback, useRef, lazy, Suspense } from 'react';
import { UploadCloud, FileText } from 'lucide-react';
import { LogData, GCStats, FullGCTime } from './LogParser';
import './index.css';

// ⚡ Bolt: Lazy load heavy chart components (which include Recharts)
// to drastically reduce initial bundle size and improve load time.
const GCChart = lazy(() => import('./GCChart'));
const PauseChart = lazy(() => import('./PauseChart'));

function App() {
  const [gcData, setGcData] = useState<LogData[]>([]);
  const [pauseData, setPauseData] = useState<LogData[]>([]);
  const [stats, setStats] = useState<GCStats | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDownsampled, setIsDownsampled] = useState<boolean>(false);
  const [fullGCTime, setFullGCTime] = useState<FullGCTime>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workerRef = useRef<Worker | null>(null);

  const processFile = (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setFullGCTime(null);
    setStats(null);
    setGcData([]);
    setPauseData([]);
    
    // Terminate existing worker if there's one
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = new Worker(new URL('./logWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      if (e.data.type === 'SUCCESS') {
        setGcData(e.data.gcData);
        setPauseData(e.data.pauseData);
        setStats(e.data.stats);
        setFullGCTime(e.data.fullGCTime);
      } else if (e.data.type === 'ERROR') {
        console.error('Error parsing file:', e.data.error);
      }
    };

    worker.postMessage(file);
  };

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Shenandoah GC Visualizer</h1>
        <p>Analyze and plot JVM memory performance in completely local environment</p>
      </header>

      <main>
        <div 
          className={`dropzone ${isDragging ? 'active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            style={{ display: 'none' }} 
            accept=".txt,.log" 
          />
          {fileName ? (
            <>
              <FileText className="upload-icon" />
              <p className="upload-text">Loaded: {fileName}</p>
              <p className="upload-subtext">Click or drag a new file to replace</p>
            </>
          ) : (
            <>
              <UploadCloud className="upload-icon" />
              <p className="upload-text">Drag and drop your GC log here</p>
              <p className="upload-subtext">or click to browse files</p>
            </>
          )}
        </div>

        <div className="controls-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={isDownsampled}
              onChange={(e) => setIsDownsampled(e.target.checked)}
            />
            Enable Data Downsampling (Faster Rendering)
          </label>
        </div>

        <Suspense fallback={<div className="chart-container"><div className="chart-empty">Loading charts...</div></div>}>
          <GCChart data={gcData} isDownsampled={isDownsampled} />

          {(gcData.length > 0 || pauseData.length > 0) && (
            <PauseChart data={pauseData} isDownsampled={isDownsampled} />
          )}
        </Suspense>

        {stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-title">Total Lines Parsed</div>
              <div className="stat-value">{stats.totalParsed}</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Max Memory Before GC</div>
              <div className="stat-value">{stats.maxMemoryBefore}M</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Max Memory After GC</div>
              <div className="stat-value">{stats.maxMemoryAfter}M</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Average Recovered</div>
              <div className="stat-value">{stats.avgRecovered}M</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Full GC Occurred</div>
              <div className="stat-value" style={{ color: fullGCTime ? 'var(--red-color)' : 'var(--green-color)' }}>
                {fullGCTime ? (
                  typeof fullGCTime === 'string' ? (
                    fullGCTime
                  ) : (
                    <>
                      <div style={{ fontSize: '0.8em', lineHeight: '1.2' }}>{fullGCTime.date}</div>
                      <div style={{ fontSize: '0.8em', lineHeight: '1.2' }}>{fullGCTime.time}</div>
                      <div style={{ fontSize: '0.8em', lineHeight: '1.2' }}>{fullGCTime.tz}</div>
                    </>
                  )
                ) : 'No'}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
