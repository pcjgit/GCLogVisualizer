import React, { useState, useMemo } from 'react';
import {
  ComposedChart,
  Scatter,
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
    const pauseType = payload[0]?.payload?.pauseType;
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {pauseType && (
          <p className="tooltip-item" style={{ color: '#eab308' }}>
            Type: {pauseType}
          </p>
        )}
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} style={{ color: entry.color }} className="tooltip-item">
            {entry.name}: {entry.value} ms
          </p>
        ))}
      </div>
    );
  }
  return null;
};

interface PauseChartProps {
  data: LogData[];
  isDownsampled?: boolean;
}

const PauseChart = ({ data, isDownsampled = false }: PauseChartProps) => {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({
    pauseTime: false,
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
  // ⚡ Bolt: Eliminate intermediate arrays and Array.prototype.push()
  // to avoid V8 array resizing overhead and high memory consumption.
  const chartData = useMemo(() => {
    if (!data) return [];

    // Pass 1: Count valid items
    let validCount = 0;
    const len = data.length;
    for (let i = 0; i < len; i++) {
      if (data[i].pauseTime !== undefined) {
        validCount++;
      }
    }

    if (validCount === 0) return [];

    if (!isDownsampled || validCount <= 2000) {
      const result = new Array(validCount);
      let idx = 0;
      for (let i = 0; i < len; i++) {
        if (data[i].pauseTime !== undefined) {
          result[idx++] = data[i];
        }
      }
      return result;
    }

    const step = Math.ceil(validCount / 2000);
    const resultSize = Math.ceil(validCount / step);
    const result = new Array(resultSize);

    let validSeen = 0;
    let resultIdx = 0;
    for (let i = 0; i < len; i++) {
      if (data[i].pauseTime !== undefined) {
        if (validSeen % step === 0) {
          result[resultIdx++] = data[i];
        }
        validSeen++;
      }
    }

    result.length = resultIdx; // Ensure perfectly sized array
    return result;
  }, [data, isDownsampled]);

  if (!data || data.length === 0) {
    return null; // The parent component checks length anyway, but safe fallback
  }

  return (
    <div className="chart-container" style={{ marginTop: '2rem' }}>
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
            tickFormatter={(val) => `${val}ms`}
            dx={-10}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            wrapperStyle={{ paddingTop: '20px', cursor: 'pointer' }}
            onClick={handleLegendClick}
          />

          {/* ⚡ Bolt: Disable animation to prevent main-thread blocking
              when rendering thousands of pause scatter marks. */}
          <Scatter
            isAnimationActive={false}
            dataKey="pauseTime"
            name="Pause Time"
            fill="#eab308"
            hide={hiddenSeries.pauseTime}
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
export default React.memo(PauseChart);
