/**
 * Verification Scenario — L2 runner library.
 *
 * Pipeline per scenario:
 *   1. Load & validate `scenario.json` against `ScenarioConfig`.
 *   2. Copy `feature/` fixture to `.ant-test/scenario-runs/<runId>/…`.
 *   3. Write `session.seed.json` to `sessions/architect/<job>.json`.
 *   4. Spawn `ant-cli resume-job` as a child process with an env built from
 *      the scenario's mode (`real | overlay | stub`) + `ANT_COMMAND_INJECT`.
 *   5. After the child exits, load `sessions/architect/<job>.json` and run
 *      `assertExpectedOutcome` against it.
 *   6. Apply --keep / --max-runs GC policy.
 *
 * This module is imported both by the CLI entry (`scripts/verify-scenario.ts`)
 * and by the smoke test (`runner.test.ts`). The CLI layer ONLY handles
 * argv parsing and `process.exit` — all orchestration lives here.
 *
 * Design notes:
 *   - Real LLM mode (`--real-llm`) is opt-in and requires network + API keys.
 *     Default `ANT_LLM_MOCK=true` keeps runs deterministic.
 *   - `ANT_REDIS_URL` is deliberately *unset* before spawning. With it set,
 *     orchestrator.ts initializes realtime broadcasters, which require actual
 *     Redis infrastructure we do not want running during scenarios.
 *   - The child spawn uses `tsx` via `pnpm resume-job` so we don't depend on
 *     the built `dist/`. This keeps the scenario cycle O(node startup), which
 *     is ~600ms on a dev laptop.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import type {
  ScenarioConfig,
  ScenarioSessionSeed,
  ScenarioRunResult,
} from '@ant/shared';
import { assertExpectedOutcome } from './diff';
import { readTraceFile, type TraceEntry } from '../../../src/utils/verificationTrace';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Paths / constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Monorepo root — `packages/ant-cli` lives under it. */
export const ANT_CLI_ROOT = path.resolve(__dirname, '..', '..', '..');
export const REPO_ROOT = path.resolve(ANT_CLI_ROOT, '..', '..');
export const SCENARIOS_DIR = path.join(ANT_CLI_ROOT, 'tests', 'verification', 'scenarios', 'scenarios');
export const RUNS_ROOT = path.join(REPO_ROOT, '.ant-test', 'scenario-runs');

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024; // 32 MB

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Options
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type KeepPolicy = 'fail' | 'all' | 'none';

export interface RunnerOptions {
  realLLM?: boolean;
  keep?: KeepPolicy;
  maxRuns?: number;
  verbose?: boolean;
}

export interface ScenarioDescriptor {
  id: string;                // Sxx
  dirName: string;           // Sxx-<name>
  dirPath: string;           // absolute path
  config: ScenarioConfig;
  hasInject: boolean;
  hasLLMMock: boolean;
  hasFeature: boolean;
  hasSeed: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Discovery
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function listScenarios(): ScenarioDescriptor[] {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  const entries = fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true });
  const results: ScenarioDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const match = dirName.match(/^(S\d{2})(?:-(.+))?$/);
    if (!match) continue;
    const dirPath = path.join(SCENARIOS_DIR, dirName);
    const configPath = path.join(dirPath, 'scenario.json');
    if (!fs.existsSync(configPath)) continue;
    let config: ScenarioConfig;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ScenarioConfig;
    } catch (err) {
      throw new Error(`Invalid scenario.json at ${configPath}: ${(err as Error).message}`);
    }
    validateScenarioConfig(config, configPath);
    results.push({
      id: match[1],
      dirName,
      dirPath,
      config,
      hasInject: fs.existsSync(path.join(dirPath, 'inject.json')),
      hasLLMMock: fs.existsSync(path.join(dirPath, 'llm-mock')),
      hasFeature: fs.existsSync(path.join(dirPath, 'feature')),
      hasSeed: fs.existsSync(path.join(dirPath, 'session.seed.json')),
    });
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

