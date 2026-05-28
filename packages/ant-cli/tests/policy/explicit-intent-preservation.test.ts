/**
 * Explicit intent preservation invariant.
 *
 * Pins the SSOT-aligned gates in `createDetectNode` and
 * `createInferDetectNode` after the `explicit-infer-imperative-naur`
 * regression:
 *
 *   Before: Triage skipped LLM on `actionMetadata.intent` presence, but
 *   Detect required a separate `actionMetadata.explicit === true` boolean
 *   flag. When the FE submitted `{ intent: 'gen-plan' }` without the
 *   redundant flag, Detect fell into the infer branch and the LLM could
 *   suggest `rev-plan` as a "missing prerequisite" alternative — silently
 *   overriding the user's explicit choice.
 *
 *   Additional regression: the Phase 0 resume fast-path returned a stored
 *   `resolvedAction` unconditionally, so a session interrupted on `rev-plan`
 *   would leak its `resolvedAction.intent='rev-plan'` into a fresh
 *   `gen-plan` job and Detect would short-circuit before re-resolving.
 *
 * Fix (locked here):
 *   1. Detect's explicit branch fires on `actionMetadata.intent` presence
 *      (same SSOT as Triage).
 *   2. Phase 0 resume fast-path bypasses when the new turn's intent diverges
 *      from the restored intent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ActionMetadata, ResolvedActionContext } from '@ant/shared';
import {
  createDetectNode,
  createInferDetectNode,
} from '../../src/agents/common/graph/nodes/detect/index.js';
import type {
  DetectStrategy,
  DetectableState,
} from '../../src/agents/common/graph/nodes/detect/types.js';

function makeNoopStrategy(): DetectStrategy<DetectableState> {
  return {
    async run() {
      throw new Error('strategy.run should not be called on explicit path');
    },
  };
}

function makeState(
  overrides: Partial<DetectableState> & { actionMetadata?: ActionMetadata; resolvedAction?: ResolvedActionContext },
  featurePath: string,
): DetectableState {
  return {
    featurePath,
    context: { featurePath },
    ...overrides,
  } as DetectableState;
}

function rac(intent: string, source: 'explicit' | 'infer' = 'explicit'): ResolvedActionContext {
  return {
    intent,
    intentGroup: 'gen-plan' as any,
    mode: 'generate',
    source,
    hasExplicitFields: false,
  } as unknown as ResolvedActionContext;
}

describe('Explicit intent preservation — SSOT = actionMetadata.intent presence', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-explicit-intent-'));
  });

  afterAll(() => {
    fs.rmSync(featurePath, { recursive: true, force: true });
  });

  describe('createDetectNode — explicit branch fires on intent presence', () => {
    it('intent set + .explicit absent → explicit branch, RAC.source=explicit, no strategy.run', async () => {
      const node = createDetectNode(makeNoopStrategy());
      // No `.explicit: true` — only `.intent`. Pre-fix this fell to infer.
      const state = makeState(
        { actionMetadata: { intent: 'gen-plan', domain: 'service' } },
        featurePath,
      );

      const result = await node(state);

      expect(result.resolvedAction).toBeDefined();
      expect(result.resolvedAction!.intent).toBe('gen-plan');
      expect(result.resolvedAction!.source).toBe('explicit');
    });

    it('intent absent → falls through to strategy.run (legitimate infer)', async () => {
      let strategyRan = false;
      const strategy: DetectStrategy<DetectableState> = {
        async run() {
          strategyRan = true;
          return {
            inferred: {
              intentId: 'gen-plan' as any,
              reasoning: { intent: 'inferred' },
              sourceJob: 'plan',
            },
            stateUpdates: {},
          };
        },
      };
      const node = createDetectNode(strategy);
      const state = makeState(
        { actionMetadata: { domain: 'service' } /* no intent */ },
        featurePath,
      );

      await node(state);

      expect(strategyRan).toBe(true);
    });
  });

  describe('createDetectNode — resume fast-path guard', () => {
    it('restored intent matches new intent → fast-path runs (continuation)', async () => {
      const node = createDetectNode(makeNoopStrategy());
      const restored = rac('gen-plan');
      const state = makeState(
        {
          actionMetadata: { intent: 'gen-plan' },
          resolvedAction: restored,
        },
        featurePath,
      );

      const result = await node(state);

      // Fast-path returns the restored RAC verbatim (same object identity).
      expect(result.resolvedAction).toBe(restored);
    });

    it('restored intent differs from new intent → fast-path bypassed, new RAC built', async () => {
      const node = createDetectNode(makeNoopStrategy());
      // Stale session restored rev-plan, but new turn wants gen-plan.
      const restored = rac('rev-plan');
      const state = makeState(
        {
          actionMetadata: { intent: 'gen-plan', domain: 'service' },
          resolvedAction: restored,
        },
        featurePath,
      );

      const result = await node(state);

      expect(result.resolvedAction).toBeDefined();
      expect(result.resolvedAction).not.toBe(restored);
      expect(result.resolvedAction!.intent).toBe('gen-plan');
      expect(result.resolvedAction!.source).toBe('explicit');
    });

    it('restored present but new intent absent → fast-path runs (no override claim)', async () => {
      // Legitimate resume — user did not declare a new intent, so the
      // restored RAC stays authoritative.
      const node = createDetectNode(makeNoopStrategy());
      const restored = rac('gen-plan');
      const state = makeState(
        { resolvedAction: restored /* no actionMetadata.intent */ },
        featurePath,
      );

      const result = await node(state);

      expect(result.resolvedAction).toBe(restored);
    });
  });

  describe('createInferDetectNode — same SSOT gates', () => {
    it('intent set + .explicit absent → explicit branch (no inferRacWithTools)', async () => {
      const node = createInferDetectNode();
      const state = makeState(
        { actionMetadata: { intent: 'gen-plan', domain: 'service' } },
        featurePath,
      );
      // Without an LLM dep wired in, infer path would throw. The explicit
      // branch must short-circuit before that.
      const result = await node(state);

      expect(result.resolvedAction).toBeDefined();
      expect(result.resolvedAction!.intent).toBe('gen-plan');
      expect(result.resolvedAction!.source).toBe('explicit');
    });

    it('restored intent diverges → fast-path bypassed', async () => {
      const node = createInferDetectNode();
      const restored = rac('rev-plan');
      const state = makeState(
        {
          actionMetadata: { intent: 'gen-plan', domain: 'service' },
          resolvedAction: restored,
        },
        featurePath,
      );

      const result = await node(state);

      expect(result.resolvedAction).not.toBe(restored);
      expect(result.resolvedAction!.intent).toBe('gen-plan');
    });

    it('restored intent matches → fast-path runs', async () => {
      const node = createInferDetectNode();
      const restored = rac('gen-plan');
      const state = makeState(
        {
          actionMetadata: { intent: 'gen-plan' },
          resolvedAction: restored,
        },
        featurePath,
      );

      const result = await node(state);

      expect(result.resolvedAction).toBe(restored);
    });
  });
});
