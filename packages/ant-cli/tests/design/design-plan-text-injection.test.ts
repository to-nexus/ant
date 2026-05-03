/**
 * Sealed-plan injection contract (design docGen).
 *
 * The plan node hands a sealed `<plan>` JSON to docGen via
 * `state.planText`. docGen's spec/system intent prompt builders must
 * prepend it as `# Sealed Plan (from plan node)` so the spec/system
 * rules.md "Sealed Plan" section finds the contract it describes.
 *
 * These tests poke the `buildRuntimeContext` (system) and the inline
 * runtime-lines builder (spec) to lock the injection in place — a
 * regression here would silently strip the plan context that docGen's
 * "no redesign" rules depend on.
 */

import { describe, it, expect } from 'vitest';
import { buildRuntimeContext } from '../../src/agents/architect/graph/design/nodes/docGen/intent/system';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';

function freezeState(partial: Partial<DesignGraphState>): DesignGraphState {
  return Object.freeze(partial) as unknown as DesignGraphState;
}

describe('docGen runtimeContext — sealed plan injection (system intent)', () => {
  it('prepends planText as "# Sealed Plan" when populated', () => {
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
    expect(out).toContain('# Sealed Plan (from plan node)');
    expect(out.indexOf('# Sealed Plan')).toBeLessThan(out.indexOf('# Target Document'));
    expect(out).toContain(planText);
  });

  it('omits the Sealed Plan header when planText is empty', () => {
    const state = freezeState({
      planText: '',
      currentTask: { id: 't', name: 'task', description: 'desc', targetFile: 'be-system-main.md', priority: 1, type: 'doc' as any },
      directive: 'Build a CRUD API',
    });
    const out = buildRuntimeContext(state);
    expect(out).not.toContain('# Sealed Plan');
    expect(out).toContain('# Target Document');
  });

  it('omits the Sealed Plan header when planText is whitespace-only', () => {
    const state = freezeState({
      planText: '   \n  \t  ',
      currentTask: { id: 't', name: 'task', description: 'desc', targetFile: 'be-system-main.md', priority: 1, type: 'doc' as any },
    });
    const out = buildRuntimeContext(state);
    expect(out).not.toContain('# Sealed Plan');
  });
});
