/**
 * Planner no-output tool-strip salvage (cyan-catching-cedar follow-up).
 *
 * The planner's plan⟷tool and execute⟷tool loops were bounded only by
 * recursionLimit=200 — a glm-5.2-class degenerate loop issuing novel
 * reads/searches with no <plan> seal / <file> write could burn ~100 tool
 * rounds. `applyPlanDrainFinalization` strips the tool list after
 * NO_OUTPUT_HARD_CAP − DRAIN_FINALIZE_MARGIN tool rounds; because both planner
 * phases terminate structurally on a tool-less round, the strip alone bounds
 * the loop (no router hard-divert). Contracts locked here:
 *
 *   1. UNIT — helper does not fire below the threshold; fires at/after it,
 *      stripping tools and appending a phase-appropriate terminal note.
 *   2. UNIT — replay: 20 tool rounds reach the salvage threshold, not 100+.
 *   3. STATIC — the _noOutputCallCount channel is declared, and the plan/
 *      execute nodes increment on tool rounds + reset on forward progress.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPlanDrainFinalization } from '../../src/agents/planner/graph/plan/nodes/drainFinalize';
import {
  NO_OUTPUT_HARD_CAP,
  DRAIN_FINALIZE_MARGIN,
} from '../../src/agents/planner/graph/plan/state';

const TOOLS = [{ name: 'read_file' }, { name: 'search_code' }];
const SALVAGE_AT = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;

function userMsg(content: string | any[]) {
  return { role: 'user', content };
}

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../..', rel), 'utf8');
}

describe('applyPlanDrainFinalization — planner tool-strip salvage', () => {
  it('does not fire below the salvage threshold (tools preserved, no note)', () => {
    const messages = [userMsg('research the codebase')];
    const { tools, drainFinalizing } = applyPlanDrainFinalization(
      { _noOutputCallCount: SALVAGE_AT - 1 }, messages, TOOLS, 'plan',
    );
    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
    expect(messages[0].content).toBe('research the codebase');
  });

  it('fires exactly at CAP − MARGIN with toolChoice=none (plan phase → seal instruction)', () => {
    const messages = [userMsg('research')];
    const { tools, toolChoice, drainFinalizing } = applyPlanDrainFinalization(
      { _noOutputCallCount: SALVAGE_AT }, messages, TOOLS, 'plan',
    );
    expect(drainFinalizing).toBe(true);
    // Tools stay DECLARED; the provider constraint carries the prohibition
    // (sage-causing-rover axis).
    expect(tools).toBe(TOOLS);
    expect(toolChoice).toBe('none');
    const content = messages[0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: 'research' });
    expect(content[1].text).toContain('Tools are no longer available');
    expect(content[1].text).toContain('<plan>');
  });

  it('execute phase note instructs a <file> write, not a seal', () => {
    const messages = [userMsg('author')];
    applyPlanDrainFinalization({ _noOutputCallCount: SALVAGE_AT + 3 }, messages, TOOLS, 'execute');
    const content = messages[0].content as any[];
    expect(content[1].text).toContain('<file');
    expect(content[1].text).not.toContain('<plan>');
  });

  it('appends to block-array user content without disturbing existing blocks', () => {
    const blocks = [
      { type: 'text', text: 'ctx' },
      { type: 'tool_result', tool_use_id: 'x', content: 'r' },
    ];
    const messages = [userMsg(blocks)];
    applyPlanDrainFinalization({ _noOutputCallCount: SALVAGE_AT }, messages, TOOLS, 'plan');
    expect(blocks).toHaveLength(3);
    expect((blocks[2] as any).text).toContain('Tools are no longer available');
  });

  it('starts inert when the channel is unset', () => {
    const messages = [userMsg('go')];
    const { drainFinalizing, tools } = applyPlanDrainFinalization({}, messages, TOOLS, 'plan');
    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
  });

  it('replay: 20 tool rounds reach the salvage threshold (not ~100 under recursionLimit)', () => {
    // Each tool-only round increments the counter (mirrors the plan/execute
    // node return delta). The strip must engage at round 20.
    let count = 0;
    let strippedAt = -1;
    for (let round = 1; round <= 100; round++) {
      count = count + 1; // node's `_noOutputCallCount: (prev||0)+1` on a tool round
      const { drainFinalizing } = applyPlanDrainFinalization(
        { _noOutputCallCount: count }, [userMsg('go')], TOOLS, 'plan',
      );
      if (strippedAt < 0 && drainFinalizing) strippedAt = round;
    }
    expect(strippedAt).toBe(SALVAGE_AT); // 20, well before recursionLimit=200
  });
});

describe('planner no-output channel + node wiring (static)', () => {
  it('declares the _noOutputCallCount channel in PlanAnnotation', () => {
    const src = read('src/agents/planner/graph/plan/state.ts');
    expect(src).toMatch(/_noOutputCallCount:\s*Annotation/);
    expect(src).toMatch(/export const NO_OUTPUT_HARD_CAP = 25/);
    expect(src).toMatch(/export const DRAIN_FINALIZE_MARGIN = 5/);
  });

  it('plan node increments on tool rounds, resets to 0 on seal, and applies salvage', () => {
    const src = read('src/agents/planner/graph/plan/nodes/plan/index.ts');
    expect(src).toMatch(/applyPlanDrainFinalization\(state, messages, toolDefinitions, 'plan'\)/);
    expect(src).toMatch(/_noOutputCallCount: \(state\._noOutputCallCount \|\| 0\) \+ 1/);
    expect(src).toMatch(/_noOutputCallCount: 0/); // reset on seal
    expect(src).toMatch(/tools: streamToolDefinitions/);
  });

  it('execute node increments on tool rounds, resets on join-redo, and applies salvage', () => {
    const src = read('src/agents/planner/graph/plan/nodes/execute/index.ts');
    expect(src).toMatch(/applyPlanDrainFinalization\(state, messages, toolDefinitions, 'execute'\)/);
    expect(src).toMatch(/_noOutputCallCount: \(state\._noOutputCallCount \|\| 0\) \+ 1/);
    expect(src).toMatch(/_noOutputCallCount: 0/); // reset on subagent-join redo
    expect(src).toMatch(/tools: streamToolDefinitions/);
  });
});
