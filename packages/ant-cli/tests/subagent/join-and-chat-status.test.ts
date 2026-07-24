/**
 * Join helper + router flags + chat-status bodies:
 * - maybeJoinSubagents waits, collects, folds, returns blocks (null when clean)
 * - routeAfterAgent (ask) / routeAfterExecute (planner) self re-entry on
 *   `_subagentJoinRedo`
 * - generateChatStatusContent bodies for subagent_running / subagent_report
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { maybeJoinSubagents } from '../../src/agents/common/subagent/join';
import { launchEntry, clearAll } from '../../src/agents/common/subagent/registry';
import { routeAfterAgent } from '../../src/agents/architect/graph/ask/nodes/agent';
import { routeAfterExecute as plannerRouteAfterExecute } from '../../src/agents/planner/graph/plan/nodes/execute';
import { generateChatStatusContent } from '@ant/shared';
import type { SubagentResult } from '../../src/agents/common/subagent/types';

const OWNER = 'jobJ:_main_';

beforeEach(() => clearAll());
afterEach(() => clearAll());

describe('maybeJoinSubagents', () => {
  it('returns null when nothing is pending or settled', async () => {
    expect(await maybeJoinSubagents({}, OWNER)).toBeNull();
  });

  it('waits for pending children and returns their report blocks + token delta', async () => {
    let resolve!: (r: SubagentResult) => void;
    launchEntry({
      id: 'j1', ownerKey: OWNER, goal: 'g',
      run: () => new Promise<SubagentResult>((res) => { resolve = res; }),
    });
    setTimeout(() => resolve({
      report: 'late findings', rounds: 1, state: 'done', modelId: 'child-m',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    }), 20);

    const state: Record<string, any> = { tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, tokenUsageByModel: {} };
    const joined = await maybeJoinSubagents(state, OWNER);
    expect(joined).not.toBeNull();
    expect(JSON.stringify(joined!.blocks)).toContain('late findings');
    expect(joined!.tokenDelta.tokenUsage.totalTokens).toBe(5);
    // Drained — a second join is clean.
    expect(await maybeJoinSubagents(state, OWNER)).toBeNull();
  });
});

describe('join call-site policy (static)', () => {
  it('no join site pre-gates maybeJoinSubagents on hasPendingSubagents', async () => {
    // cyan-driving-apron E2E regression: hasPending counts only RUNNING
    // children, so a pre-gate skips settled-but-undelivered reports and they
    // get dropped at task completion. maybeJoinSubagents already returns null
    // when nothing is owed — call it unconditionally at finalization.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sites = [
      'src/agents/architect/graph/code/nodes/execute/index.ts',
      'src/agents/architect/graph/design/nodes/execute/index.ts',
      'src/agents/architect/graph/code/nodes/direct/index.ts',
      'src/agents/architect/graph/ask/nodes/agent.ts',
      'src/agents/planner/graph/plan/nodes/execute/index.ts',
      // round-grading-sable: the code plan phase has no finalize-time join;
      // deliverOwedExploreReports delivers owed reports on tool-loop
      // fallthrough so a plan worker cannot hang "waiting for the subagent
      // reports". This entry locks the barrier so it can't silently reopen.
      'src/agents/architect/graph/code/nodes/plan/index.ts',
    ];
    for (const rel of sites) {
      const body = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8');
      expect(body, `${rel} must call maybeJoinSubagents`).toContain('maybeJoinSubagents(');
      expect(body, `${rel} must not pre-gate the join on hasPendingSubagents`)
        .not.toMatch(/hasPendingSubagents/);
    }
  });
});

describe('join-redo routers', () => {
  it('ask routeAfterAgent re-enters agent on _subagentJoinRedo', () => {
    expect(routeAfterAgent({ _subagentJoinRedo: true, pendingToolCalls: [] } as any)).toBe('agent');
    expect(routeAfterAgent({ pendingToolCalls: [{ id: '1', name: 'x', args: {} }] } as any)).toBe('tool');
    expect(routeAfterAgent({ pendingToolCalls: [] } as any)).toBe('respond');
  });

  it('planner routeAfterExecute re-enters execute on _subagentJoinRedo', () => {
    expect(plannerRouteAfterExecute({ _subagentJoinRedo: true, pendingToolCalls: [] } as any)).toBe('execute');
    expect(plannerRouteAfterExecute({ pendingToolCalls: [{ id: '1', name: 'x', args: {} }] } as any)).toBe('tool');
    expect(plannerRouteAfterExecute({ pendingToolCalls: [] } as any)).toBe('__end__');
  });
});

describe('generateChatStatusContent — subagent cards', () => {
  it('subagent_running fallback copy carries subagent identity, no round counter', () => {
    expect(generateChatStatusContent('subagent_running', { goal: 'map the auth flow' }))
      .toBe('Subagent exploring: map the auth flow...');
    // The internal round counter is no longer surfaced in the running copy.
    expect(generateChatStatusContent('subagent_running', { goal: 'g', rounds: 3 }))
      .toBe('Subagent exploring: g...');
  });

  it('subagent_report body per terminal state', () => {
    expect(generateChatStatusContent('subagent_report', { goal: 'g', state: 'done' })).toBe('Subagent explored: g');
    expect(generateChatStatusContent('subagent_report', { goal: 'g', state: 'partial' })).toBe('Subagent explored (partial): g');
    expect(generateChatStatusContent('subagent_report', { goal: 'g', state: 'aborted' })).toBe('Subagent explore interrupted: g');
    expect(generateChatStatusContent('subagent_report', { goal: 'g', state: 'error', error: 'boom' }))
      .toBe('❌ Subagent explore failed: boom');
  });
});
