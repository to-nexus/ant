/**
 * SSOT for translating `serverStarted` tool side effects into the
 * `state.runningServers` ledger that the learn node consumes for
 * task-end teardown.
 *
 * Why a dedicated helper instead of inlining in the switch?
 *   1. Testability — the switch lives inside a hooks closure deep in
 *      `createToolNode`. Pulling the logic out lets us unit-test the
 *      "did the PID land in runningServers?" contract without standing
 *      up the full tool node.
 *   2. Single point of policy — PID validation, dedup, and the
 *      `startedAt` stamp must agree across every emitter (currently just
 *      `runCommand` long-running path; future: workspace orchestrator).
 *      Centralising here avoids drift.
 *
 * The reverse contract — turning `runningServers` entries back into
 * killed processes — lives in `learn/index.ts` and uses the SSOT
 * `core/process/DevProcessControl`. Together they fulfil the
 * persistent-process-policy guarantee that LLM-spawned dev servers are
 * torn down on task completion.
 */

import type { ArchitectGraphState } from '../../../state';
import type { ToolSideEffect } from '../../../../../../common/tool/types';

type ServerStartedEffect = Extract<ToolSideEffect, { type: 'serverStarted' }>;

/**
 * Append a `serverStarted` side effect to the running-server ledger.
 *
 * Behaviour:
 *   - Lazily initialises `state.runningServers` if missing.
 *   - Drops invalid PIDs (< 1, non-number).
 *   - Dedupes by PID — repeated emissions for the same PID are no-ops
 *     (useful when a tool retry path emits the same effect twice).
 *
 * Mutates `state` in place. Returns nothing — callers don't need to
 * branch on insert vs skip.
 */
export function recordServerStarted(
  state: ArchitectGraphState,
  effect: ServerStartedEffect,
): void {
  const pid = effect.pid;
  // `Number.isFinite` rejects NaN, ±Infinity, and non-numbers — `typeof
  // === 'number'` alone passes NaN through (NaN comparisons are always
  // false, so a `pid <= 0` guard would be silently bypassed).
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isInteger(pid)) return;
  if (!Array.isArray(state.runningServers)) state.runningServers = [];
  if (state.runningServers.some(s => s.pid === pid)) return;
  state.runningServers.push({
    pid,
    command: effect.command,
    workingDir: effect.workingDir,
    startedAt: Date.now(),
  });
}
