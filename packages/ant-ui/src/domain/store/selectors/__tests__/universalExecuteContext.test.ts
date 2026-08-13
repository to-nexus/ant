/**
 * Universal execute-context selector — the ONE mapping home consumed by BOTH
 * job-start paths (useChatSubmit's normal path and useJobExecution.runJob's
 * new-job path, e.g. a clarify-card submit). Locks the contract that a
 * universal job start always carries jobType/agent 'universal', skipTriage,
 * and the composite customJobRef — without it the BE would start a canonical
 * job against a workspace project.
 */

import { describe, it, expect } from 'vitest';
import { selectUniversalExecuteContext } from '../universalExecuteContext';

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
