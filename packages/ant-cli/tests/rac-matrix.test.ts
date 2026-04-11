import { describe, it, expect } from 'vitest';
import {
  INTENT_DEFINITIONS,
  deriveFromIntent,
  getConfigSlots,
} from '@ant/shared';

describe('Action Config Matrix completeness', () => {
  it('every INTENT_DEFINITIONS.id has a MATRIX entry', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      expect(slots, `${def.id} should have MATRIX entry`).not.toBeNull();
    }
  });

  it('deriveFromIntent produces valid agent/jobType for every intent', () => {
    for (const def of INTENT_DEFINITIONS) {
      const derived = deriveFromIntent(def.id);
      expect(derived.agent, `${def.id}.agent`).toBeDefined();
      expect(derived.jobType, `${def.id}.jobType`).toBeDefined();
      expect(['generate', 'refactor', 'explain']).toContain(derived.mode);
    }
  });

  it('getConfigSlots returns complete slots for every intent in MATRIX', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      expect(slots, def.id).not.toBeNull();
      expect(slots!.refs).toBeDefined();
      expect(slots!.context).toBeDefined();
      expect(slots!.target).toBeDefined();
    }
  });

  it('generate-mode intents have target.dir or target.codebase', () => {
    const genIntents = INTENT_DEFINITIONS.filter(d => deriveFromIntent(d.id).mode === 'generate');
    for (const def of genIntents) {
      const slots = getConfigSlots(def.id);
      expect(
        slots!.target.dir || slots!.target.codebase,
        `${def.id} should have target.dir or target.codebase`,
      ).toBeTruthy();
    }
  });

  it('refactor-mode intents have target.mirrorRefs or target.codebase', () => {
    const revIntents = INTENT_DEFINITIONS.filter(d => deriveFromIntent(d.id).mode === 'refactor');
    for (const def of revIntents) {
      const slots = getConfigSlots(def.id);
      const hasMirror = slots!.target.mirrorRefs;
      const hasCodebase = slots!.target.codebase;
      expect(
        hasMirror || hasCodebase,
        `${def.id} should have mirrorRefs or codebase target`,
      ).toBeTruthy();
    }
  });
});
