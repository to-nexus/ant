/**
 * Sealed-plan injection contract (design docGen).
 *
 * The plan node hands a sealed `<plan>` JSON to docGen via
 * `state.planText`. After the plan→docGen role split was restored
 * (see `.claude/plans/plan-docgen-parallel-spring.md`), the sealed
 * plan no longer rides inside `runtimeContext`; it is exposed as a
 * separate `planText` field on the runtime-context return shape so
 * the docGen base.md template can render it near the prompt top via
 * `{{#if planText}}` (mirrors code job's `state.planText` naming).
 *
 * These tests lock the new shape in place — `planText` carries the
 * sealed body, `runtimeContext` carries Target / Task / Directive
 * only, and the empty-plan path returns an empty `planText` string so
 * the template's gate evaluates Handlebars-falsy.
 */

import { describe, it, expect } from 'vitest';
import { buildRuntimeContext } from '../../src/agents/architect/graph/design/nodes/docGen/intent/system';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';

function freezeState(partial: Partial<DesignGraphState>): DesignGraphState {
  return Object.freeze(partial) as unknown as DesignGraphState;
}

describe('docGen runtimeContext — sealed plan injection (system intent)', () => {
  it('exposes planText separately and keeps it out of runtimeContext when populated', () => {
    const planText = JSON.stringify({
      task: { id: 't', goal: 'something' },
      explorationSummary: 'looked at code',
      decision: { selected: 'A', rationale: 'simpler' },
      documentOutline: [{ section: 'Overview', content: '...' }],
    });

    const state = freezeState({
      planText,
      currentTask: { id: 't', name: 'task', description: 'desc', targetFile: 'be-system-main.md', priority: 1, type: 'doc' as any },
      directive: 'Build a CRUD API',
    });

    const out = buildRuntimeContext(state);
    // Sealed plan is on its own var so the template can render it near
    // the prompt top, above the rules block.
    expect(out.planText).toBe(planText);
    // runtimeContext carries Target / Task / Directive only — the
    // sealed plan body must NOT be in here.
    expect(out.runtimeContext).not.toContain(planText);
    expect(out.runtimeContext).toContain('# Target Document');
    // Legacy header from the pre-split rendering must be absent —
    // would-be regressions that re-inline the sealed plan into
    // runtimeContext would re-introduce this string.
    expect(out.runtimeContext).not.toContain('# Sealed Plan');
  });

  it('returns planText="" when state.planText is empty (Handlebars-falsy gate)', () => {
    const state = freezeState({
      planText: '',
      currentTask: { id: 't', name: 'task', description: 'desc', targetFile: 'be-system-main.md', priority: 1, type: 'doc' as any },
      directive: 'Build a CRUD API',
    });
    const out = buildRuntimeContext(state);
    expect(out.planText).toBe('');
    expect(out.runtimeContext).toContain('# Target Document');
  });

  it('returns planText="" when state.planText is whitespace-only', () => {
    const state = freezeState({
      planText: '   \n  \t  ',
      currentTask: { id: 't', name: 'task', description: 'desc', targetFile: 'be-system-main.md', priority: 1, type: 'doc' as any },
    });
    const out = buildRuntimeContext(state);
    expect(out.planText).toBe('');
  });
});
