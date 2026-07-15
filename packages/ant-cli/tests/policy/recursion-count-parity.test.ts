/**
 * recursionCount mutate-return parity sweep.
 *
 * `state.recursionCount` is a plain last-value LangGraph channel: an in-place
 * mutation (`state.recursionCount = (state.recursionCount || 0) + 1`) is
 * DROPPED at the node transition unless the node's returned delta commits it
 * (or the node returns a full-state spread, which carries the mutated value).
 *
 * RCA `local-caring-board` (2026-07-15): the design execute node incremented
 * the counter in place but omitted it from both return objects, so every
 * execute-visit increment was lost. The executeRouter drain guard
 * (`recursionLimit - recursionCount < 30` → checkTaskStatus) could never fire
 * — the gauge sat at ~426 while LangGraph's real super-step counter hit the
 * 800 limit, turning a graceful early checkpoint into a hard
 * `GraphRecursionError` crash after 53 minutes of burn.
 *
 * This sweep asserts: every file that performs the in-place increment also
 * contains at least one commit vector —
 *   (a) an object-literal commit  `recursionCount: state.recursionCount`
 *       (or the tool-node form `recursionCount: (state.recursionCount || 0) + 1`),
 *   (b) a delta assignment        `<delta>.recursionCount = state.recursionCount`
 *       (code plan: entryDelta flows through mergeDelta on every return path),
 *   (c) a full-state spread       `...state` (carries in-place mutations).
 *
 * File-level granularity is intentional: per-return-path analysis needs AST
 * work and function-scope tracking that is brittle against refactors. The
 * file-level invariant catches the incident class (a node file with ZERO
 * commit vectors) deterministically. Per-path completeness inside multi-return
 * nodes is a review concern — when adding a new return path to a node that
 * increments the counter, commit `recursionCount`/`recursionLimit` on it.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const AGENTS_ROOT = path.resolve(__dirname, '../../src/agents');

// The canonical in-place increment. The leading guard rejects property-chain
// prefixes (e.g. sessionWriter's `sessionData.state.recursionCount = ...`
// serialization copy, which is not a channel mutation).
const INCREMENT_RE = /(?<![.\w])state\.recursionCount\s*=\s*\(state\.recursionCount/;

const COMMIT_VECTOR_RES = [
  /\brecursionCount\s*:\s*\(?\s*state\.recursionCount/, // object-literal commit
  /\.recursionCount\s*=\s*state\.recursionCount/, // delta assignment (mergeDelta path)
  /\.\.\.state\b/, // full-state spread return
];

// Void instrumentation helpers: they mutate in place by design and rely on
// the CALLING node's return to commit. Each entry must document the caller
// that carries the value.
const VOID_HELPER_ALLOWLIST: Record<string, string> = {
  'architect/graph/design/nodes/decompose/workflowInstrument.ts':
    'void instrument; caller design decompose returns `...state` spreads on all paths',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('recursionCount mutate-return parity (drain-guard gauge integrity)', () => {
  const files = walk(AGENTS_ROOT);
  const mutators = files.filter((f) => INCREMENT_RE.test(fs.readFileSync(f, 'utf8')));

  it('finds the increment sites (sanity: sweep is not vacuous)', () => {
    expect(mutators.length).toBeGreaterThanOrEqual(10);
  });

  it('every incrementing file has a commit vector (or is a documented void helper)', () => {
    const violations: string[] = [];
    for (const file of mutators) {
      const rel = path.relative(AGENTS_ROOT, file).replace(/\\/g, '/');
      if (VOID_HELPER_ALLOWLIST[rel]) continue;
      const src = fs.readFileSync(file, 'utf8');
      const committed = COMMIT_VECTOR_RES.some((re) => re.test(src));
      if (!committed) violations.push(rel);
    }
    expect(
      violations,
      `Files increment state.recursionCount in place but never commit it on a ` +
        `returned delta — the increment is silently dropped by LangGraph and the ` +
        `executeRouter drain guard starves (local-caring-board RCA). Add ` +
        `"recursionCount: state.recursionCount, recursionLimit: state.recursionLimit" ` +
        `to the node's return object(s):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('allowlist entries still exist (no stale exemptions)', () => {
    for (const rel of Object.keys(VOID_HELPER_ALLOWLIST)) {
      expect(fs.existsSync(path.join(AGENTS_ROOT, rel)), `stale allowlist entry: ${rel}`).toBe(true);
    }
  });
});
