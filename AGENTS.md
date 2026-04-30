# Agent Handover Information

This file contains important context about the "Shenandoah GC Visualizer" project for future AI agent sessions.

## Project Context
*   **Application Type**: The project is a single-page React application built with Vite.
*   **Vite Configuration**: The Vite configuration uses a relative base path (`base: './'`) to support deploying the same build artifact to multiple environments, such as GitHub Pages and Firebase.

## Development Guidelines
*   **Large arrays optimization**: Avoid using the spread operator with large arrays (e.g., `Math.max(...array)`) when processing GC log data. The large volume of log entries can easily exceed V8's maximum call stack size, resulting in a `RangeError`. Use single-pass loops or `reduce` instead.
*   **Data Visualization & Recharts**: When rendering time-series data with sparse or interleaved metrics in Recharts (such as mixed GC memory events and Safepoint times), ensure `<Line>` components use the `connectNulls={true}` prop to maintain continuous lines across data points with `undefined` values.

## Standard Execution Commands
When working on this project, please use the following commands:
*   **Dependency Installation**: `npm ci`
*   **Development Server**: `npm run dev`
*   **Building**: `npm run build`
*   **Linting**: `npm run lint`
