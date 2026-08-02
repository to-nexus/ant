/**
 * Plan-job plan→execute split — invariant tests.
 *
 * Pins the topology + boundary that replaces the monolithic `generate` node:
 *   - plan ⟷ tool → execute ⟷ tool → END
 *   - the plan node seals a brief and CLEARS its NODE_PLAN transcript; execute
 *     authors from `directive + planText` on a fresh NODE_EXECUTE channel
 *     (research momentum + auditor-persona tail severed).
 *   - clarify lives in plan; the shared tool node dispatches by `_activePhase`.
 *
 * The node bodies stream from an LLM, so these tests pin the pure routers, the
 * authoring-message anchor, and the prompt re-partition (text presence) — not
 * the LLM output itself.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { routeAfterPlan, basePlanRoundMaxTokens } from '../../src/agents/planner/graph/plan/nodes/plan';
import { LLM_MAX_TOKENS } from '../../src/agents/common/graph/llmConfig';
import { routeAfterExecute, buildAuthoringMessage } from '../../src/agents/planner/graph/plan/nodes/execute';
import { buildPlanGraph } from '../../src/agents/planner/graph/plan/graph';
import { isUnrealizedBrief } from '../../src/agents/planner/graph/plan/runner';
import { extractPlanText } from '../../src/agents/common/graph/nodes/plan/extractPlanText';
import type { PlanGraphState } from '../../src/agents/planner/graph/plan/state';

const base = (over: Partial<PlanGraphState>): PlanGraphState =>
  ({ pendingToolCalls: [], ...over } as any);

const TEMPLATES = path.resolve(__dirname, '../../src/core/prompt/templates/jobs/plan/nodes');
const read = (p: string) => fs.readFileSync(path.join(TEMPLATES, p), 'utf-8');

describe('routeAfterPlan — plan node outcomes', () => {
  it('pending tool calls → tool (stay in plan research loop)', () => {
    expect(routeAfterPlan(base({ pendingToolCalls: [{ id: '1', name: 'read_file', args: {} }] }))).toBe('tool');
  });

  it('clarify paused (awaitingClarify) → __end__', () => {
    expect(routeAfterPlan(base({ awaitingClarify: true }))).toBe('__end__');
  });

  it('brief sealed (_activePhase=execute) → execute', () => {
    expect(routeAfterPlan(base({ _activePhase: 'execute', planText: '{"proposedOutline":["x"]}' }))).toBe('execute');
  });

  it('explain done / no seal → __end__', () => {
    expect(routeAfterPlan(base({}))).toBe('__end__');
  });

  it('tool calls win over a stale execute phase (still in loop)', () => {
    expect(routeAfterPlan(base({ _activePhase: 'execute', pendingToolCalls: [{ id: '1', name: 'x', args: {} }] }))).toBe('tool');
  });

  // frank-losing-rugby: explore reports delivered by the plan node's join
  // barrier re-enter plan (never conclude a phase with reports outstanding).
  it('subagent join redo → plan (self-edge)', () => {
    expect(routeAfterPlan(base({ _subagentJoinRedo: true, _activePhase: 'plan' }))).toBe('plan');
  });

  it('seal clears the join-redo flag, so execute still wins after a redo cycle', () => {
    expect(routeAfterPlan(base({ _subagentJoinRedo: false, _activePhase: 'execute' }))).toBe('execute');
  });
});

describe('routeAfterExecute — execute node outcomes', () => {
  it('pending tool calls → tool (execute may read mid-author)', () => {
    expect(routeAfterExecute(base({ pendingToolCalls: [{ id: '1', name: 'read_file', args: {} }] }))).toBe('tool');
  });

  it('done (no tool calls) → __end__ (execute finalizes inline, no learn tail)', () => {
    expect(routeAfterExecute(base({}))).toBe('__end__');
  });
});

describe('execute authoring message — re-anchored on directive + brief', () => {
  const directive = 'Redesign jhcompany.co.kr to be more stylish';

  it('generate mode (single target): contains the verbatim directive + the <file> write instruction', () => {
    const msg = buildAuthoringMessage(directive, ['plan/prd.md'], 'generate', false);
    expect(msg).toContain(directive);
    expect(msg).toContain('<file path="plan/prd.md">');
    // The anchor is the brief, and the model must transform (not transcribe) it.
    expect(msg).toMatch(/brief/i);
    expect(msg).toMatch(/do NOT reproduce/i);
  });

  it('generate mode (multi target): instructs one <file> per doc + MECE partition', () => {
    const msg = buildAuthoringMessage(directive, ['plan/overview.md', 'plan/auth.md'], 'generate', false);
    expect(msg).toContain('plan/overview.md, plan/auth.md');
    expect(msg).toMatch(/one `<file path="\.\.\.">` tag per file/i);
    expect(msg).toMatch(/MECE|no overlap/i);
  });

  it('refactor mode: instructs edit_file at the target, not a <file> rewrite', () => {
    const msg = buildAuthoringMessage(directive, ['plan/prd.md'], 'refactor', false);
    expect(msg).toContain('edit_file');
    expect(msg).toContain(directive);
  });

  it('carries NO plan-loop transcript (structurally — only directive/target/mode in)', () => {
    const msg = buildAuthoringMessage(directive, ['plan/prd.md'], 'generate', false);
    expect(msg).not.toMatch(/read_workspace_file|list_workspace_files|tool_result|Expert Audit/i);
  });
});

describe('brief seal — reuses the registered <plan> artifact tag', () => {
  it('extractPlanText seals on a well-formed <plan> body', () => {
    const brief = '{"directiveRestated":"x","subjectType":"greenfield","proposedOutline":["Overview","Scope"]}';
    const sealed = extractPlanText(`chatter <plan>${brief}</plan> trailing`, 40);
    expect(sealed).toBe(brief);
  });

  it('rejects an empty/too-short <plan> body (interrupted stream)', () => {
    expect(extractPlanText('<plan>{}</plan>', 40)).toBeNull();
  });
});

describe('graph topology', () => {
  it('buildPlanGraph compiles with the plan→execute spine', () => {
    expect(() => buildPlanGraph()).not.toThrow();
  });
});

// gentle-leaping-lathe parity: research rounds are shape-budgeted like the
// code job's plan tool loop; only explain (user-facing <reply>) keeps DEFAULT.
describe('basePlanRoundMaxTokens — research-round budget', () => {
  it('generate/refactor research rounds run at PLAN_TOOL_LOOP', () => {
    expect(basePlanRoundMaxTokens('generate')).toBe(LLM_MAX_TOKENS.PLAN_TOOL_LOOP);
    expect(basePlanRoundMaxTokens('refactor')).toBe(LLM_MAX_TOKENS.PLAN_TOOL_LOOP);
  });

  it('explain streams a user-facing reply at DEFAULT', () => {
    expect(basePlanRoundMaxTokens('explain')).toBe(LLM_MAX_TOKENS.DEFAULT);
  });
});

// such-catching-motif: the plan node sealed a 10K-char brief, a stale
// `awaitingClarify` channel routed it to __end__, and the job still reported
// `success: true` with an empty plan/ directory. Two locks:
//   1. the seal must write `awaitingClarify: false` so the route survives
//   2. a sealed-but-unauthored turn must never report success
describe('sealed brief must reach execute (clarify continuation)', () => {
  const PLAN_NODE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../src/agents/planner/graph/plan/nodes/plan/index.ts'),
    'utf-8',
  );

  it('the seal return clears the clarify channel (mutation alone is node-local)', () => {
    const seal = PLAN_NODE_SRC.slice(PLAN_NODE_SRC.indexOf('_noOutputCallCount: 0,'));
    expect(seal).toMatch(/\.\.\.clarifyPatch/);
  });

  it('the clarify-pause return still sets the flag true', () => {
    expect(PLAN_NODE_SRC).toMatch(/awaitingClarify:\s*true/);
  });

  it('routeAfterPlan sends a sealed brief to execute once the channel is clean', () => {
    expect(routeAfterPlan(base({ _activePhase: 'execute', awaitingClarify: false }))).toBe('execute');
  });
});

describe('isUnrealizedBrief — output gate (no phantom success)', () => {
  it('sealed brief with zero authored docs in generate mode → gated', () => {
    expect(isUnrealizedBrief({ planText: '{"proposedOutline":["x"]}', _authoredDocPaths: [] }, 'generate')).toBe(true);
    // Channel never written (execute never ran) — the production signature.
    expect(isUnrealizedBrief({ planText: '{"proposedOutline":["x"]}' }, 'generate')).toBe(true);
  });

  it('sealed brief WITH an authored doc → not gated', () => {
    expect(
      isUnrealizedBrief({ planText: '{"proposedOutline":["x"]}', _authoredDocPaths: ['plan/prd.md'] }, 'generate'),
    ).toBe(false);
  });

  it('no sealed brief (clarify pause / triage exit) → not gated', () => {
    expect(isUnrealizedBrief({ _authoredDocPaths: [] }, 'generate')).toBe(false);
    expect(isUnrealizedBrief({ planText: '   ', _authoredDocPaths: [] }, 'generate')).toBe(false);
  });

  it('refactor (edit_file path) and explain are exempt', () => {
    const sealed = { planText: '{"proposedOutline":["x"]}', _authoredDocPaths: [] };
    expect(isUnrealizedBrief(sealed, 'refactor')).toBe(false);
    expect(isUnrealizedBrief(sealed, 'explain')).toBe(false);
  });
});

describe('prompt re-partition — plan observes, execute authors', () => {
  it('plan base owns the codebase MUST-inspect anchor; execute does NOT', () => {
    expect(read('plan/variants/default/base.md')).toMatch(/MUST inspect the codebase/);
    expect(read('execute/variants/default/base.md')).not.toMatch(/MUST inspect the codebase/);
    expect(read('execute/variants/default/rules.md')).not.toMatch(/MUST inspect the codebase/);
  });

  it('plan rules own the <plan> brief seal contract; execute owns the <file> Output Protocol', () => {
    const planRules = read('plan/variants/default/rules.md');
    const execRules = read('execute/variants/default/rules.md');
    expect(planRules).toMatch(/seal the brief inside a single `<plan>` tag/);
    expect(planRules).not.toMatch(/wrapped in its OWN `<file>`/);
    expect(execRules).toMatch(/wrapped in its OWN `<file>`/);
  });

  it('plan deliverable is a brief, NOT the document (drift guard)', () => {
    expect(read('plan/variants/default/rules.md')).toMatch(/deliverable is a sealed brief/i);
  });

  // frank-losing-rugby: the plan node's LLM must see the artifact-tree state
  // upfront (single shared partial — same table detect renders) instead of
  // discovering empty directories with repeated list calls.
  it('plan base injects the shared workspace-state partial (detect stays converged)', () => {
    expect(read('plan/variants/default/base.md')).toMatch(/\{\{>\s*jobs\/shared\/injections\/workspace-state\}\}/);
    const detectBase = fs.readFileSync(
      path.resolve(__dirname, '../../src/core/prompt/templates/jobs/shared/nodes/detect/variants/default/base.md'),
      'utf-8',
    );
    expect(detectBase).toMatch(/\{\{>\s*jobs\/shared\/injections\/workspace-state\}\}/);
  });
});
