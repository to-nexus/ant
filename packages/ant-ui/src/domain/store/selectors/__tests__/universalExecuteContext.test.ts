/**
 * Universal execute-context selector — the ONE mapping home consumed by BOTH
 * job-start paths (useChatSubmit's normal path and useJobExecution.runJob's
 * new-job path, e.g. a clarify-card submit). Locks the contract that a
 * universal job start always carries jobType/agent 'universal', skipTriage,
 * and the composite customJobRef — without it the BE would start a canonical
 * job against a workspace project.
 */

import { describe, it, expect } from 'vitest';
import { selectUniversalExecuteContext, selectUniversalBuildExecuteContext } from '../universalExecuteContext';

const emptyMeta = { intents: [], context: [], plan: false };

function fakeState(overrides: Partial<Parameters<typeof selectUniversalExecuteContext>[0]> = {}) {
  return {
    projectType: 'universal' as const,
    selectedCustomAgentId: 'ops-team',
    selectedCustomJobId: 'weekly-report',
    universalTurnMeta: emptyMeta,
    ...overrides,
  };
}

describe('selectUniversalExecuteContext', () => {
  it('maps the selected pair onto the universal execute identity', () => {
    const ctx = selectUniversalExecuteContext(fakeState());
    expect(ctx).toEqual({
      customJobRef: 'ops-team/weekly-report',
      jobType: 'universal',
      agent: 'universal',
      skipTriage: true,
      intents: undefined,
      context: undefined,
      plan: undefined,
    });
  });

  it.each([
    ['canonical project', { projectType: 'canonical' as const }],
    ['no agent selected', { selectedCustomAgentId: undefined }],
    ['no job selected', { selectedCustomJobId: undefined }],
  ])('returns null on %s', (_label, overrides) => {
    expect(selectUniversalExecuteContext(fakeState(overrides))).toBeNull();
  });

  it('forwards accumulated turn meta only when non-empty', () => {
    const ctx = selectUniversalExecuteContext(
      fakeState({ universalTurnMeta: { intents: ['incident'], context: ['reports/w.md'], plan: true } }),
    );
    expect(ctx?.intents).toEqual(['incident']);
    expect(ctx?.context).toEqual(['reports/w.md']);
    expect(ctx?.plan).toBe(true);
  });
});

/**
 * The Actions-tab Build button owns exactly one thing: the intent slot. Armed
 * `@ctx` / `@plan` are the user's explicit input and ride the run — a Build that
 * reset the whole turn meta first shipped with no material (major-leaning-depth).
 */
describe('selectUniversalBuildExecuteContext — Build replaces the intent slot only', () => {
  it('forwards pre-armed context and plan; the intent becomes the page intent', () => {
    const ctx = selectUniversalBuildExecuteContext(
      fakeState({ universalTurnMeta: { intents: [], context: ['resource/spec.html'], plan: true } }),
      'build',
    );
    expect(ctx?.intents).toEqual(['build']);
    expect(ctx?.context).toEqual(['resource/spec.html']);
    expect(ctx?.plan).toBe(true);
  });

  it('replaces a different pre-armed intent instead of accumulating (single slot)', () => {
    const ctx = selectUniversalBuildExecuteContext(
      fakeState({ universalTurnMeta: { intents: ['review'], context: ['a.md'], plan: false } }),
      'build',
    );
    expect(ctx?.intents).toEqual(['build']);
    expect(ctx?.context).toEqual(['a.md']);
    expect(ctx?.plan).toBeUndefined();
  });

  it('with nothing armed, sends only the intent', () => {
    const ctx = selectUniversalBuildExecuteContext(fakeState(), 'build');
    expect(ctx).toMatchObject({ customJobRef: 'ops-team/weekly-report', intents: ['build'] });
    expect(ctx?.context).toBeUndefined();
    expect(ctx?.plan).toBeUndefined();
  });

  it.each([
    ['canonical project', { projectType: 'canonical' as const }],
    ['no job selected', { selectedCustomJobId: undefined }],
  ])('returns null on %s', (_label, overrides) => {
    expect(selectUniversalBuildExecuteContext(fakeState(overrides), 'build')).toBeNull();
  });

  it('is pure — the input state and its turn meta are untouched', () => {
    const meta = { intents: ['review'], context: ['a.md'], plan: false };
    const state = fakeState({ universalTurnMeta: meta });
    selectUniversalBuildExecuteContext(state, 'build');
    expect(state.universalTurnMeta).toBe(meta);
    expect(meta).toEqual({ intents: ['review'], context: ['a.md'], plan: false });
  });
});
