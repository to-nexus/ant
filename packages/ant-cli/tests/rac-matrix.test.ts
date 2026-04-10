import { describe, it, expect } from 'vitest';
import {
  INTENT_DEFINITIONS,
  deriveFromIntent,
  getConfigSlots,
  getAvailableBases,
} from '@ant/shared';

describe('Action Config Matrix completeness', () => {
  it('every INTENT_DEFINITIONS.id has at least one MATRIX entry', () => {
    for (const def of INTENT_DEFINITIONS) {
      const bases = getAvailableBases(def.id);
      expect(bases.length, `${def.id} should have MATRIX entries`).toBeGreaterThan(0);
    }
  });

  it('deriveFromIntent produces valid agent/jobType for every intent', () => {
    for (const def of INTENT_DEFINITIONS) {
      const derived = deriveFromIntent(def.id);
      expect(derived.agent, `${def.id}.agent`).toBeDefined();
      expect(derived.jobType, `${def.id}.jobType`).toBeDefined();
      expect(['generate', 'refactor', 'explain']).toContain(derived.jobMode);
    }
  });

  it('getConfigSlots returns non-null for every (intent, basis) in MATRIX', () => {
    for (const def of INTENT_DEFINITIONS) {
      const bases = getAvailableBases(def.id);
      for (const basis of bases) {
        const slots = getConfigSlots(def.id, basis);
        expect(slots, `${def.id}/${basis}`).not.toBeNull();
        expect(slots!.refs).toBeDefined();
        expect(slots!.context).toBeDefined();
        expect(slots!.target).toBeDefined();
      }
    }
  });

  it('create intents have target.dir or target.codebase', () => {
    const createIntents = INTENT_DEFINITIONS.filter(d => d.id.startsWith('create-'));
    for (const def of createIntents) {
      const bases = getAvailableBases(def.id);
      for (const basis of bases) {
        const slots = getConfigSlots(def.id, basis);
        expect(
          slots!.target.dir || slots!.target.codebase,
          `${def.id}/${basis} should have target.dir or target.codebase`,
        ).toBeTruthy();
      }
    }
  });

  it('revise intents have target.mirrorRefs', () => {
    const reviseIntents = INTENT_DEFINITIONS.filter(d => d.id.startsWith('revise-') || d.id.startsWith('refactor-'));
    for (const def of reviseIntents) {
      const bases = getAvailableBases(def.id);
      for (const basis of bases) {
        const slots = getConfigSlots(def.id, basis);
        const hasMirror = slots!.target.mirrorRefs;
        const hasCodebase = slots!.target.codebase;
        expect(
          hasMirror || hasCodebase,
          `${def.id}/${basis} should have mirrorRefs or codebase target`,
        ).toBeTruthy();
      }
    }
  });
});
