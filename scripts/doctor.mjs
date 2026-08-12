#!/usr/bin/env node
/**
 * doctor.mjs — install self-check ("did my install work?").
 *
 * Read-only: probes versions, Redis, the four Ant processes, and provider
 * keys. Modifies nothing, mutates no env, and stays runnable BEFORE
 * `pnpm install` (Node builtins only; richer checks degrade to WARN).
 *
 * Usage:
 *   pnpm doctor            # all checks except live key validation
 *   pnpm doctor --live     # also validate provider keys against the provider
 *   pnpm doctor --json     # machine-readable output
 *
 * Exit codes:
 *   0 — no FAILs (WARNs allowed)
 *   1 — one or more FAILs
 *   2 — doctor itself errored
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');
const JSON_OUT = process.argv.includes('--json');
const TIMEOUT_MS = 3000;

// ── env resolution: shell env wins over packages/ant-cli/.env ──────────────
/** Minimal .env parser (dotenv may not be installed yet). */
function parseDotEnv(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    } else {
      const hash = v.indexOf(' #');
      if (hash !== -1) v = v.slice(0, hash);
    }
    out[m[1]] = v.trim();
  }
  return out;
}

const ENV_FILE = path.join(ROOT, 'packages/ant-cli/.env');
const dotEnv = parseDotEnv(ENV_FILE);
const env = (key) => process.env[key] ?? dotEnv[key];

// Keep the literal in sync with packages/ant-cli/src/core/config/redisUrl.ts
// (this script cannot import TS; the constant is cross-referenced there).
const DEFAULT_LOCAL_REDIS_URL = 'redis://localhost:16379';
const serverMode = env('ANT_SERVER_MODE') || 'local';
const redisUrl =
  env('ANT_REDIS_URL')?.trim() || (serverMode !== 'cloud' ? DEFAULT_LOCAL_REDIS_URL : undefined);
const apiBase = env('ANT_API_URL') || 'http://localhost:4100';

// Fallback list; the SSOT is PROVIDER_API_KEY_ENV in @ant/shared/models.ts —
// borrowed from the built dist below when available.
let providerKeyEnv = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  glm: 'GLM_API_KEY',
  kimi: 'KIMI_API_KEY',
};
try {
  const req = createRequire(path.join(ROOT, 'packages/ant-cli/package.json'));
  const shared = req('@ant/shared');
  if (shared?.PROVIDER_API_KEY_ENV) providerKeyEnv = shared.PROVIDER_API_KEY_ENV;
} catch {
  /* pre-install / dist absent — the literal fallback above is used */
}

// ── check harness ───────────────────────────────────────────────────────────
const results = [];
function report(name, status, detail, fix) {
  results.push({ name, status, detail, fix });
}

function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** Connection failures surface as AggregateError with an empty message. */
function errText(e) {
  return e.code || e.message || e.errors?.[0]?.code || e.errors?.[0]?.message || String(e);
}

/** Send RESP commands over a raw socket; returns array of reply lines. */
function redisCommand(url, commands) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new Error(`unparseable URL: ${e.message}`));
    }
    const socket = net.createConnection({
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port) || 6379,
    });
    const replies = [];
    let buffer = '';
    const queue = [...commands];
    if (parsed.password) queue.unshift(['AUTH', ...(parsed.username ? [parsed.username] : []), parsed.password]);
    const expected = queue.length;

    const send = (args) => {
      let cmd = `*${args.length}\r\n`;
      for (const a of args) cmd += `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`;
      socket.write(cmd);
    };
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.on('error', reject);
    socket.on('connect', () => queue.forEach(send));
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      // Replies are either single-line (+OK / -ERR / :n) or bulk ($len\r\ndata).
      while (replies.length < expected) {
        const nl = buffer.indexOf('\r\n');
        if (nl === -1) return;
        const head = buffer.slice(0, nl);
        if (head.startsWith('$')) {
          const len = Number(head.slice(1));
          if (len === -1) {
            replies.push(null);
            buffer = buffer.slice(nl + 2);
            continue;
          }
          if (buffer.length < nl + 2 + len + 2) return; // wait for full bulk
          replies.push(buffer.slice(nl + 2, nl + 2 + len));
          buffer = buffer.slice(nl + 2 + len + 2);
        } else {
          replies.push(head);
          buffer = buffer.slice(nl + 2);
        }
      }
      socket.end();
      resolve(replies);
    });
  });
}

