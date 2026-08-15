/**
 * plan_complete card — continuation-pin derivation.
 *
 * The card's follow-up turn pins from the CARD PAYLOAD (the plan turn's
 * sealed turnContext), never the live composer selection. `general` pins
 * nothing — the follow-up re-resolves explicit → catalog default → general
 * deterministically on the BE — while a default-resolved intent id IS
 * pinned, freezing the plan's actual intent against later catalog edits.
 */

import { describe, it, expect } from 'vitest';
import { planContinuationPins } from '@/presentation/components/chat/choiceCard/planContinuation';

describe('planContinuationPins — payload → follow-up turn pins', () => {
  it.each([
    ['pinned multi-intents carry over',
      { intents: ['research', 'cite'], planFiles: ['plan/ops/weekly/plan.md'] },
      { intents: ['research', 'cite'], context: ['plan/ops/weekly/plan.md'] }],
    ['general pins nothing — BE re-resolves deterministically',
      { intents: ['general'], planFiles: ['plan/ops/weekly/plan.md'] },
      { intents: undefined, context: ['plan/ops/weekly/plan.md'] }],
    ['default-resolved intent id IS pinned',
      { intents: ['report'], planFiles: ['plan/ops/weekly/plan.md'] },
      { intents: ['report'], context: ['plan/ops/weekly/plan.md'] }],
    ['general is filtered out of a mixed list',
      { intents: ['general', 'report'], planFiles: [] },
      { intents: ['report'], context: undefined }],
    ['empty payload → both undefined',
      {},
      { intents: undefined, context: undefined }],
    ['non-string entries are dropped',
      { intents: ['report', 42], planFiles: [null, 'plan/a.md'] },
      { intents: ['report'], context: ['plan/a.md'] }],
  ] as const)('%s', (_label, payload, expected) => {
    expect(planContinuationPins(payload as any)).toEqual(expected);
  });
});
