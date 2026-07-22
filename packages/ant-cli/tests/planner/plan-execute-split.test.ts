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
import { routeAfterPlan } from '../../src/agents/planner/graph/plan/nodes/plan';
import { routeAfterExecute, buildAuthoringMessage } from '../../src/agents/planner/graph/plan/nodes/execute';
import { buildPlanGraph } from '../../src/agents/planner/graph/plan/graph';
import { extractPlanText } from '../../src/agents/common/graph/nodes/plan/extractPlanText';
import type { PlanGraphState } from '../../src/agents/planner/graph/plan/state';

const base = (over: Partial<PlanGraphState>): PlanGraphState =>
  ({ pendingToolCalls: [], ...over } as any);

const TEMPLATES = path.resolve(__dirname, '../../src/core/prompt/templates/jobs/plan/nodes');
const read = (p: string) => fs.readFileSync(path.join(TEMPLATES, p), 'utf-8');

describe('routeAfterPlan — plan node outcomes', () => {
  it('pending tool calls → tool (stay in plan research loop)', () => {
    expect(routeAfterPlan(base({ pendingToolCalls: [{ id: '1', name: 'read_workspace_file', args: {} }] }))).toBe('tool');
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
});

describe('routeAfterExecute — execute node outcomes', () => {
  it('pending tool calls → tool (execute may read mid-author)', () => {
    expect(routeAfterExecute(base({ pendingToolCalls: [{ id: '1', name: 'read_workspace_file', args: {} }] }))).toBe('tool');
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
});
