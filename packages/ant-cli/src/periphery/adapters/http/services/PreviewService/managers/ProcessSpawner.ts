import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PackageInfo, LogCallback, ExitCallback } from '../types';
import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { logger } from '../../../../../../utils/logger';
import { DevProcessControl, getDefaultDevProcessControl } from '../../../../../../core/process/DevProcessControl';

// === BEGIN image-fetch diagnostic (TEMPORARY) ===========================
// Wraps next dev's `global.fetch` so we can capture the first 64 bytes of
// every outbound HTTP(S) response and tell whether next/image is receiving
// real image bytes, an HTML interstitial, or an empty buffer. Output goes
// to `{featurePath}/sessions/architect/debug/image-fetch/probe-*.jsonl`.
//
// REMOVE this entire block (and its call site in `spawnNode`) once the
// root cause of the `detectContentType` 400s is confirmed.

const FETCH_PROBE_SOURCE = `'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const debugDir = process.env.ANT_DEBUG_IMAGE_FETCH_DIR;
const probeSelf = __filename;

// Marker log — one line per probe LOAD and per intercepted spawn. Captures
// propagation independently of whether the loaded process actually fires
// any global.fetch (image-optimizer may use a different fetch path).
function antMarker(kind, extra) {
  if (!debugDir) return;
  try {
    var line = Object.assign(
      { t: new Date().toISOString(), pid: process.pid, ppid: process.ppid, kind: kind },
      extra || {},
    );
    fs.appendFileSync(path.join(debugDir, 'marker.jsonl'), JSON.stringify(line) + '\\n');
  } catch (_e) { /* never break the host process */ }
}

antMarker('load', {
  argv0: process.argv0,
  argv1: process.argv[1],
  isNextWorker: process.env.NEXT_PRIVATE_WORKER === '1',
  nodeOptions: process.env.NODE_OPTIONS || null,
  execArgv: process.execArgv,
});

// Heartbeat — proves the probe-instrumented process is still alive between
// pulls. If marker.jsonl has many heartbeat lines, the wrap-instrumented
// process is the one serving requests; otherwise traffic is going to a
// different process the probe never attached to.
if (debugDir) {
  try {
    var antHeartbeatN = 0;
    var antHeartbeatTimer = setInterval(function () {
      try { antMarker('heartbeat', { n: ++antHeartbeatN }); } catch (_) {}
    }, 10000);
    if (antHeartbeatTimer && typeof antHeartbeatTimer.unref === 'function') {
      antHeartbeatTimer.unref();
    }
  } catch (_) {}
}

// Module._compile inject — patches Next.js image-optimizer.js as it loads
// to call antMarker directly inside fetchExternalImage. Bypasses the
// globalThis.fetch / undici-channel indirection so we capture the upstream
// buffer bytes (first64Hex) at the exact point detectContentType decides
// the 400. Expose antMarker via globalThis for the injected code.
globalThis.__antMarker = antMarker;
try {
  const antModule = require('module');
  const antOrigCompile = antModule.prototype._compile;
  antModule.prototype._compile = function antPatchedCompile(content, filename) {
    try {
      if (
        typeof filename === 'string' &&
        /\\/server\\/image-optimizer\\.js$/.test(filename) &&
        typeof content === 'string' &&
        content.indexOf('__antProbeInjected__') === -1
      ) {
        antMarker('image-optimizer-compile', { filename: filename });
        content = content.replace(
          /async function fetchExternalImage\\(\\s*href\\s*,\\s*maximumResponseBody\\s*\\)\\s*\\{/,
          'async function fetchExternalImage(href, maximumResponseBody) { ' +
            '/* __antProbeInjected__ */ ' +
            'try { if (globalThis.__antMarker) globalThis.__antMarker("image-fetch-enter", { href: href }); } catch (_) {}'
        );
        content = content.replace(
          /const\\s+buffer\\s*=\\s*Buffer\\.concat\\(chunks\\)\\s*;/,
          'const buffer = Buffer.concat(chunks); ' +
            'try { if (globalThis.__antMarker) globalThis.__antMarker("image-buffer", { ' +
              'href: href, ' +
              'size: buffer.length, ' +
              'first64Hex: buffer.slice(0, 64).toString("hex"), ' +
              'contentType: (res && res.headers && res.headers.get) ? res.headers.get("Content-Type") : null ' +
            '}); } catch (_) {}'
        );
      }
    } catch (e) {
      try { antMarker('image-optimizer-compile-error', { message: (e && e.message) || String(e) }); } catch (_) {}
    }
    return antOrigCompile.call(this, content, filename);
  };
} catch (_) {
  antMarker('module-compile-hook-unavailable', {});
}

// Propagate this probe to every child process spawned from here. Next.js
// 'next dev' forks a 'start-server' child that rebuilds NODE_OPTIONS via
// node:util.parseArgs without an options schema, which can drop our
// --require=<probe>. Re-inject directly into the spawn-time env so the
// child also loads this same probe file.
function antEnsureProbeInEnv(envIn) {
  const env = envIn ? Object.assign({}, envIn) : Object.assign({}, process.env);
  const existing = typeof env.NODE_OPTIONS === 'string' ? env.NODE_OPTIONS : '';
  if (existing.indexOf(probeSelf) === -1) {
    env.NODE_OPTIONS = (existing + ' --require=' + probeSelf).trim();
  }
  if (!env.ANT_DEBUG_IMAGE_FETCH_DIR && process.env.ANT_DEBUG_IMAGE_FETCH_DIR) {
    env.ANT_DEBUG_IMAGE_FETCH_DIR = process.env.ANT_DEBUG_IMAGE_FETCH_DIR;
  }
  return env;
}

const antOriginalFork = cp.fork;
cp.fork = function antPatchedFork(modulePath, args, options) {
  if (args && !Array.isArray(args) && typeof args === 'object') {
    options = args;
    args = undefined;
  }
  const patched = Object.assign({}, options || {}, {
    env: antEnsureProbeInEnv(options && options.env),
  });
  antMarker('fork', {
    modulePath: typeof modulePath === 'string' ? modulePath : String(modulePath),
    childNodeOptions: patched.env && patched.env.NODE_OPTIONS,
  });
  return antOriginalFork.call(this, modulePath, args, patched);
};

const antOriginalSpawn = cp.spawn;
cp.spawn = function antPatchedSpawn(command, args, options) {
  if (args && !Array.isArray(args) && typeof args === 'object') {
    options = args;
    args = undefined;
  }
  const patched = Object.assign({}, options || {}, {
    env: antEnsureProbeInEnv(options && options.env),
  });
  antMarker('spawn', {
    command: typeof command === 'string' ? command : String(command),
    args: Array.isArray(args) ? args.slice(0, 8) : null,
    childNodeOptions: patched.env && patched.env.NODE_OPTIONS,
  });
  return antOriginalSpawn.call(this, command, args, patched);
};

if (debugDir) {
  const probeFile = path.join(debugDir, 'probe-' + Date.now() + '-' + process.pid + '.jsonl');

  function antMakeProbedFetch(inner) {
    if (typeof inner !== 'function') return inner;
    const probed = async function antProbedFetch(resource, init) {
      const startedAt = Date.now();
      let response, fetchError;
      try {
        response = await inner(resource, init);
      } catch (err) { fetchError = err; }
      try {
        const requestUrl =
          typeof resource === 'string'
            ? resource
            : resource && typeof resource.url === 'string'
              ? resource.url
              : String(resource);
        if (/^https?:/i.test(requestUrl)) {
          const entry = {
            t: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            requestUrl: requestUrl,
          };
          if (fetchError) {
            entry.error = (fetchError && fetchError.message) || String(fetchError);
          } else {
            entry.status = response.status;
            entry.finalUrl = response.url;
            entry.contentType = response.headers.get('content-type');
            try {
              const clone = response.clone();
              const buf = Buffer.from(await clone.arrayBuffer());
              entry.size = buf.length;
              entry.first64Hex = buf.slice(0, 64).toString('hex');
            } catch (cloneErr) {
              entry.cloneError = (cloneErr && cloneErr.message) || String(cloneErr);
            }
          }
          fs.appendFileSync(probeFile, JSON.stringify(entry) + '\\n');
        }
      } catch (_probeErr) { /* never break the host request */ }
      if (fetchError) throw fetchError;
      return response;
    };
    probed.__antProbed = true;
    return probed;
  }

  // Accessor descriptor — any later reassignment to globalThis.fetch
  // (e.g., Next's patchFetch swapping in createPatchedFetcher) is
  // intercepted and the replacement is re-wrapped, so our probe always
  // sits at the outermost layer.
  let antCurrentFetch = antMakeProbedFetch(globalThis.fetch);
  let antDescriptorOk = false;
  let antDescriptorKind = 'unknown';
  try {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get: function () { return antCurrentFetch; },
      set: function (next) {
        antCurrentFetch =
          next && next.__antProbed ? next : antMakeProbedFetch(next);
        antMarker('fetch-reassign', { byProbed: !!(next && next.__antProbed) });
      },
    });
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    antDescriptorOk = !!(desc && typeof desc.get === 'function');
    antDescriptorKind = antDescriptorOk ? 'accessor' : 'data';
  } catch (e) {
    antMarker('fetch-descriptor-error', { message: (e && e.message) || String(e) });
    try { globalThis.fetch = antCurrentFetch; } catch (_e2) {}
  }
  antMarker('fetch-wrap-installed', { ok: antDescriptorOk, kind: antDescriptorKind });

  // node:diagnostics_channel subscription — catches every undici-based
  // outbound HTTP regardless of which fetch reference the caller holds.
  // Node 18+ built-in fetch is undici-based, so the image-optimizer's
  // fetchExternalImage will surface here even if it bypasses our wrap.
  try {
    const dc = require('diagnostics_channel');
    const sub = function (name, handler) {
      try { dc.channel(name).subscribe(handler); } catch (_) {}
    };
    sub('undici:request:create', function (msg) {
      try {
        const r = msg && msg.request;
        antMarker('undici-request', {
          method: r && r.method,
          origin: r && r.origin,
          path: r && r.path,
        });
      } catch (_) {}
    });
    sub('undici:request:headers', function (msg) {
      try {
        const r = msg && msg.request;
        const res = msg && msg.response;
        let ct = null;
        if (res && res.headers && Buffer.isBuffer(res.headers)) {
          const m = res.headers.toString('latin1').match(/^content-type:\\s*(.+)$/im);
          if (m) ct = m[1];
        }
        antMarker('undici-headers', {
          origin: r && r.origin,
          path: r && r.path,
          statusCode: res && res.statusCode,
          contentTypeRaw: ct,
        });
      } catch (_) {}
    });
    sub('undici:request:error', function (msg) {
      try {
        const r = msg && msg.request;
        const err = msg && msg.error;
        antMarker('undici-error', {
          origin: r && r.origin,
          path: r && r.path,
          message: (err && err.message) || String(err),
        });
      } catch (_) {}
    });
  } catch (_e) {
    antMarker('undici-channel-unavailable', {});
  }

  // One-shot snapshot 5s after boot — by then Next's patchFetch (if any)
  // has run; lets us verify our probe still sits at the outermost layer.
  try {
    const snapshotTimer = setTimeout(function () {
      try {
        const f = globalThis.fetch;
        antMarker('fetch-snapshot', {
          isProbed: !!(f && f.__antProbed),
          typeofFetch: typeof f,
          name: f && f.name,
        });
      } catch (_) {}
    }, 5000);
    if (snapshotTimer && typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
  } catch (_) {}
}
`;

