import React, { useState, useCallback, useRef, useMemo } from 'react';
import { UploadCloud, FileText } from 'lucide-react';
import GCChart from './GCChart';
import SafepointChart from './SafepointChart';
import { parseLogFile, LogData } from './LogParser';
import './index.css';

function App() {
  const [data, setData] = useState<LogData[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDownsampled, setIsDownsampled] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    if (!file) return;
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const text = e.target.result as string;
        const parsedData = parseLogFile(text);
        setData(parsedData);
      }
    };
    reader.readAsText(file);
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

  // Optimize statistics calculation:
  // 1. Memoize to prevent recalculation on every render (e.g. when dragging)
  // 2. Use a single loop to avoid multiple array allocations and O(N) passes
  // 3. Avoid Math.max(...array) to prevent Maximum Call Stack Size Exceeded errors on large logs
  const { maxMemoryBefore, maxMemoryAfter, avgRecovered } = useMemo(() => {
    if (data.length === 0) {
      return { maxMemoryBefore: 0, maxMemoryAfter: 0, avgRecovered: 0 };
    }

    let maxBefore = 0;
    let maxAfter = 0;
    let totalRecovered = 0;

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      if (d.beforeGC !== undefined && d.beforeGC > maxBefore) maxBefore = d.beforeGC;
      if (d.afterGC !== undefined && d.afterGC > maxAfter) maxAfter = d.afterGC;
      if (d.beforeGC !== undefined && d.afterGC !== undefined) {
        totalRecovered += (d.beforeGC - d.afterGC);
      }
    }

    return {
      maxMemoryBefore: maxBefore,
      maxMemoryAfter: maxAfter,
      avgRecovered: (totalRecovered / data.length).toFixed(2)
    };
  }, [data]);

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

        <GCChart data={data} isDownsampled={isDownsampled} />

        {data.length > 0 && (
          <SafepointChart data={data} isDownsampled={isDownsampled} />
        )}

        {data.length > 0 && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-title">Total Pauses Parsed</div>
              <div className="stat-value">{data.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Max Memory Before GC</div>
              <div className="stat-value">{maxMemoryBefore}M</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Max Memory After GC</div>
              <div className="stat-value">{maxMemoryAfter}M</div>
            </div>
            <div className="stat-card">
              <div className="stat-title">Average Recovered</div>
              <div className="stat-value">{avgRecovered}M</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