// ── checks ──────────────────────────────────────────────────────────────────
function checkNode() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const required = pkg.engines?.node ?? '>=22.13';
  const [reqMajor, reqMinor = 0] = required.replace(/[^\d.]/g, '').split('.').map(Number);
  const [major, minor] = process.version.slice(1).split('.').map(Number);
  const ok = major > reqMajor || (major === reqMajor && minor >= reqMinor);
  report('node', ok ? 'PASS' : 'FAIL', `${process.version} (need ${required})`,
    ok ? undefined : 'install Node >= 22.13 (e.g. nvm install 22)');
}

function checkPnpm() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pinned = (pkg.packageManager || '').split('@')[1];
  const r = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    report('pnpm', 'FAIL', 'pnpm not found',
      `corepack enable && corepack prepare pnpm@${pinned} --activate`);
    return;
  }
  const version = r.stdout.trim();
  if (version === pinned) report('pnpm', 'PASS', version);
  else report('pnpm', 'WARN', `${version} (pinned: ${pinned})`,
    `corepack prepare pnpm@${pinned} --activate`);
}

function checkInstallState() {
  const missing = ['node_modules', 'packages/ant-cli/node_modules']
    .filter((p) => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length) {
    report('install', 'FAIL', `missing: ${missing.join(', ')}`, 'pnpm install');
    return;
  }
  if (!fs.existsSync(path.join(ROOT, 'packages/ant-shared/dist'))) {
    report('install', 'WARN', '@ant/shared/dist absent', 'pnpm build:shared');
    return;
  }
  report('install', 'PASS', 'workspace installed');
}

function checkEnvFile() {
  if (fs.existsSync(ENV_FILE)) report('.env', 'PASS', 'packages/ant-cli/.env present');
  else report('.env', 'WARN', 'packages/ant-cli/.env absent (local mode boots on defaults, but no provider key means no LLM calls)',
    'cp packages/ant-cli/.env.example.local packages/ant-cli/.env');
}

function checkMode() {
  report('mode', serverMode === 'cloud' ? 'WARN' : 'PASS',
    `ANT_SERVER_MODE=${serverMode}${env('ANT_SERVER_MODE') ? '' : ' (default)'}`,
    serverMode === 'cloud' ? 'doctor targets local mode; cloud checks may not apply' : undefined);
}

async function checkRedis() {
  if (!redisUrl) {
    report('redis', 'FAIL', 'cloud mode with no ANT_REDIS_URL (no default)', 'set ANT_REDIS_URL');
    return;
  }
  try {
    const [pong] = await redisCommand(redisUrl, [['PING']]);
    if (pong === '+PONG' || pong === 'PONG') report('redis', 'PASS', redisUrl);
    else report('redis', 'FAIL', `${redisUrl} → ${pong}`, 'pnpm dev:infra:redis (or docker compose up redis)');
  } catch (e) {
    report('redis', 'FAIL', `${redisUrl} → ${errText(e)}`, 'pnpm dev:infra:redis (or docker compose up redis)');
  }
}

async function checkHttp(name, url, fix) {
  try {
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      report(name, 'PASS', `${url} → ${res.status}`);
      return true;
    }
    report(name, 'FAIL', `${url} → ${res.status}`, fix);
  } catch (e) {
    report(name, 'FAIL', `${url} → ${e.cause?.code || errText(e)}`, fix);
  }
  return false;
}

async function checkApi() {
  // Health routes are mounted under /api on ant-api (/health alone 404s).
  const up = await checkHttp('ant-api', `${apiBase}/api/health`, 'pnpm dev:api-server');
  if (!up) return null;
  try {
    const res = await fetchWithTimeout(`${apiBase}/api/system/config`);
    const config = await res.json();
    report('config', 'PASS',
      `authMode=${config.authMode ?? '?'} billing=${config.capabilities?.billing ?? '?'}`);
    return config;
  } catch {
    report('config', 'WARN', 'GET /api/system/config unreadable');
    return null;
  }
}

