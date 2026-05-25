import { readFileSync } from 'fs';
import { parseLogFile } from './src/LogParser.js';

const text = readFileSync('large.log', 'utf8');

const start = performance.now();
const data = parseLogFile(text);
const end = performance.now();

console.log(`Parsed ${data.length} entries in ${(end - start).toFixed(2)} ms`);
