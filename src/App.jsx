import React, { useState, useCallback, useRef } from 'react';
import { UploadCloud, FileText, Activity } from 'lucide-react';
import GCChart from './GCChart';
import { parseLogFile } from './LogParser';
import './index.css';

function App() {
  const [data, setData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const processFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsedData = parseLogFile(text);
      setData(parsedData);
    };
    reader.readAsText(file);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const maxMemoryBefore = data.length > 0 ? Math.max(...data.map(d => d.beforeGC)) : 0;
  const maxMemoryAfter = data.length > 0 ? Math.max(...data.map(d => d.afterGC)) : 0;
  const avgRecovered = data.length > 0 
    ? (data.reduce((acc, d) => acc + (d.beforeGC - d.afterGC), 0) / data.length).toFixed(2)
    : 0;

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
          onClick={() => fileInputRef.current.click()}
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

        <GCChart data={data} />

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