async function checkJobWorker() {
  if (!redisUrl) return; // already FAILed in checkRedis
  try {
    const [list] = await redisCommand(redisUrl, [['CLIENT', 'LIST']]);
    if (typeof list !== 'string') {
      report('ant-job', 'WARN', 'CLIENT LIST unavailable — cannot verify worker');
      return;
    }
    // Heuristic: an idle BullMQ worker parks in a blocking bzpopmin on the
    // queue marker; some setups also name connections after the queue.
    const active = list.split('\n').some(
      (l) => l.includes('cmd=bzpopmin') || l.includes('name=ant-jobs') || l.includes('cmd=brpoplpush')
    );
    if (active) report('ant-job', 'PASS', 'BullMQ worker connection detected (heuristic)');
    else report('ant-job', 'FAIL', 'no BullMQ worker connection on Redis (heuristic)', 'pnpm dev:job-worker');
  } catch (e) {
    report('ant-job', 'WARN', `worker probe failed: ${errText(e)}`);
  }
}

async function checkProviderKeys(config) {
  // Runtime SSOT when the API is up; env/.env presence otherwise.
  if (config) {
    try {
      const res = await fetchWithTimeout(`${apiBase}/api/models`);
      const { configuredProviders } = await res.json();
      if (configuredProviders?.length) {
        report('providers', 'PASS', configuredProviders.join(', '));
        return;
      }
      report('providers', 'FAIL', 'no provider configured (per /api/models)',
        'set ANTHROPIC_API_KEY in packages/ant-cli/.env and restart');
      return;
    } catch {
      /* fall through to env presence */
    }
  }
  const configured = [];
  const placeholders = [];
  for (const [provider, key] of Object.entries(providerKeyEnv)) {
    const value = env(key);
    if (!value) continue;
    if (/^(your-|<)/.test(value)) placeholders.push(provider);
    else configured.push(provider);
  }
  if (configured.length) {
    report('providers', 'PASS', configured.join(', ') +
      (placeholders.length ? ` (placeholder ignored: ${placeholders.join(', ')})` : ''));
  } else if (placeholders.length) {
    report('providers', 'FAIL', `only placeholder values (${placeholders.join(', ')})`,
      'replace the placeholder key in packages/ant-cli/.env with a real one');
  } else {
    report('providers', 'FAIL', 'no provider API key set',
      'set ANTHROPIC_API_KEY in packages/ant-cli/.env');
  }
}

async function checkLiveKeys() {
  const probes = {
    anthropic: (key) => fetchWithTimeout('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }),
    openai: (key) => fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    }),
    google: (key) =>
      fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`),
  };
  for (const [provider, probe] of Object.entries(probes)) {
    const key = env(providerKeyEnv[provider]);
    if (!key || /^(your-|<)/.test(key)) continue;
    try {
      const res = await probe(key);
      if (res.ok) report(`key:${provider}`, 'PASS', 'accepted by provider');
      else report(`key:${provider}`, 'FAIL', `provider returned ${res.status}`,
        'key rejected — regenerate it in the provider console');
    } catch (e) {
      report(`key:${provider}`, 'WARN', `probe failed: ${e.cause?.code || errText(e)}`);
    }
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
try {
  checkNode();
  checkPnpm();
  checkInstallState();
  checkEnvFile();
  checkMode();
  await checkRedis();
  const config = await checkApi();
  await checkHttp('ant-realtime', 'http://localhost:4101/health', 'pnpm dev:realtime-server');
  await checkHttp('ant-preview', 'http://localhost:4102/health', 'pnpm dev:preview-server');
  await checkJobWorker();
  await checkProviderKeys(config);
  if (LIVE) await checkLiveKeys();
} catch (e) {
  console.error(`doctor errored: ${e.stack || e}`);
  process.exit(2);
}

const failed = results.filter((r) => r.status === 'FAIL');
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    let line = ` ${icon[r.status]} ${r.name.padEnd(width)}  ${r.detail}`;
    if (r.fix && r.status !== 'PASS') line += `\n   ${' '.repeat(width)}  → ${r.fix}`;
    console.log(line);
  }
  const warns = results.filter((r) => r.status === 'WARN').length;
  console.log(`\n${failed.length === 0 ? 'All checks passed' : `${failed.length} check(s) failed`}${warns ? ` (${warns} warning${warns > 1 ? 's' : ''})` : ''}.`);
  if (!LIVE) console.log('Tip: pnpm doctor --live also validates provider keys against the provider.');
}
process.exit(failed.length === 0 ? 0 : 1);
