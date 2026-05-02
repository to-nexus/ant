/**
 * Regression guard — parallelOrchestrator's sharedContext must propagate
 * `turnId` (and `executionTier`) into the worker subgraph so that
 * downstream emitters (writeBreadcrumb, recordUserTurnMeta, ChatLogAppender,
 * etc.) attribute trace events to the owning user_turn instead of falling
 * through to silent-skip paths. job-context-bridge T1 fix.
 *
 * The shape of `sharedContext` is built inside graph.ts's
 * `parallelOrchestrator` function. It is not exported — the function lives
 * directly on a LangGraph node closure — so this test reads the source and
 * asserts the relevant keys are present in the literal. A weak guard, but
 * it pins the regression and forces explicit acknowledgement when the
 * literal changes.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// vitest runs with cwd = packages/ant-cli (see RUN log). Use cwd-relative
// path rather than __dirname which gets resolved against the compiled-test
// virtual location and lands at packages/ant-cli/tests/src/... .
const GRAPH_PATH = path.resolve(
  process.cwd(),
  'src/agents/architect/graph/code/graph.ts',
);

describe('parallelOrchestrator sharedContext (graph.ts)', () => {
  const source = fs.readFileSync(GRAPH_PATH, 'utf-8');

  // Slice the sharedContext literal — between `const sharedContext = {` and
  // its closing `};`. Match non-greedily so we do not catch a later object
  // by accident.
  const match = source.match(/const sharedContext = \{([\s\S]*?)\n  \};/);

  it('locates the sharedContext literal', () => {
    expect(match).toBeTruthy();
  });

  const body = match?.[1] ?? '';

  it.each([
    ['turnId', /\bturnId:\s*state\.turnId\b/],
    ['executionTier', /\bexecutionTier:\s*state\.executionTier\b/],
    ['jobId', /\bjobId:\s*state\.jobId\b/],
  ])('propagates %s to workers', (_name, re) => {
    expect(body).toMatch(re);
  });
});
