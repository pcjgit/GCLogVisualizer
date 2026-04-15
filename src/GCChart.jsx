import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry, index) => (
          <p key={`item-${index}`} style={{ color: entry.color }} className="tooltip-item">
            {entry.name}: {entry.value} MB
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function GCChart({ data }) {
  const [hiddenSeries, setHiddenSeries] = useState({
    beforeGC: false,
    afterGC: false,
  });

  if (!data || data.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-empty">No data available to plot. Upload a file above.</div>
      </div>
    );
  }

  const handleLegendClick = (e) => {
    const { dataKey } = e;
    setHiddenSeries((prev) => ({
      ...prev,
      [dataKey]: !prev[dataKey]
    }));
  };

  // Sample data slightly to avoid rendering thousands of points which lags standard LineChart
  const downsampledData = data.filter((_, i) => data.length > 2000 ? i % Math.ceil(data.length / 2000) === 0 : true);

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={downsampledData} margin={{ top: 10, right: 30, left: 20, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          
          <XAxis 
            dataKey="timeLabel" 
            stroke="#94a3b8" 
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            dy={10}
            minTickGap={30}
          />
          
          <YAxis 
            stroke="#94a3b8" 
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickFormatter={(val) => `${val}M`}
            dx={-10}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          <Legend 
            wrapperStyle={{ paddingTop: '20px', cursor: 'pointer' }}
            onClick={handleLegendClick}
          />
          
          <Line 
            type="monotone" 
            dataKey="beforeGC" 
            name="Before GC" 
            stroke="var(--red-color)" 
            strokeWidth={2}
            dot={false}
            hide={hiddenSeries.beforeGC}
            activeDot={{ r: 6, fill: "var(--red-color)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
          />
          
          <Line 
            type="monotone" 
            dataKey="afterGC" 
            name="After GC" 
            stroke="var(--green-color)" 
            strokeWidth={2}
            dot={false}
            hide={hiddenSeries.afterGC}
            activeDot={{ r: 6, fill: "var(--green-color)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

