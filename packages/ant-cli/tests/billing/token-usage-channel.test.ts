/**
 * Per-model token channel declaration — billing root-cause regression guard.
 *
 * `tokenUsageByModel` is accumulated onto graph state by `accumulateTokenUsage`,
 * but LangGraph silently DROPS writes to any field that is not a declared
 * channel on every node transition. When `tokenUsageByModel` was undeclared the
 * per-model breakdown arrived empty at the worker→orchestrator boundary, so the
 * FE USD/credit badge was blank, the live meter never moved, and billing settle
 * read an empty snapshot and took the no-usage `releaseHold` branch (no debit).
 *
 * This locks the fix: `tokenUsage` + `tokenUsageByModel` MUST be declared
 * channels in every graph that bills — the code graph, the design graph, and
 * the shared Resolvable/Triageable/Detectable chain the planner composes.
 */

import { describe, it, expect } from 'vitest';
import { CodeGraphChannels } from '../../src/agents/architect/graph/code/graph';
import { DesignGraphChannels } from '../../src/agents/architect/graph/design/graph';
import {
  ResolvableFields,
  TriageableFields,
  DetectableFields,
} from '../../src/agents/common/graph/annotationHelpers';

describe('token-usage channels are declared (billing root-cause guard)', () => {
  it('CodeGraphChannels declares tokenUsage + tokenUsageByModel', () => {
    expect(CodeGraphChannels).toHaveProperty('tokenUsage');
    expect(CodeGraphChannels).toHaveProperty('tokenUsageByModel');
  });

  it('DesignGraphChannels declares tokenUsage + tokenUsageByModel', () => {
    expect(DesignGraphChannels).toHaveProperty('tokenUsage');
    expect(DesignGraphChannels).toHaveProperty('tokenUsageByModel');
  });

  it('the shared Resolvable→Triageable→Detectable chain (planner) declares tokenUsageByModel', () => {
    expect(ResolvableFields).toHaveProperty('tokenUsage');
    expect(ResolvableFields).toHaveProperty('tokenUsageByModel');
    // Spread chain must carry it forward — planner composes via DetectableFields.
    expect(TriageableFields).toHaveProperty('tokenUsageByModel');
    expect(DetectableFields).toHaveProperty('tokenUsageByModel');
  });

  it('the tokenUsageByModel channel preserves the accumulated value on an undefined write', () => {
    // A bare last-write-wins channel would let a stray partial-state spread
    // (tokenUsageByModel: undefined) clobber accumulated billing data. The
    // reducer must preserve the previous value when the incoming write is
    // undefined.
    const ch: any = (CodeGraphChannels as any).tokenUsageByModel;
    const reducer = ch?.operator; // LangGraph stores the merge fn on `operator`
    expect(typeof reducer).toBe('function');
    const prev = { 'claude-opus-4-8': { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
    expect(reducer(prev, undefined)).toBe(prev);
    const next = { 'claude-sonnet-4-6': { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    expect(reducer(prev, next)).toBe(next);
  });
});
