import { loadConfig } from './config.js';
import { startHttp } from './http.js';
import { startStdio } from './stdio.js';

const config = loadConfig(process.argv.slice(2));

if (config.mode === 'stdio') {
  await startStdio(config);
} else {
  startHttp(config);
}
