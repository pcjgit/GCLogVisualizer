import React, { useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush
} from 'recharts';
import { LogData } from './LogParser';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} style={{ color: entry.color }} className="tooltip-item">
            {entry.name}: {entry.value} MB
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

const GCChart = ({ data, isDownsampled = false }: GCChartProps) => {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({
    beforeGC: false,
    afterGC: false,
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
  // ⚡ Bolt: Split the filtering and downsampling into two distinct useMemo hooks.
  // The filtering pass is an O(N) operation over a potentially massive array.
  // By isolating it from the `isDownsampled` toggle dependency, we prevent
  // redundant full-array traversals when the user merely toggles the downsample setting.
  const { indices, validCount } = useMemo(() => {
    if (!data || data.length === 0) return { indices: new Int32Array(0), validCount: 0 };

    // ⚡ Bolt: Filter out invalid entries before downsampling.
    // GC logs contain sparse mixed events (GC and Pauses). Passing thousands of `undefined`
    // points to Recharts forces it to process them unnecessarily, degrading main-thread performance.
    const len = data.length;
    const idxArray = new Int32Array(len);
    let count = 0;

    for (let i = 0; i < len; i++) {
      if (data[i].beforeGC !== undefined) {
        idxArray[count++] = i;
      }
    }
    return { indices: idxArray.slice(0, count), validCount: count };
  }, [data]);

  // ⚡ Bolt: Pre-allocate the result array and assign by index instead of using
  // Array.prototype.push() to avoid continuous internal memory reallocations in V8.
  const chartData = useMemo(() => {
    if (validCount === 0) return [];

    if (!isDownsampled || validCount <= 2000) {
      const result = new Array(validCount);
      for (let i = 0; i < validCount; i++) {
        result[i] = data[indices[i]];
      }
      return result;
    }

    const step = Math.ceil(validCount / 2000);
    const resultSize = Math.ceil(validCount / step);
    const result = new Array(resultSize);

    let resultIdx = 0;
    for (let i = 0; i < validCount; i += step) {
      result[resultIdx++] = data[indices[i]];
    }

    result.length = resultIdx; // Ensure exact length in case of minor division discrepancies
    return result;
  }, [data, isDownsampled, indices, validCount]);

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
          
          {/* ⚡ Bolt: Disable animation and use linear instead of monotone curves.
              Calculating cubic bezier splines and animating thousands of points causes
              severe main-thread blocking and UI jank. Linear paths are both faster
              and visually more accurate for immediate memory drop-offs in GC graphs. */}
          <Line 
            type="linear"
            isAnimationActive={false}
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
            type="linear"
            isAnimationActive={false}
            dataKey="afterGC" 
            name="After GC" 
            stroke="var(--green-color)" 
            strokeWidth={2}
            dot={false}
            connectNulls={true}
            hide={hiddenSeries.afterGC}
            activeDot={{ r: 6, fill: "var(--green-color)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
          />

          <Brush
            dataKey="timeLabel"
            height={30}
            stroke="#94a3b8"
            fill="var(--bg-surface-hover)"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// Optimization: Memoize the chart component to prevent expensive re-renders
// when parent App state changes (e.g. during drag-and-drop 'isDragging' toggles)
export default React.memo(GCChart);

