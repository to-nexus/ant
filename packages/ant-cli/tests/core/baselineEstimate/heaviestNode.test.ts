/**
 * Heaviest-node mapping completeness — regression guard.
 *
 * Locks that every `IntentId` in `INTENT_DEFINITIONS` (except the explicitly
 * retired visual / explain-visual intents) has a `HEAVIEST_NODE_BY_INTENT`
 * entry. Visual intents are image-generation — they intentionally fall
 * through to `intent-unmapped` (400) so the FE TurnTokenRing stays hidden
 * rather than fabricating a PromptBuilder-based text-token estimate.
 */

import { describe, it, expect } from 'vitest';
import { INTENT_DEFINITIONS, type IntentId } from '@ant/shared';
import {
  HEAVIEST_NODE_BY_INTENT,
  heaviestNodeFor,
} from '../../../src/core/baselineEstimate/heaviestNode';

const RETIRED_VISUAL_INTENTS: IntentId[] = [
  'gen-visual-logo',
  'gen-visual-icon',
  'gen-visual-hero',
  'gen-visual-illustration',
  'explain-visual',
];

describe('HEAVIEST_NODE_BY_INTENT — completeness', () => {
  it('maps every non-visual IntentId in INTENT_DEFINITIONS', () => {
    const missing: string[] = [];
    for (const def of INTENT_DEFINITIONS) {
      if (RETIRED_VISUAL_INTENTS.includes(def.id)) continue;
      if (!(def.id in HEAVIEST_NODE_BY_INTENT)) {
        missing.push(def.id);
      }
    }
    expect(missing).toEqual([]);
  });

  it('intentionally does NOT map retired visual intents', () => {
    for (const id of RETIRED_VISUAL_INTENTS) {
      expect(id in HEAVIEST_NODE_BY_INTENT).toBe(false);
    }
  });

  it('heaviestNodeFor returns the table entry verbatim for every mapped intent', () => {
    for (const def of INTENT_DEFINITIONS) {
      if (RETIRED_VISUAL_INTENTS.includes(def.id)) continue;
      const mapping = heaviestNodeFor(def.id);
      expect(mapping).toBe(HEAVIEST_NODE_BY_INTENT[def.id]);
    }
  });

  it('heaviestNodeFor throws for retired visual intents', () => {
    for (const id of RETIRED_VISUAL_INTENTS) {
      expect(() => heaviestNodeFor(id)).toThrow(/No mapping for intent/);
    }
  });

  it('throws on an unknown intent', () => {
    expect(() => heaviestNodeFor('not-a-real-intent' as any)).toThrow(
      /No mapping for intent/,
    );
  });
});