function validateScenarioConfig(config: ScenarioConfig, source: string): void {
  const problems: string[] = [];
  if (!config.name || typeof config.name !== 'string') problems.push('`name` must be a non-empty string');
  if (!config.mode || !['real', 'overlay', 'stub'].includes(config.mode)) {
    problems.push('`mode` must be one of: real | overlay | stub');
  }
  if (!config.expected || typeof config.expected !== 'object') problems.push('`expected` must be an object');
  if (problems.length > 0) {
    throw new Error(`Invalid scenario config at ${source}:\n  - ${problems.join('\n  - ')}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Single scenario execution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runScenario(
  descriptor: ScenarioDescriptor,
  opts: RunnerOptions = {},
): Promise<ScenarioRunResult> {
  const started = Date.now();
  const warnings: string[] = [];

  // Guard rails — doc §7.
  if (descriptor.config.mode === 'real' && descriptor.hasInject) {
    throw new Error(`Scenario ${descriptor.id}: mode=real must not ship inject.json`);
  }
  if (descriptor.config.mode === 'overlay' && !descriptor.hasInject) {
    warnings.push(`mode=overlay without inject.json — overlay has no effect`);
  }
  if (descriptor.config.mode === 'stub' && !descriptor.hasInject) {
    warnings.push(`mode=stub without inject.json — every command will run for real`);
  }

  const runId = `${descriptor.id}-${formatTimestamp(new Date())}`;
  const runDir = path.join(RUNS_ROOT, runId);
  const org = 'local';
  const user = 'test';
  const project = 'verification';
  const feature = descriptor.id;
  const featurePath = path.join(runDir, org, user, project, 'features', feature);
  const projectPath = path.join(runDir, org, user, project);

  fs.mkdirSync(path.join(featurePath, 'sessions', 'architect'), { recursive: true });
  fs.mkdirSync(path.join(featurePath, 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(featurePath, 'outputs'), { recursive: true });
  fs.mkdirSync(path.join(featurePath, 'codebase'), { recursive: true });

  // Write project config so FileConfigAdapter.load() succeeds.
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({
    projectName: project,
    repoType: 'local',
    localPath: path.join(featurePath, 'codebase'),
  }, null, 2));

  // Copy feature fixture (if present) into codebase/.
  const fixtureFeature = path.join(descriptor.dirPath, 'feature');
  if (fs.existsSync(fixtureFeature)) {
    copyDirectory(fixtureFeature, path.join(featurePath, 'codebase'));
  }

  // Seed the session file. Wrap in the `{ state: … }` envelope FileSessionAdapter expects.
  const seed: ScenarioSessionSeed = JSON.parse(
    fs.readFileSync(path.join(descriptor.dirPath, 'session.seed.json'), 'utf-8'),
  ) as ScenarioSessionSeed;
  const sessionPath = path.join(featurePath, 'sessions', 'architect', 'code.json');
  const seededSession = buildSessionEnvelope(seed);
  fs.writeFileSync(sessionPath, JSON.stringify(seededSession, null, 2));

  // Refresh latest symlink for manual debugging.
  try {
    const latest = path.join(RUNS_ROOT, 'latest');
    if (fs.existsSync(latest) || fs.lstatSync(latest).isSymbolicLink?.()) {
      fs.unlinkSync(latest);
    }
  } catch { /* fine */ }
  try { fs.symlinkSync(runId, path.join(RUNS_ROOT, 'latest'), 'dir'); } catch { /* fine */ }

  // Env assembly. Force sequential task execution: the parallel worker runs
  // a different LangGraph (workerGraph.ts) that does NOT emit verification
  // trace events, so the observedRouteSequence would come back empty.
  // The doc explicitly puts parallelism out of scope (§10 "스코프 경계").
  // Verification-scenario trace file — unrelated to the chat log SSOT.
  // This file is consumed by `utils/verificationTrace.ts` to record
  // node/router execution order for deterministic scenario testing.
  const tracePath = path.join(runDir, 'verification-trace.jsonl');
  const env: Record<string, string> = {
    ...sanitizedBaseEnv(),
    ANT_WORKSPACE_BASE_PATH: runDir,
    ANT_SERVER_MODE: 'local',
    ANT_PROJECT_PATH: projectPath,
    ANT_FEATURE_PATH: featurePath,
    ANT_VERIFICATION_TRACE_FILE: tracePath,
    ANT_TASK_CONCURRENCY: '1',
    RECURSION_LIMIT: process.env.RECURSION_LIMIT ?? '200',
    NODE_ENV: 'development',
  };
  if (!opts.realLLM) {
    env.ANT_LLM_MOCK = 'true';
  }
  // Always preserve seeded `retries`. Production path is unaffected because
  // ANT_SCENARIO_PRESERVE_RETRIES is filtered out of sanitizedBaseEnv().
  env.ANT_SCENARIO_PRESERVE_RETRIES = '1';
  if (descriptor.config.mode !== 'real' && descriptor.hasInject) {
    const inject = fs.readFileSync(path.join(descriptor.dirPath, 'inject.json'), 'utf-8');
    env.ANT_COMMAND_INJECT = inject;
    env.ANT_COMMAND_OVERLAY_MODE = descriptor.config.mode;
  }
  if (descriptor.hasLLMMock) {
    env.ANT_LLM_MOCK_RESPONSE_DIR = path.join(descriptor.dirPath, 'llm-mock');
  }

  // Allow-list specific env overrides from scenario.json.env. We keep the
  // list tight so fixtures can't accidentally re-enable Redis, realtime
  // broadcasters, or auth bypass flags.
  const ENV_ALLOW_LIST = new Set([
    'RECURSION_LIMIT',
  ]);
  for (const [k, v] of Object.entries(descriptor.config.env ?? {})) {
    if (ENV_ALLOW_LIST.has(k) && typeof v === 'string') {
      env[k] = v;
    }
  }

  // Spawn child process.
  const spawnResult = await spawnResumeJob({
    runDir,
    env,
    args: ['--org', org, '--user', user, '--project', project, '--feature', feature, '--job', 'code'],
    timeoutMs: descriptor.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    verbose: opts.verbose,
  });

  // Post-run collection.
  let finalSession: any = null;
  try {
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    finalSession = JSON.parse(raw);
  } catch { /* fine, diff will see empty state */ }

  const trace: TraceEntry[] = readTraceFile(tracePath);
  const observedRoute = trace.map(e => e.node);

  const diff = assertExpectedOutcome({
    expected: descriptor.config.expected,
    observedRoute,
    finalSession,
    trace,
  });

  // Scenario success combines (a) no timeout, (b) diff of expected outcome,
  // and (c) optional exit-code policy. `expectedChildExitCode` separates
  // "intended throw" (S09) from "accidental crash" — the default `'any'`
  // preserves the pre-B2 behaviour where we only warn on non-zero exits.
  const expectedExit = descriptor.config.expectedChildExitCode ?? 'any';
  const exitOK =
    expectedExit === 'any' ? true :
    expectedExit === 0 ? spawnResult.exitCode === 0 :
    /* nonzero */ spawnResult.exitCode !== 0 && !spawnResult.timedOut;
  const passed = !spawnResult.timedOut && diff.passed && exitOK;
  if (spawnResult.exitCode !== 0 && passed && expectedExit === 'any') {
    warnings.push(`child exited non-zero (${spawnResult.exitCode}); expected outcome still satisfied`);
  }
  if (!exitOK && !spawnResult.timedOut) {
    warnings.push(
      `exit code policy violated: expected=${expectedExit}, actual=${spawnResult.exitCode}`,
    );
  }
  const durationMs = Date.now() - started;

  // keep policy
  const shouldDelete =
    opts.keep === 'none' ||
    (opts.keep === 'fail' && passed) ||
    (opts.keep === undefined && passed);
  if (shouldDelete) {
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* fine */ }
  }

  // max-runs GC — cheapest policy: oldest-first
  if (opts.maxRuns && opts.maxRuns > 0) {
    pruneRunsDirectory(opts.maxRuns);
  }

  const failureLines: string[] = [];
  if (spawnResult.timedOut) {
    failureLines.push(`child timed out after ${descriptor.config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
  }
  if (!passed && spawnResult.exitCode !== 0) {
    failureLines.push(`child exit=${spawnResult.exitCode}`);
    if (spawnResult.stderrTail) failureLines.push(`stderr (tail):\n${spawnResult.stderrTail}`);
  }
  failureLines.push(...diff.failures);

  return {
    scenarioId: descriptor.id,
    name: descriptor.config.name,
    passed,
    durationMs,
    runDir,
    observedRouteSequence: observedRoute,
    diffSummary: failureLines.length > 0 ? failureLines.join('\n') : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Subprocess plumbing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SpawnResult {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stderrTail?: string;
}

async function spawnResumeJob(params: {
  runDir: string;
  env: Record<string, string>;
  args: string[];
  timeoutMs: number;
  verbose?: boolean;
}): Promise<SpawnResult> {
  const cliEntry = path.join(ANT_CLI_ROOT, 'src', 'cli', 'resume-job-cli.ts');
  return new Promise<SpawnResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Use the tsx bin shim rather than `node … cli.mjs` directly. The shim
    // sets up the loader the same way `pnpm tsx` does; spawning node with the
    // raw .mjs drops some module-resolution hooks and then trips on mixed
    // type/value re-exports elsewhere in the codebase (e.g. codebase/index.ts
    // re-exporting `BatchResult`, which is a pure type).
    const tsxBin = path.join(ANT_CLI_ROOT, 'node_modules', '.bin', 'tsx');
    const child = spawn(
      tsxBin,
      [cliEntry, ...params.args],
      {
        cwd: ANT_CLI_ROOT,
        env: params.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* fine */ }
    }, params.timeoutMs);

    child.stdout.on('data', chunk => {
      const s = chunk.toString();
      stdout += s;
      if (params.verbose) process.stdout.write(s);
      if (stdout.length > DEFAULT_MAX_BUFFER) stdout = stdout.slice(-DEFAULT_MAX_BUFFER);
    });
    child.stderr.on('data', chunk => {
      const s = chunk.toString();
      stderr += s;
      if (params.verbose) process.stderr.write(s);
      if (stderr.length > DEFAULT_MAX_BUFFER) stderr = stderr.slice(-DEFAULT_MAX_BUFFER);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const exitCode = code === null ? (timedOut ? 124 : 1) : code;
      const stderrTail = stderr ? stderr.split('\n').slice(-20).join('\n') : undefined;
      resolve({ exitCode, timedOut, stdout, stderr, stderrTail });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\nspawn error: ${err.message}`;
      resolve({
        exitCode: 1,
        timedOut: false,
        stdout,
        stderr,
        stderrTail: stderr.slice(-2000),
      });
    });
  });
}

/**
 * Filter the parent process env down to values that are safe to inherit.
 * Critically, `ANT_REDIS_URL` must NOT be forwarded so orchestrator.ts
 * does not try to reach Redis (see orchestrator.ts `if (process.env.ANT_REDIS_URL)`).
 */
function sanitizedBaseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'ANT_REDIS_URL') continue;
    if (k === 'ANT_COMMAND_INJECT') continue;
    if (k === 'ANT_COMMAND_OVERLAY_MODE') continue;
    if (k === 'ANT_VERIFICATION_TRACE_FILE') continue;
    if (k === 'ANT_LLM_MOCK') continue;
    if (k === 'ANT_LLM_MOCK_RESPONSE_DIR') continue;
    if (k === 'ANT_WORKSPACE_BASE_PATH') continue;
    if (k === 'ANT_PROJECT_PATH') continue;
    if (k === 'ANT_FEATURE_PATH') continue;
    if (k === 'ANT_SERVER_MODE') continue;
    if (k === 'ANT_IS_RESUME') continue;
    if (k === 'ANT_TASK_CONCURRENCY') continue;
    if (k === 'ANT_SCENARIO_PRESERVE_RETRIES') continue;
    out[k] = v;
  }
  return out;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FS helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function copyDirectory(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(from);
      try { fs.symlinkSync(target, to); } catch { /* skip */ }
    } else fs.copyFileSync(from, to);
  }
}

function pruneRunsDirectory(maxRuns: number): void {
  if (!fs.existsSync(RUNS_ROOT)) return;
  const children = fs.readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      mtime: safeMtime(path.join(RUNS_ROOT, e.name)),
    }))
    .sort((a, b) => a.mtime - b.mtime);
  const excess = children.length - maxRuns;
  for (let i = 0; i < excess; i++) {
    try { fs.rmSync(path.join(RUNS_ROOT, children[i].name), { recursive: true, force: true }); } catch { /* fine */ }
  }
}

function safeMtime(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Wrap a scenario session seed in the envelope FileSessionAdapter expects.
 *
 * FileSessionAdapter.load() parses with SessionSchema which requires
 *   { sessionId, project, feature, createdAt, updatedAt, runs, artifacts, state? }.
 *
 * Additionally, `runCodeGraph.resume` detection requires
 *   session.state.taskQueue && session.state.interruption — without
 * `interruption`, the runner takes the "early-interrupted" fallback and
 * never sets `isResume=true`, skipping the routeAfterResolve resume branch.
 *
 * We synthesize a minimal `interruption` record here so every scenario
 * entering the graph is treated as a resume case.
 */
function buildSessionEnvelope(seed: ScenarioSessionSeed): any {
  const now = new Date().toISOString();
  const stateWithInterruption: any = {
    ...seed,
    interruption: seed.interruption ?? {
      reason: 'user_stopped',
      message: 'Seeded by verification scenario harness',
      timestamp: now,
      canResume: true,
    },
  };
  return {
    sessionId: `scenario-${Date.now()}`,
    project: 'verification',
    feature: 'scenario',
    createdAt: now,
    updatedAt: now,
    runs: [],
    artifacts: {},
    state: stateWithInterruption,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scenario ID resolution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function resolveScenario(idOrName: string): ScenarioDescriptor {
  const all = listScenarios();
  const normalized = idOrName.toUpperCase();
  const byId = all.find(s => s.id === normalized);
  if (byId) return byId;
  const byDir = all.find(s => s.dirName === idOrName);
  if (byDir) return byDir;
  const byName = all.find(s => s.config.name === idOrName);
  if (byName) return byName;
  throw new Error(`Scenario "${idOrName}" not found. Known: ${all.map(s => s.id).join(', ') || '(none)'}`);
}
