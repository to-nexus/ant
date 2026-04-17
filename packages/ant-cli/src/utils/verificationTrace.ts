/**
 * Verification Scenario Trace — test-only execution trace writer.
 *
 * When `ANT_VERIFICATION_TRACE_FILE=<abs-path>` is set, each node/router of the
 * code graph appends a JSON-line entry to that file as it is traversed.
 *
 * The scenario runner (`scripts/verify-scenario.ts`) reads the file after the
 * child process exits to evaluate `ScenarioExpectedOutcome.routeSequence`.
 *
 * When the env var is unset (production path) every function in this module is
 * a cheap no-op — the env is checked once per process and cached.
 *
 * See docs/testing/verification-scenarios.md § "Step C".
 */

import * as fs from 'fs';

export interface TraceEntry {
  node: string;
  taskId?: string;
  taskType?: string;
  taskName?: string;
  to?: string;
  timestamp?: string;
  extra?: Record<string, unknown>;
}

let tracePath: string | null | undefined;

function getTracePath(): string | null {
  if (tracePath !== undefined) return tracePath;
  const raw = process.env.ANT_VERIFICATION_TRACE_FILE;
  tracePath = raw && raw.trim().length > 0 ? raw : null;
  return tracePath;
}

/**
 * Test-only hook: reset the cached env lookup so tests can mutate the env
 * between cases without process restart.
 */
export function __resetVerificationTraceCache(): void {
  tracePath = undefined;
}

/**
 * Append one trace entry as a single JSON line.
 * No-op when the env var is not set.
 *
 * Design choices:
 *   - synchronous write: guarantees ordering relative to console logs that
 *     follow in the same node — matters when diagnosing hangs / missed events
 *   - best-effort: any filesystem error is swallowed so a broken trace file
 *     never masks the actual agent failure mode under test
 */
export function appendTrace(entry: TraceEntry): void {
  const p = getTracePath();
  if (!p) return;
  try {
    const line = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    });
    fs.appendFileSync(p, line + '\n', 'utf-8');
  } catch {
    // intentionally silent — see docstring
  }
}

/**
 * Convenience helper for nodes that have access to state. Extracts the
 * common { taskId, taskType } projection safely.
 */
export function traceNodeEntry(node: string, currentTask?: { id?: string; type?: string; name?: string } | null, extra?: Record<string, unknown>): void {
  if (!getTracePath()) return;
  appendTrace({
    node,
    taskId: currentTask?.id,
    taskType: currentTask?.type,
    taskName: currentTask?.name,
    extra,
  });
}

/**
 * Read the trace file back as a typed array. Used by the scenario runner's
 * diff engine. Returns [] when the file does not exist.
 */
export function readTraceFile(filePath: string): TraceEntry[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        try { return JSON.parse(line) as TraceEntry; } catch { return null; }
      })
      .filter((e): e is TraceEntry => !!e);
  } catch {
    return [];
  }
}
