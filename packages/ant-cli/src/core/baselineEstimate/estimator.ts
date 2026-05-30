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
import { PromptBuilder, PromptBuilderCriticalTemplateError } from '../prompt/builder/PromptBuilder';
import { FilePromptAdapter } from '../../periphery/adapters/prompt/FilePromptAdapter';
import { heaviestNodeFor, type HeaviestNodeMapping } from './heaviestNode';
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

  let built: { system: string; user: string };
  try {
    built = await buildPromptStrings({
      mapping,
      resolvedAction: mock.resolvedAction,
      compacted,
      draftText: draftText ?? '',
    });
  } catch (err) {
    if (err instanceof PromptBuilderCriticalTemplateError) {
      throw new BaselineEstimateError(
        'template-mapping-stale',
        `heaviestNode.templates points at stale paths: ${err.failedTemplates.join(', ')}. ` +
        `Update TEMPLATE_PATHS or the heaviestNode entry for intent "${intent}".`,
      );
    }
    throw err;
  }

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
  mapping: HeaviestNodeMapping;
  resolvedAction: ReturnType<typeof buildMockStateForIntent>['resolvedAction'];
  compacted: ResolvedArtifact[];
  draftText: string;
}

async function buildPromptStrings(args: BuildArgs): Promise<{ system: string; user: string }> {
  const adapter = new FilePromptAdapter();
  const builder = new PromptBuilder(adapter);

  // Templates come from the heaviest-node mapping, which is the same
  // `TEMPLATE_PATHS` reference the production graph builder consumes. Path
  // drift is locked at compile-time by the path-existence regression test.
  const built = await builder.build({
    templates: args.mapping.templates,
    intent: args.resolvedAction.intent,
    techContext: {
      taskType: 'feature',
      mode: args.resolvedAction.mode,
      resolvedAction: args.resolvedAction,
    },
    pipeline: {
      sanitizeInput: false,
      applyPolicyGuardrails: false,
      // Surface stale path mapping as a typed error instead of a silently
      // truncated estimate. `estimateBaseline` catches and maps to a 503
      // (`template-mapping-stale`) so the FE gauge stays in its no-baseline
      // state rather than displaying a fabricated low number.
      failOnCriticalTemplateMiss: true,
    },
    vars: {
      userMessage: args.draftText,
      resolvedAction: args.resolvedAction,
      // Silence self-gated partials that branch on user locale / workspace
      // existence. The estimator runs before the user submits, so locale
      // detection has not happened yet — assume English (the prevailing
      // workspace default; partial renders to empty body when language is
      // English). `workspaceState` undefined keeps the codebase-channel
      // partial self-gate closed (greenfield assumption).
      userLanguage: 'en',
      workspaceState: undefined,
    },
    artifacts: args.compacted,
  });

  return { system: built.system, user: built.user };
}

export type BaselineEstimateErrorKind =
  | 'intent-unmapped'
  | 'unknown-model'
  | 'count-tokens-unavailable'
  | 'template-mapping-stale';

export class BaselineEstimateError extends Error {
  constructor(public readonly kind: BaselineEstimateErrorKind, message: string) {
    super(message);
    this.name = 'BaselineEstimateError';
  }
}
