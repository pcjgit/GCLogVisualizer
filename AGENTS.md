# Agent Handover Information

This file contains important context about the "Shenandoah GC Visualizer" project for future AI agent sessions.

## Project Context
*   **Application Type**: The project is a single-page React application built with Vite.
*   **Vite Configuration**: The Vite configuration uses a relative base path (`base: './'`) to support deploying the same build artifact to multiple environments, such as GitHub Pages and Firebase.
*   **GitHub Pages Deployment**: Deployments to GitHub Pages for this project require a `.nojekyll` file in the `public/` directory. This prevents Jekyll from ignoring built assets (which often start with underscores or have structures Jekyll normally skips).

## Standard Execution Commands
When working on this project, please use the following commands:
*   **Dependency Installation**: `npm ci`
*   **Development Server**: `npm run dev`
*   **Building**: `npm run build`
*   **Linting**: `npm run lint`
