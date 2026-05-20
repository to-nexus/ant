/**
 * Compaction-aware baseline estimator (PR-2).
 *
 * Single-call orchestrator that produces a `BaselineEstimate` for the
 * heaviest LLM call the next job will make. The pipeline is intentionally
 * minimal — no graph evaluation, no LLM tool execution — and reuses
 * production SSOTs so drift between estimate and live call is bounded:
 *
 *   1. `heaviestNodeFor(intent)`            → (job, node) lookup
 *   2. `buildMockStateForIntent({...})`     → RAC + featurePath
 *   3. `applyNodeCompaction(artifacts,node)`→ first-call injection form
 *   4. `PromptBuilder.build({...})`         → system + user strings
 *   5. `countTokens({...})`                 → 1-call total
 *
 * Sub-fields (`staticFloor.tokens` / `dynamic.racBodyTokens` /
 * `dynamic.userMessageTokens`) are stamped `0` — the FE `TurnTokenRing`
 * only consumes the aggregate `total`. A future UI surface that visualises
 * the decomposition can extend the estimator to a 4-call breakdown without
 * a schema change.
 */

import type {
  BaselineEstimate,
  IntentId,
  ResolvedArtifact,
} from '@ant/shared';
import { getModelContextWindow } from '@ant/shared';
import type { StateStorePort } from '../ports/stateStore';
import { PromptBuilder } from '../prompt/builder/PromptBuilder';
import { FilePromptAdapter } from '../../periphery/adapters/prompt/FilePromptAdapter';
import { heaviestNodeFor } from './heaviestNode';
import { buildMockStateForIntent } from './mockState';
import { applyNodeCompaction } from './applyNodeCompaction';
import { getToolDefsFor } from './toolDefs';
import { countTokens } from './tokenCounter';
import {
  type BaselineCacheScope,
  fingerprintDraft,
  fingerprintRac,
  getCached,
  setCached,
} from './cache';

export interface EstimateBaselineInput {
  intent: IntentId;
  featurePath: string;
  refs: string[];
  context: string[];
  draftText?: string;
  modelId: string;
  tenantScope: {
    orgId: string;
    userId: string;
    projectId: string;
    featureName: string;
  };
  stateStore: StateStorePort;
}

/**
 * Compute (or fetch from cache) a baseline estimate. Throws `BaselineEstimateError`
 * with a stable `kind` string so the HTTP layer can map to 4xx / 503 cleanly.
 */
export async function estimateBaseline(
  input: EstimateBaselineInput,
): Promise<BaselineEstimate> {
  const { intent, featurePath, refs, context, draftText, modelId, tenantScope, stateStore } = input;

  let mapping;
  try {
    mapping = heaviestNodeFor(intent);
  } catch (err) {
    throw new BaselineEstimateError('intent-unmapped', (err as Error).message);
  }

  // Validate the model BEFORE any disk / Anthropic work so a bad modelId
  // fails fast as 400 (`unknown-model`) instead of after a wasted
  // countTokens roundtrip that would surface as a misleading 503
  // (`count-tokens-unavailable`).
  let contextWindow: number;
  try {
    contextWindow = getModelContextWindow(modelId);
  } catch (err) {
    throw new BaselineEstimateError('unknown-model', (err as Error).message);
  }

  const mock = buildMockStateForIntent({ intent, refs, context, featurePath });
  const compacted: ResolvedArtifact[] = applyNodeCompaction(mock.artifacts, mapping.node);

  const racFingerprint = fingerprintRac(compacted);
  const draftHash = fingerprintDraft(draftText);
  const scope: BaselineCacheScope = {
    ...tenantScope,
    intent,
    modelId,
    racFingerprint,
    draftHash,
  };

  const cached = await getCached(stateStore, scope);
  if (cached) return cached;

  const built = await buildPromptStrings({
    job: mapping.job,
    node: mapping.node,
    resolvedAction: mock.resolvedAction,
    compacted,
    draftText: draftText ?? '',
  });

  const tools = getToolDefsFor(mapping.job, mapping.node);

  let total: number;
  try {
    total = await countTokens({
      model: modelId,
      system: built.system,
      userText: built.user,
      tools,
    });
  } catch (err) {
    throw new BaselineEstimateError(
      'count-tokens-unavailable',
      (err as Error).message ?? 'unknown',
    );
  }

  const estimate: BaselineEstimate = {
    heaviestNode: {
      job: mapping.job,
      node: mapping.node,
      reason: mapping.reason,
    },
    staticFloor: { tokens: 0 },
    dynamic: { racBodyTokens: 0, userMessageTokens: 0 },
    total,
    contextWindow,
    modelId,
    timing: 'T0',
  };

  await setCached(stateStore, scope, estimate);
  return estimate;
}

interface BuildArgs {
  job: string;
  node: string;
  resolvedAction: ReturnType<typeof buildMockStateForIntent>['resolvedAction'];
  compacted: ResolvedArtifact[];
  draftText: string;
}

async function buildPromptStrings(args: BuildArgs): Promise<{ system: string; user: string }> {
  const adapter = new FilePromptAdapter();
  const builder = new PromptBuilder(adapter);

  // Wire the heaviest node's template paths. We point at the default
  // `base` / `rules` / `system` triplet for each (job, node) — the
  // estimator targets order-of-magnitude faithfulness for the heaviest
  // node's first call, not the exact variant the production graph might
  // select (variant drift is bounded by the dominant 30K compaction
  // budget on artifacts, which IS faithfully reproduced).
  const base = `jobs/${args.job}/nodes/${args.node}/base`;
  const rules = `jobs/${args.job}/nodes/${args.node}/rules`;
  const system = `jobs/${args.job}/base/system`;

  const built = await builder.build({
    templates: { base, rules, system },
    intent: args.resolvedAction.intent,
    techContext: {
      taskType: 'feature',
      mode: args.resolvedAction.mode,
      resolvedAction: args.resolvedAction,
    },
    pipeline: {
      sanitizeInput: false,
      applyPolicyGuardrails: false,
    },
    vars: {
      userMessage: args.draftText,
      resolvedAction: args.resolvedAction,
    },
    artifacts: args.compacted,
  });

  return { system: built.system, user: built.user };
}

export type BaselineEstimateErrorKind =
  | 'intent-unmapped'
  | 'unknown-model'
  | 'count-tokens-unavailable';

export class BaselineEstimateError extends Error {
  constructor(public readonly kind: BaselineEstimateErrorKind, message: string) {
    super(message);
    this.name = 'BaselineEstimateError';
  }
}
