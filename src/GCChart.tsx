import React, { useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { LogData } from './LogParser';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} style={{ color: entry.color }} className="tooltip-item">
            {entry.name}: {entry.value} {entry.name === 'Safepoint Time' ? 'ms' : 'MB'}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

interface GCChartProps {
  data: LogData[];
  isDownsampled?: boolean;
}

export default function GCChart({ data, isDownsampled = false }: GCChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({
    beforeGC: false,
    afterGC: false,
    reachingSafepointTime: false,
  });

  const handleLegendClick = (e: any) => {
    const dataKey = e.dataKey as string;
    if (dataKey) {
      setHiddenSeries((prev) => ({
        ...prev,
        [dataKey]: !prev[dataKey]
      }));
    }
  };

  // Sample data slightly to avoid rendering thousands of points which lags standard LineChart
  // Optimization: Memoize and use an O(K) loop instead of O(N) filter.
  const chartData = useMemo(() => {
    if (!data) return [];
    if (!isDownsampled || data.length <= 2000) return data;

    const result = [];
    const step = Math.ceil(data.length / 2000);
    for (let i = 0; i < data.length; i += step) {
      result.push(data[i]);
    }
    return result;
  }, [data, isDownsampled]);

  if (!data || data.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-empty">No data available to plot. Upload a file above.</div>
      </div>
    );
  }

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          
          <XAxis 
            dataKey="timeLabel" 
            stroke="#94a3b8" 
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            dy={10}
            minTickGap={30}
          />
          
          <YAxis 
            yAxisId="left"
            stroke="#94a3b8" 
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickFormatter={(val) => `${val}M`}
            dx={-10}
          />

          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickFormatter={(val) => `${val}ms`}
            dx={10}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          <Legend 
            wrapperStyle={{ paddingTop: '20px', cursor: 'pointer' }}
            onClick={handleLegendClick}
          />
          
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="beforeGC" 
            name="Before GC" 
            stroke="var(--red-color)" 
            strokeWidth={2}
            dot={false}
            connectNulls={true}
            hide={hiddenSeries.beforeGC}
            activeDot={{ r: 6, fill: "var(--red-color)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
          />
          
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="afterGC" 
            name="After GC" 
            stroke="var(--green-color)" 
            strokeWidth={2}
            dot={false}
            connectNulls={true}
            hide={hiddenSeries.afterGC}
            activeDot={{ r: 6, fill: "var(--green-color)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
          />

          <Scatter
            yAxisId="right"
            dataKey="reachingSafepointTime"
            name="Safepoint Time"
            fill="#eab308"
            hide={hiddenSeries.reachingSafepointTime}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

