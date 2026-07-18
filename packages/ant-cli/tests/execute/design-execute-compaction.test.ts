/**
 * Design execute compaction parity — window-keyed compactParams
 * (dim-beating-brass twin-site, surfaced by sandy-building-dryad).
 *
 * Design spec/system execute called composeMessages WITHOUT compactParams,
 * so history compacted at the 50K default with a 5-turn hot tail — evicting
 * already-gathered exploration mid-task (sandy-building-dryad: 20 turns of
 * reads collapsed to an 11-line summary on the turn before the no-output
 * breaker). Code execute already keys the threshold to the real model window
 * (code/nodes/execute/buildMessages.ts). Contracts locked here:
 *
 *   1. UNIT — deriveExecuteCompactParams falls back to the legacy 200K window
 *      (threshold well above the 50K default) and never throws on unknown
 *      models.
 *   2. STATIC — both design execute intent builders (spec, system) pass
 *      compactParams to composeMessages.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deriveExecuteCompactParams } from '../../src/agents/architect/graph/design/nodes/execute/intent/executeCompaction';

const INTENT_DIR = path.resolve(
  __dirname,
  '../../src/agents/architect/graph/design/nodes/execute/intent',
);

describe('deriveExecuteCompactParams — unit', () => {
  it('falls back to the 200K window without an LLM client (threshold ≫ 50K default)', () => {
    const params = deriveExecuteCompactParams({} as any);
    // window 200K → historyBudget = max(75K, min(140K, 95K)) = 95K → 0.9 keying
    expect(params.autoCompactThreshold).toBe(85_500);
    expect(params.autoCompactHotTail).toBe(8);
    expect(params.autoCompactThreshold).toBeGreaterThan(50_000);
  });

  it('never throws on an unknown modelId (model-table gap must not break composition)', () => {
    const state = { deps: { llm: { provider: 'x', modelName: 'totally-unknown-model' } } } as any;
    const params = deriveExecuteCompactParams(state);
    expect(params.autoCompactThreshold).toBe(85_500);
  });
});

describe('design execute intents — composeMessages receives compactParams', () => {
  it.each([['spec.ts'], ['system.ts']])('%s wires deriveExecuteCompactParams', (file) => {
    const src = readFileSync(path.resolve(INTENT_DIR, file), 'utf8');
    expect(src).toContain('compactParams: deriveExecuteCompactParams(state)');
  });
});
