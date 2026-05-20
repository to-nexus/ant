/**
 * Heaviest-node mapping completeness — regression guard.
 *
 * Locks that every `IntentId` in `INTENT_DEFINITIONS` has a
 * `HEAVIEST_NODE_BY_INTENT` entry. New intents added to `@ant/shared`
 * MUST be mapped here at the same time; otherwise the baseline endpoint
 * starts returning 400 instead of an estimate.
 */

import { describe, it, expect } from 'vitest';
import { INTENT_DEFINITIONS } from '@ant/shared';
import {
  HEAVIEST_NODE_BY_INTENT,
  heaviestNodeFor,
} from '../../../src/core/baselineEstimate/heaviestNode';

describe('HEAVIEST_NODE_BY_INTENT — completeness', () => {
  it('maps every IntentId in INTENT_DEFINITIONS', () => {
    const missing: string[] = [];
    for (const def of INTENT_DEFINITIONS) {
      if (!(def.id in HEAVIEST_NODE_BY_INTENT)) {
        missing.push(def.id);
      }
    }
    expect(missing).toEqual([]);
  });

  it('heaviestNodeFor returns the table entry verbatim for every intent', () => {
    for (const def of INTENT_DEFINITIONS) {
      const mapping = heaviestNodeFor(def.id);
      expect(mapping).toBe(HEAVIEST_NODE_BY_INTENT[def.id]);
    }
  });

  it('throws on an unknown intent', () => {
    expect(() => heaviestNodeFor('not-a-real-intent' as any)).toThrow(
      /No mapping for intent/,
    );
  });
});
