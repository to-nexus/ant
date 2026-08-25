/**
 * Static preview server — the dev "process" for a project with no build
 * manifest (a hand-written `index.html` site).
 *
 * Runs as a CHILD PROCESS, not in-process, on purpose: the whole preview
 * lifecycle (log streaming, `DevProcessControl.killTree`, health check, port
 * registry, port-conflict retry) is written against a `ChildProcess`, so a
 * static site becomes just another spawnable dev server and no lifecycle code
 * learns about it.
 *
 * Spawned by `ProcessSpawner.spawnStatic`; contract is four env vars:
 *   PORT             — allocated by PreviewService
 *   ANT_STATIC_ROOT  — absolute doc root (from `staticDocRoot`)
 *   ANT_STATIC_ENTRY — entry filename inside the root (from `staticEntryFile`)
 *   ANT_BASE_PATH    — URL prefix the proxy forwards verbatim, or `/`
 */

import { createStaticApp } from '../static/staticApp';

const port = Number(process.env.PORT);
const root = process.env.ANT_STATIC_ROOT;
const entryFile = process.env.ANT_STATIC_ENTRY || 'index.html';
const basePath = process.env.ANT_BASE_PATH || '/';

if (!root || !Number.isInteger(port) || port <= 0) {
  console.error('❌ static-preview-server requires ANT_STATIC_ROOT and a numeric PORT');
  process.exit(1);
}

const app = createStaticApp({
  root: root!,
  basePath,
  cache: 'none',
  fallback: 'navigation-only',
  entryFile,
});

const server = app.listen(port, '0.0.0.0');

// `'listening'`, not the listen callback: express invokes that callback even
// when the bind fails, which would print a ready line for a dead server.
server.on('listening', () => {
  console.log(`🚀 Static preview server ready on port ${port} (root=${root}, entry=${entryFile}, basePath=${basePath})`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  // The literal `EADDRINUSE` is what `spawnWithConflictRetry` matches on to
  // reallocate a port and respawn — keep it in the stderr text.
  console.error(
    err.code === 'EADDRINUSE'
      ? `❌ EADDRINUSE: port ${port} is already in use`
      : `❌ Static preview server failed: ${err.message}`,
  );
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Do not wait forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