let cachedProbePath: string | undefined;
function ensureFetchProbeOnDisk(): string {
  if (cachedProbePath && fs.existsSync(cachedProbePath)) return cachedProbePath;
  const probePath = path.join(os.tmpdir(), `ant-image-fetch-probe-${process.pid}.cjs`);
  fs.writeFileSync(probePath, FETCH_PROBE_SOURCE);
  cachedProbePath = probePath;
  return probePath;
}

const OUTBOUND_ENV_KEY = /^(HTTPS?_PROXY|NO_PROXY|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|HTTPS?_AGENT_OPTIONS|UV_THREADPOOL_SIZE)$/i;

// Patch image-optimizer.js directly on disk so any process that requires it
// (regardless of timing or who installs Module._compile hook first) sees the
// patched bytes. Bypasses every layer of indirection — cloud verification is
// `grep __antProbeInjected__ image-optimizer.js`.
function patchImageOptimizerOnDisk(projectRoot: string, debugDir: string): void {
  const imgOptPath = path.join(
    projectRoot,
    'node_modules/next/dist/server/image-optimizer.js',
  );
  const writeMarker = (extra: Record<string, unknown>): void => {
    try {
      fs.appendFileSync(
        path.join(debugDir, 'marker.jsonl'),
        JSON.stringify({
          t: new Date().toISOString(),
          pid: process.pid,
          kind: 'image-optimizer-disk-patch',
          ...extra,
        }) + '\n',
      );
    } catch (_e) {
      /* never break host */
    }
  };
  let original: string;
  try {
    original = fs.readFileSync(imgOptPath, 'utf8');
  } catch (err: any) {
    writeMarker({
      stage: 'read',
      error: err?.message ?? String(err),
      path: imgOptPath,
    });
    return;
  }
  if (original.indexOf('__antProbeInjected__') !== -1) {
    writeMarker({ stage: 'already-patched', length: original.length });
    return;
  }
  const r1 =
    /async function fetchExternalImage\(\s*href\s*,\s*maximumResponseBody\s*\)\s*\{/;
  const r2 = /const\s+buffer\s*=\s*Buffer\.concat\(chunks\)\s*;/;
  const hadEntry = r1.test(original);
  const hadBuffer = r2.test(original);
  let patched = original;
  patched = patched.replace(
    r1,
    'async function fetchExternalImage(href, maximumResponseBody) { ' +
      '/* __antProbeInjected__ */ ' +
      'try { if (globalThis.__antMarker) globalThis.__antMarker("image-fetch-enter", { href: href }); } catch (_) {}',
  );
  patched = patched.replace(
    r2,
    'const buffer = Buffer.concat(chunks); ' +
      'try { if (globalThis.__antMarker) globalThis.__antMarker("image-buffer", { ' +
      'href: href, ' +
      'size: buffer.length, ' +
      'first64Hex: buffer.slice(0, 64).toString("hex"), ' +
      'contentType: (res && res.headers && res.headers.get) ? res.headers.get("Content-Type") : null ' +
      '}); } catch (_) {}',
  );
  const injected = patched.indexOf('__antProbeInjected__') !== -1;
  writeMarker({
    stage: 'pre-write',
    hadEntry,
    hadBuffer,
    injected,
    originalLength: original.length,
    patchedLength: patched.length,
    path: imgOptPath,
  });
  if (!injected) return;
  try {
    fs.writeFileSync(imgOptPath + '.ant-backup', original);
    fs.writeFileSync(imgOptPath, patched);
    writeMarker({ stage: 'write-success' });
  } catch (err: any) {
    writeMarker({
      stage: 'write-error',
      error: err?.message ?? String(err),
    });
  }
}

function setupImageFetchDiagnostic(
  env: Record<string, string | undefined>,
  options: SpawnOptions,
  pkg: PackageInfo,
): void {
  try {
    const projectRoot = options.projectRoot;
    if (!projectRoot) return;
    // ANT convention: featurePath/codebase/, so featurePath = dirname(projectRoot).
    const featurePath = path.dirname(projectRoot);
    const debugDir = path.join(featurePath, 'sessions', 'architect', 'debug', 'image-fetch');
    fs.mkdirSync(debugDir, { recursive: true });

    const dump = {
      t: new Date().toISOString(),
      pkg: pkg.name,
      pkgType: pkg.type,
      mode: process.env.ANT_SERVER_MODE ?? null,
      outbound: Object.fromEntries(
        Object.entries(env).filter(([k]) => OUTBOUND_ENV_KEY.test(k)),
      ),
    };
    fs.appendFileSync(path.join(debugDir, 'env-dump.jsonl'), JSON.stringify(dump) + '\n');

    patchImageOptimizerOnDisk(projectRoot, debugDir);

    const probePath = ensureFetchProbeOnDisk();
    env.ANT_DEBUG_IMAGE_FETCH_DIR = debugDir;
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require=${probePath}`.trim();
  } catch (err: any) {
    logger.warn(
      `[Preview] image-fetch diagnostic setup failed: ${err?.message ?? err}`,
      { component: 'ProcessSpawner' },
    );
  }
}
// === END image-fetch diagnostic =========================================

export interface SpawnOptions {
  serverKey: string;
  /**
   * Per-package urlKey used for basePath injection.
   *
   * Single-frontend project → 4-part `toUrlKey(serverKey)`.
   * Multi-frontend monorepo → 5-part `toUrlKeyWithService(serverKey, slug)`.
   *
   * Required for frontend packages (drives `ANT_BASE_PATH` / `VITE_BASE_PATH`
   * / `NEXT_PUBLIC_BASE_PATH`). Backend / other packages may omit.
   */
  packageUrlKey?: string;
  /** Project root path for loading root-level .env (monorepo support). */
  projectRoot?: string;
  extraEnv?: Record<string, string | undefined>;
  connections?: ServiceConnection[];
  /** Package subdirectory relative to project root (e.g. 'packages/frontend'). Used to filter connections by source. */
  packageSource?: string;
  onLog: LogCallback;
  onExit: ExitCallback;
  onError: (error: Error) => void;
}

export interface OrphanProcess {
  pid: number;
  command: string;
  cwd?: string;
}

/**
 * ProcessSpawner
 *
 * Handles spawning dev server processes for different package types.
 * Supports Vite, Next.js, React Scripts, and generic npm scripts.
 *
 * Process termination, descendant collection, port-based fallback kill
 * and Next dev lock handling are delegated to {@link DevProcessControl}
 * (SSOT). This class should not reimplement any kill / lsof / pgrep
 * logic — call the injected `dev` instance instead.
 */
export class ProcessSpawner {
  private readonly dev: DevProcessControl;

  constructor(dev?: DevProcessControl) {
    this.dev = dev ?? getDefaultDevProcessControl();
  }

  /**
   * Find orphan dev-server processes whose ps line contains any of the
   * given paths. Accepts a single path (back-compat) or an array of
   * cwds (project root + per-package paths). Pure read — never kills.
   */
  findOrphanProcesses(codebasePathOrPaths: string | string[]): OrphanProcess[] {
    const cwds = Array.isArray(codebasePathOrPaths) ? codebasePathOrPaths : [codebasePathOrPaths];
    // detect() is async but findProcessesByCwd part is purely sync; we use
    // the Promise here for API symmetry. Callers wanting the simpler sync
    // semantics typically use `killOrphanProcesses` (Promise-returning).
    // Note: this synchronous call uses ps inside execFileSync — safe.
    // We call the private path indirectly via detect with empty ports.
    // Wrap with a deasyncified read by short-circuiting: detect may run
    // pgrep-less branches and is in practice synchronous for our inputs.
    // For strict typing we do return an empty array if anything throws.
    try {
      const out: OrphanProcess[] = [];
      // We deliberately bypass detect() here to avoid awaiting in callers
      // that haven't migrated; reach into the same primitive instead.
      const psOutput = execFileSync('ps', ['aux'], {
        encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'],
      });
      const runtimePattern = /node|next|vite|npm|pnpm|yarn/;
      for (const line of psOutput.split('\n')) {
        if (!runtimePattern.test(line)) continue;
        const matched = cwds.find(c => c && line.includes(c));
        if (!matched) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;
        const pid = parseInt(parts[1], 10);
        if (isNaN(pid)) continue;
        out.push({ pid, command: parts.slice(10).join(' '), cwd: matched });
      }
      logger.debug(`Found ${out.length} orphan process(es) across ${cwds.length} cwd(s)`, { component: 'ProcessSpawner' });
      return out;
    } catch (error: any) {
      logger.debug(`Error finding orphan processes: ${error.message}`, { component: 'ProcessSpawner' });
      return [];
    }
  }

  /**
   * Kill orphan processes (and their descendant trees) under the given
   * codebase path(s). Returns number of unique parents that were targeted.
   *
   * Multi-cwd form: pass an array to scan project root + every package
   * cwd in one shot — preferred over per-cwd loops since `pgrep`/`lsof`
   * each have setup cost.
   */
  async killOrphanProcesses(codebasePathOrPaths: string | string[]): Promise<number> {
    const cwds = Array.isArray(codebasePathOrPaths) ? codebasePathOrPaths : [codebasePathOrPaths];
    const orphans = this.findOrphanProcesses(cwds);
    if (orphans.length === 0) return 0;

    let killed = 0;
    for (const orphan of orphans) {
      try {
        await this.dev.killTree(orphan.pid);
        killed++;
      } catch (error: any) {
        if (error.code !== 'ESRCH') {
          logger.warn(`Failed to killTree orphan PID=${orphan.pid}: ${error.message}`, { component: 'ProcessSpawner' });
        }
      }
    }

    if (killed > 0) {
      logger.info(`Cleaned up ${killed} orphan process tree(s) across ${cwds.length} cwd(s)`, { component: 'ProcessSpawner' });
    }
    return killed;
  }

  /**
   * Check if a port is in use
   */
  async isPortInUse(port: number): Promise<boolean> {
    const found = await this.dev.detect({ cwds: [], ports: [port] });
    return found.some(f => f.source === 'port' && f.port === port);
  }

  /**
   * Kill any process listening on the given port (process-tree aware via DPC).
   * Returns true when at least one PID was found and targeted.
   */
  async killProcessOnPort(port: number): Promise<boolean> {
    const found = await this.dev.detect({ cwds: [], ports: [port] });
    if (found.length === 0) return false;
    await this.dev.forceCleanup(found);
    return true;
  }
  /**
   * Load environment variables from .env files.
   *
   * Two-level loading (like Nx / Docker Compose):
   *   1. projectRoot .env / .env.local  (workspace-level defaults)
   *   2. packagePath .env / .env.local  (package-level overrides)
   *
   * Package-level values take precedence over project-root values.
   */
  loadProjectEnv(packagePath: string, projectRoot?: string): Record<string, string> {
    const result: Record<string, string> = {};

    const dirsToLoad: string[] = [];
    if (projectRoot && path.resolve(projectRoot) !== path.resolve(packagePath)) {
      dirsToLoad.push(projectRoot);
    }
    dirsToLoad.push(packagePath);

    for (const dir of dirsToLoad) {
      for (const fileName of ['.env', '.env.local']) {
        const filePath = path.join(dir, fileName);
        if (!fs.existsSync(filePath)) continue;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) continue;
            const key = trimmed.substring(0, eqIndex).trim();
            let value = trimmed.substring(eqIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            result[key] = value;
          }
        } catch (err) {
          logger.warn(`[ProcessSpawner] Failed to parse ${filePath}: ${err}`, { component: 'ProcessSpawner' });
        }
      }
    }

    return result;
  }

  /**
   * Build merged environment from connections, filtered by package source.
   * Only injects env vars belonging to the target package (or global '*').
   */
  private connectionsToEnv(connections?: ServiceConnection[], packageSource?: string): Record<string, string> {
    if (!connections?.length) return {};
    const result: Record<string, string> = {};
    for (const conn of connections) {
      if (!conn.envVar || !conn.value) continue;
      if (conn.source === '*' || !packageSource || conn.source === packageSource) {
        result[conn.envVar] = conn.value;
      }
    }
    return result;
  }

  /**
   * Spawn dev process for a package.
   * Dispatches to language-specific spawn based on projectProfile.
   */
  spawn(pkg: PackageInfo, port: number, options: SpawnOptions): ChildProcess {
    const lang = (pkg.projectProfile?.language || 'typescript').toLowerCase();
    
    switch (lang) {
      case 'typescript':
      case 'javascript':
        return this.spawnNode(pkg, port, options);
      case 'go':
      case 'python':
      case 'rust':
      case 'java':
      default:
        return this.spawnByLanguage(pkg, port, lang, options);
    }
  }
  
  /**
   * Spawn Node.js / TypeScript dev process (vite, next, npm run dev, etc.)
   */
  private spawnNode(pkg: PackageInfo, port: number, options: SpawnOptions): ChildProcess {
    const pkgJson = pkg.packageJson;
    const devScript = pkgJson?.scripts?.dev || pkgJson?.scripts?.start;
    
    let command: string;
    let args: string[] = [];
    
    // Determine command based on package type and script content
    const isNextJs = devScript?.includes('next');
    
    if (pkg.type === 'frontend') {
      if (devScript?.includes('vite')) {
        command = 'npx';
        args = ['vite', '--port', port.toString(), '--host', '0.0.0.0'];
      } else if (isNextJs) {
        command = 'npx';
        args = ['next', 'dev', '-p', port.toString(), '--hostname', '0.0.0.0'];
      } else if (devScript?.includes('react-scripts')) {
        command = 'npm';
        args = ['run', 'dev'];
      } else {
        command = 'npm';
        args = ['run', 'dev'];
      }
    } else if (pkg.type === 'backend') {
      command = 'npm';
      args = ['run', 'dev'];
    } else {
      command = 'npm';
      args = ['run', 'dev'];
    }
    
    // Inject base path environment variables for ALL frontend frameworks.
    // Every framework uses its native base path mechanism so that
    // the proxy can always keep the URL key prefix and stream responses
    // without any HTML rewriting.
    //
    // Framework-specific env vars:
    //   Next.js:  NEXT_PUBLIC_BASE_PATH  → next.config.js basePath
    //   Vite:     VITE_BASE_PATH         → vite.config.ts base
    // Universal:  ANT_BASE_PATH          → generic fallback for custom setups
    //
    const basePathEnv: Record<string, string> = {};
    if (pkg.type === 'frontend' && options.packageUrlKey) {
      // Per-package basePath. For multi-frontend monorepos this is a
      // 5-part urlKey carrying the package slug, so each frontend dev
      // server is reachable at a unique URL prefix without overlap.
      const basePath = `/${options.packageUrlKey}`;

      basePathEnv.ANT_BASE_PATH = basePath;

      if (isNextJs) {
        basePathEnv.NEXT_PUBLIC_BASE_PATH = basePath;
      } else if (devScript?.includes('vite')) {
        basePathEnv.VITE_BASE_PATH = basePath;
      }

    }
    
    // Environment variable priority (low to high):
    //   1. process.env (system)
    //   2. project root .env / .env.local (workspace-level)
    //   3. package .env / .env.local (package-level override)
    //   4. connections[].envVar=value
    //   5. platform injected (PORT, base path, polling)
    //   6. extraEnv (caller override)
    const projectEnv = this.loadProjectEnv(pkg.path, options.projectRoot);
    const connectionsEnv = this.connectionsToEnv(options.connections, options.packageSource);

    const env: Record<string, string | undefined> = {
      ...process.env,
      ...projectEnv,
      ...connectionsEnv,
      PORT: port.toString(),
      NODE_ENV: 'development',
      BROWSER: 'none',
      BROWSER_ARGS: '--no-sandbox',
      CHOKIDAR_USEPOLLING: 'true',
      CHOKIDAR_INTERVAL: '3000',
      WATCHPACK_POLLING: 'true',
      ...basePathEnv,
      ...(options.extraEnv || {})
    };

    // TEMPORARY: image-fetch diagnostic. Remove once root cause is confirmed.
    setupImageFetchDiagnostic(env, options, pkg);

    logger.warn(`[Preview] Starting ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'ProcessSpawner' });
    logger.warn(`[Preview] Command: ${command} ${args.join(' ')}`, { component: 'ProcessSpawner' });
    options.onLog('stdout', `🚀 Starting ${pkg.name} (${pkg.type}) on port ${port}...`);
    options.onLog('stdout', `📋 Command: ${command} ${args.join(' ')}`);
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      detached: true,
      env,
      stdio: 'pipe'
    });
    
    logger.warn(`[Preview] Process spawned PID=${childProcess.pid}`, { component: 'ProcessSpawner' });
    
    // Setup logging
    childProcess.stdout?.on('data', (data) => {
      options.onLog('stdout', data.toString());
    });
    
    childProcess.stderr?.on('data', (data) => {
      options.onLog('stderr', data.toString());
    });
    
    childProcess.on('close', (code, signal) => {
      logger.info(`Process exited PID=${childProcess.pid} code=${code}`, { component: 'ProcessSpawner' });
      options.onExit(code, signal, childProcess.pid ?? undefined);
    });
    
    childProcess.on('error', (error) => {
      logger.error(`Process error PID=${childProcess.pid}: ${error.message}`, { component: 'ProcessSpawner' }, error);
      options.onError(error);
    });
    
    return childProcess;
  }
  
  /**
   * Spawn dev process by language (Go, Python, Rust, Java, etc.).
   * Checks Makefile first for dev/run/serve targets, then uses language-specific commands.
   */
  private spawnByLanguage(pkg: PackageInfo, port: number, language: string, options: SpawnOptions): ChildProcess {
    let command: string;
    let args: string[] = [];
    
    // Check Makefile for dev/run/serve targets first (language-agnostic)
    const makefileTarget = this.detectMakefileTarget(pkg.path);
    if (makefileTarget) {
      const requiredCommand = this.getRequiredCommand(language);
      if (requiredCommand && !this.isCommandAvailable(requiredCommand)) {
        options.onLog('stderr', `❌ ${language} toolchain (${requiredCommand}) is not installed. Makefile target '${makefileTarget}' will likely fail.`);
        throw new Error(`${language} toolchain not found in PATH. Cannot start dev server.`);
      }
      command = 'make';
      args = [makefileTarget];
    } else {
      // Language-specific fallback
      switch (language) {
        case 'go':
          if (!this.isCommandAvailable('go')) {
            options.onLog('stderr', '❌ Go toolchain is not installed in this environment. Install Go (https://go.dev/dl/) or use a runtime image that includes it.');
            throw new Error('Go toolchain not found in PATH. Cannot start Go dev server.');
          }
          command = 'go';
          args = ['run', '.'];
          break;
        case 'python': {
          const framework = pkg.projectProfile?.framework?.toLowerCase();
          if (framework === 'django') {
            command = 'python';
            args = ['manage.py', 'runserver', `0.0.0.0:${port}`];
          } else if (framework === 'fastapi') {
            command = 'uvicorn';
            args = ['main:app', '--host', '0.0.0.0', '--port', port.toString(), '--reload'];
          } else if (framework === 'flask') {
            command = 'flask';
            args = ['run', '--host', '0.0.0.0', '--port', port.toString()];
          } else {
            command = 'python';
            args = ['main.py'];
          }
          break;
        }
        case 'rust':
          command = 'cargo';
          args = ['run'];
          break;
        case 'java':
          if (fs.existsSync(path.join(pkg.path, 'gradlew'))) {
            command = './gradlew';
            args = ['bootRun'];
          } else {
            command = 'mvn';
            args = ['spring-boot:run'];
          }
          break;
        default:
          // Unknown language: try make or fail gracefully
          command = 'echo';
          args = [`Unsupported language: ${language}`];
          break;
      }
    }
    
    this.ensureConfigFiles(pkg.path, options.onLog);

    const projectEnv = this.loadProjectEnv(pkg.path, options.projectRoot);
    const connectionsEnv = this.connectionsToEnv(options.connections, options.packageSource);

    const env = {
      ...process.env,
      ...projectEnv,
      ...connectionsEnv,
      PORT: port.toString(),
      ...(options.extraEnv || {})
    };
    
    logger.warn(`[Preview] Starting ${language} ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'ProcessSpawner' });
    logger.warn(`[Preview] Command: ${command} ${args.join(' ')}`, { component: 'ProcessSpawner' });
    options.onLog('stdout', `🚀 Starting ${pkg.name} (${language}) on port ${port}...`);
    options.onLog('stdout', `📋 Command: ${command} ${args.join(' ')}`);
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      detached: true,
      env,
      stdio: 'pipe'
    });
    
    logger.warn(`[Preview] Process spawned PID=${childProcess.pid}`, { component: 'ProcessSpawner' });
    
    childProcess.stdout?.on('data', (data) => options.onLog('stdout', data.toString()));
    childProcess.stderr?.on('data', (data) => options.onLog('stderr', data.toString()));
    
    childProcess.on('close', (code, signal) => {
      logger.info(`Process exited PID=${childProcess.pid} code=${code}`, { component: 'ProcessSpawner' });
      options.onExit(code, signal, childProcess.pid ?? undefined);
    });
    
    childProcess.on('error', (error) => {
      logger.error(`Process error PID=${childProcess.pid}: ${error.message}`, { component: 'ProcessSpawner' }, error);
      options.onError(error);
    });
    
    return childProcess;
  }
  
  /**
   * Copy *.example config files to their actual counterparts if missing.
   * Skips .env.example (handled separately by connection detection).
   * Searches project root and immediate subdirectories (depth 1).
   */
  private ensureConfigFiles(projectPath: string, onLog: LogCallback): void {
    const dirsToScan = [projectPath];

    try {
      for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor') {
          const subdir = path.join(projectPath, entry.name);
          dirsToScan.push(subdir);
          // depth 2: one more level for patterns like services/api-server/
          try {
            for (const sub of fs.readdirSync(subdir, { withFileTypes: true })) {
              if (sub.isDirectory() && !sub.name.startsWith('.') && sub.name !== 'node_modules' && sub.name !== 'vendor') {
                dirsToScan.push(path.join(subdir, sub.name));
              }
            }
          } catch { /* permission errors, etc. */ }
        }
      }
    } catch { /* permission errors, etc. */ }

    for (const dir of dirsToScan) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          let actualName: string | null = null;

          // Pattern 1: *.example -> * (e.g. config.example -> config)
          if (file.endsWith('.example')) {
            if (file === '.env.example') continue;
            actualName = file.replace(/\.example$/, '');
          }

          // Pattern 2: *.example.toml -> *.toml (e.g. config.example.toml -> config.toml)
          const tomlExampleMatch = file.match(/^(.+)\.example\.toml$/);
          if (tomlExampleMatch) {
            actualName = `${tomlExampleMatch[1]}.toml`;
          }

          if (!actualName) continue;

          const examplePath = path.join(dir, file);
          const actualPath = path.join(dir, actualName);

          if (!fs.existsSync(actualPath)) {
            try {
              fs.copyFileSync(examplePath, actualPath);
              const relPath = path.relative(projectPath, actualPath);
              logger.info(`[Preview] Auto-created ${relPath} from ${file}`, { component: 'ProcessSpawner' });
              onLog('stdout', `📋 Auto-created ${relPath} from ${file}\n`);
            } catch (err) {
              logger.warn(`[Preview] Failed to copy ${examplePath}: ${err}`, { component: 'ProcessSpawner' });
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
  }

  private getRequiredCommand(language: string): string | null {
    const toolchainMap: Record<string, string> = {
      go: 'go',
      python: 'python',
      rust: 'cargo',
      java: 'java',
    };
    return toolchainMap[language] ?? null;
  }

  /**
   * Detect runnable Makefile target (dev, run, serve)
   */
  private detectMakefileTarget(projectPath: string): string | null {
    try {
      const makefilePath = path.join(projectPath, 'Makefile');
      if (!fs.existsSync(makefilePath)) return null;
      
      const content = fs.readFileSync(makefilePath, 'utf-8');
      // Prefer 'dev' > 'run' > 'serve' order
      for (const target of ['dev', 'run', 'serve']) {
        if (new RegExp(`^${target}:`, 'm').test(content)) {
          return target;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  
  /**
   * Terminate a spawned dev-server process and its entire descendant tree.
   *
   * Delegates to {@link DevProcessControl.killTree} which handles:
   *   - process-group SIGTERM
   *   - descendant SIGTERM via `pgrep -P` BFS
   *   - polled wait for graceful exit
   *   - SIGKILL escalation for any survivors
   *
   * Fire-and-forget contract preserved (returns boolean) — internal
   * escalation runs in the background but callers that need to await
   * exit should listen on `childProcess.once('exit')` themselves.
   */
  kill(childProcess: ChildProcess): boolean {
    try {
      if (childProcess.killed) return false;
      void this.dev.killTree(childProcess).catch(err => {
        logger.warn(`killTree failed for PID=${childProcess.pid}`, { component: 'ProcessSpawner' }, err);
      });
      return true;
    } catch (error) {
      logger.warn(`Failed to kill process`, { component: 'ProcessSpawner' }, error);
      return false;
    }
  }

  /**
   * Awaitable variant of {@link kill}. Use when callers need confirmed
   * exit before the next step (e.g. `stopPreview` cleanup chain).
   */
  async killAndWait(childProcess: ChildProcess, opts?: { graceMs?: number }): Promise<void> {
    if (childProcess.killed) return;
    await this.dev.killTree(childProcess, opts);
  }

  /** Expose the DPC instance for callers that need detect/lock cleanup. */
  getDevProcessControl(): DevProcessControl {
    return this.dev;
  }

  private isCommandAvailable(cmd: string): boolean {
    try {
      execFileSync('which', [cmd], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

}

