/**
 * Feature Context Builder (Phase C — session redesign)
 *
 * Shared helper consumed by code/design resolve nodes to turn the output of
 * `SessionPort.loadSinceBoundary()` into a `featureContext` state field that
 * plan/direct prompts can inject as prior-context reminders.
 *
 * Responsibilities:
 *  - Merge `user_turn_meta` patch lines into their owning `user_turn` by
 *    `turnId` (executionTier / reason → the same line).
 *  - Drop collapsed lines (Collapse mechanism is applied at adapter write
 *    time but the reader stays defensive against legacy entries).
 *  - Limit breadcrumbs to the most recent N (window per card spec; defaults
 *    to 5 and is independent from FEATURE_CONTEXT_WINDOW which governs T2).
 *
 * Platform/stack neutral — no direct filesystem or LangGraph types here.
 */

import type { SessionPort } from '../ports/session';
import type { LLMClient } from '../ports/llm';
import type { PromptPort } from '../ports/prompt';
import type {
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBreadcrumbLine,
} from '@ant/shared';
import { FEATURE_CONTEXT_THRESHOLD, FEATURE_CONTEXT_WINDOW } from '@ant/shared';
import { compactJob, type CompactableEntry } from './compactJob';
import { COMPACTION_MAX_OUTPUT_TOKENS } from './constants';
import type { ExecutionTier } from '../executionTier/types';

/* DEFAULT_BREADCRUMB_WINDOW removed by job-context-bridge T5 — token-budget
 * pressure inside compactFeatureContext is now the single arbiter of how
 * many BC lines reach the prompt. Tests that imported the constant should
 * size their fixtures to exercise the compact path directly. */

/**
 * Shape consumed by plan/direct prompt renderers (Handlebars). Keep the
 * user_turn as the base line and surface the meta's `executionTier` as
 * an optional patch so templates can reference either side uniformly.
 *
 * We deliberately intersect with `Omit<FeatureUserTurnMetaLine, 'type'>`'s
 * patch fields — intersecting with the full meta line would collapse the
 * `type` discriminant to `never` ('user_turn' & 'user_turn_meta').
 */
export type MergedUserTurn = FeatureUserTurnLine & {
  executionTier?: FeatureUserTurnMetaLine['executionTier'];
  /**
   * Triage 가 user_turn_meta 로 적재한 intent/mode/domain. 다음 turn 의
   * Triage 가 `featureContext.userTurns[-1].actionMetadata.intent` 로
   * 직전 intent 를 보고 후속 발화 (rev-* / continuation) 추론에 사용.
   */
  actionMetadata?: FeatureUserTurnMetaLine['actionMetadata'];
};

export interface FeatureContext {
  breadcrumbs: FeatureBreadcrumbLine[];
  userTurns: MergedUserTurn[];
  /**
   * LLM-generated summary of older user_turns that were replaced during Compact
   * (§13 compaction_policy). Absent when the context stayed under the
   * `FEATURE_CONTEXT_THRESHOLD` budget or when no compactable old entries
   * existed. Prompt templates render this as a "Prior Context (summary)"
   * block so the model sees a condensed digest instead of the full history.
   */
  summary?: string;
  /** True when `summary` was produced in this build. */
  wasCompacted?: boolean;
}

/**
 * Merge user_turn + user_turn_meta by `turnId`. Pure function — pulled out
 * for unit testing and so the adapter read can be stubbed in tests.
 *
 * job-context-bridge T5: the legacy breadcrumb-window slice was removed
 * here. compactFeatureContext is now the single arbiter of how many BC
 * lines reach the prompt — it folds older BC entries into the MECE
 * summary (Artifacts category) once the combined token estimate crosses
 * `FEATURE_CONTEXT_THRESHOLD`. Without that token-budget pressure every
 * non-collapsed BC flows through; the prompt template still renders a
 * bounded list because the template caller can apply a final per-render
 * cap if needed.
 */
export function mergeFeatureContext(
  input: {
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
    breadcrumbs: FeatureBreadcrumbLine[];
  },
  // Kept for backward compatibility with callers that still pass an
  // explicit window override; ignored when undefined or negative.
  options?: { breadcrumbWindow?: number },
): FeatureContext {
  // Partial-merge by turnId: Triage emits a meta line with `actionMetadata`
  // and Decompose later emits another with `executionTier`. Same-turnId
  // patches accumulate non-destructively so a Triage retry that re-emits
  // intent does not clobber a previously-recorded executionTier.
  const metaByTurn = new Map<
    string,
    Pick<FeatureUserTurnMetaLine, 'executionTier' | 'actionMetadata'>
  >();
  for (const meta of input.userTurnMetas) {
    // Defensive: ignore collapsed meta patches — adapter already filters but
    // legacy entries may slip through.
    if ((meta as { collapsed?: true }).collapsed) continue;
    const prev = metaByTurn.get(meta.turnId);
    metaByTurn.set(meta.turnId, {
      executionTier: meta.executionTier ?? prev?.executionTier,
      actionMetadata: meta.actionMetadata
        ? { ...prev?.actionMetadata, ...meta.actionMetadata }
        : prev?.actionMetadata,
    });
  }

  const merged = input.userTurns
    .filter((turn) => !(turn as { collapsed?: true }).collapsed)
    .map((turn) => {
      const meta = metaByTurn.get(turn.turnId);
      return meta ? { ...turn, ...meta } : turn;
    });

  const liveBreadcrumbs = input.breadcrumbs.filter(
    (bc) => !(bc as { collapsed?: true }).collapsed,
  );

  // Backward compat: callers (tests / specialised resolves) may still pass
  // `breadcrumbWindow` to enforce a hard slice. When undefined every live
  // BC flows through; compact handles overflow downstream.
  const window = options?.breadcrumbWindow;
  const breadcrumbs =
    typeof window === 'number' && window >= 0
      ? window === 0
        ? []
        : liveBreadcrumbs.slice(-window)
      : liveBreadcrumbs;

  return { breadcrumbs, userTurns: merged };
}

/**
 * Load feature.jsonl since the latest boundary and merge into a
 * `FeatureContext` ready for prompt injection. Returns `undefined` when the
 * session port is not wired (e.g. tests bypassing adapters) so callers can
 * keep the state field optional.
 */
export async function buildFeatureContext(
  session: SessionPort | undefined,
  options?: { breadcrumbWindow?: number },
): Promise<FeatureContext | undefined> {
  if (!session) return undefined;

  let loaded: {
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
    breadcrumbs: FeatureBreadcrumbLine[];
  };
  try {
    loaded = await session.loadSinceBoundary();
  } catch (err) {
    console.warn('⚠️  [FeatureContext] loadSinceBoundary failed:', err);
    return { breadcrumbs: [], userTurns: [] };
  }

  return mergeFeatureContext(loaded, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// §13 compaction_policy — Compact mechanism
//
// Collapse (Hard Reset only after job-context-bridge T2) is handled at
// write time by FileSessionAdapter.appendBoundary. Compact is the
// orthogonal safety net: when the combined user_turn + breadcrumb payload
// crosses FEATURE_CONTEXT_THRESHOLD, the older entries from BOTH channels
// are folded into a single MECE summary while the most recent
// FEATURE_CONTEXT_WINDOW user_turns (and the breadcrumbs at or after the
// window cutoff timestamp) stay intact.
//
// Updated by job-context-bridge T5 — breadcrumbs are no longer
// "bounded by design": once auto boundaries are gone they can accumulate
// indefinitely, so compact must include them.
// ─────────────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 2.8;

function estimateTurnsTokens(turns: MergedUserTurn[]): number {
  return turns.reduce(
    (sum, turn) => sum + Math.ceil((turn.text || '').length / CHARS_PER_TOKEN),
    0,
  );
}

function formatBreadcrumbAsContent(bc: FeatureBreadcrumbLine): string {
  const stats = [
    typeof bc.stats?.created === 'number' ? `created ${bc.stats.created}` : '',
    typeof bc.stats?.modified === 'number' ? `modified ${bc.stats.modified}` : '',
    typeof bc.stats?.deleted === 'number' ? `deleted ${bc.stats.deleted}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const anchorParts: string[] = [];
  if (bc.anchors.specs?.length) anchorParts.push(`specs: ${bc.anchors.specs.join(', ')}`);
  if (bc.anchors.paths?.length) anchorParts.push(`paths: ${bc.anchors.paths.join(', ')}`);
  if (bc.anchors.files?.length) anchorParts.push(`files: ${bc.anchors.files.join(', ')}`);
  const anchors = anchorParts.length > 0 ? ` | ${anchorParts.join(' | ')}` : '';
  const statsTag = stats ? ` (${stats})` : '';
  return `[${bc.scope}] ${bc.summary}${statsTag}${anchors}`;
}

function estimateBreadcrumbsTokens(bcs: FeatureBreadcrumbLine[]): number {
  return bcs.reduce(
    (sum, bc) =>
      sum + Math.ceil(formatBreadcrumbAsContent(bc).length / CHARS_PER_TOKEN),
    0,
  );
}

/** Shape the plan/direct templates receive after Compact runs. */
export interface CompactFeatureContextOptions {
  /** Override FEATURE_CONTEXT_THRESHOLD (tokens). */
  threshold?: number;
  /** Override FEATURE_CONTEXT_WINDOW (recent user_turns kept intact). */
  windowSize?: number;
}

export interface CompactFeatureContextDeps {
  llm: LLMClient;
  promptPort: PromptPort;
}

/**
 * Run LLM-based Compact on a `FeatureContext` when its user_turn + BC
 * payload exceeds the budget. Returns a new `FeatureContext` with:
 *  - `userTurns` trimmed to the last `windowSize` entries,
 *  - `breadcrumbs` trimmed to those at or after the window-cutoff
 *    timestamp (i.e. BCs that "belong to" the kept user_turns),
 *  - `summary` populated with the LLM-generated digest of the older
 *    user_turns AND older BCs (BCs labelled as Artifacts in the prompt),
 *  - `wasCompacted = true`.
 *
 * No-ops (returning the input unchanged) when:
 *  - combined token estimate is within threshold,
 *  - or fewer than `windowSize + 1` user_turns exist (nothing to compact),
 *  - or the LLM call throws (graceful degradation — original ctx preserved,
 *    caller keeps full user_turns + BCs for the prompt).
 */
export async function compactFeatureContext(
  ctx: FeatureContext,
  deps: CompactFeatureContextDeps,
  options?: CompactFeatureContextOptions,
): Promise<FeatureContext> {
  const threshold = options?.threshold ?? FEATURE_CONTEXT_THRESHOLD;
  const windowSize = options?.windowSize ?? FEATURE_CONTEXT_WINDOW;

  if (ctx.userTurns.length <= windowSize) return ctx;

  const totalTokens =
    estimateTurnsTokens(ctx.userTurns) +
    estimateBreadcrumbsTokens(ctx.breadcrumbs);
  if (totalTokens <= threshold) return ctx;

  const keptUserTurns = ctx.userTurns.slice(-windowSize);
  const oldUserTurns = ctx.userTurns.slice(0, -windowSize);
  const cutoffTs = keptUserTurns[0]?.ts ?? '';
  // BCs at or after the window-cutoff are "fresh" enough to flow through
  // verbatim — they correspond to the kept user_turns. Earlier BCs go
  // into the summary as MECE Artifacts so their anchor info survives in
  // condensed form rather than being cut by the old fixed window.
  const oldBreadcrumbs = ctx.breadcrumbs.filter((bc) => !cutoffTs || bc.ts < cutoffTs);
  const keptBreadcrumbs = ctx.breadcrumbs.filter((bc) => !cutoffTs || bc.ts >= cutoffTs);

  // Mix old user_turns + old BCs in chronological order so the LLM sees
  // a single timeline. role='breadcrumb' renders as MECE "Artifact".
  const entries: CompactableEntry[] = [
    ...oldUserTurns.map((turn) => ({
      role: 'user',
      content: turn.text || '',
      timestamp: turn.ts,
    })),
    ...oldBreadcrumbs.map((bc) => ({
      role: 'breadcrumb',
      content: formatBreadcrumbAsContent(bc),
      timestamp: bc.ts,
    })),
  ].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

  try {
    const result = await compactJob(entries, deps.llm, deps.promptPort, {
      // The recentWindowSize here is unused by compactJob's own slice
      // because we already partitioned old vs kept above. Pass 0 to
      // signal "all entries are old" to compactJob.
      threshold,
      recentWindowSize: 0,
      maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
    });
    if (!result.wasCompacted || !result.summary) return ctx;

    return {
      ...ctx,
      userTurns: keptUserTurns,
      breadcrumbs: keptBreadcrumbs,
      summary: result.summary,
      wasCompacted: true,
    };
  } catch (err) {
    console.warn('⚠️  [FeatureContext] Compact failed, keeping full context:', err);
    return ctx;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 resolve integration — hydrateFeatureContext
//
// Shared SSOT helper used by code + design `resolve` strategies on both the
// initial (`loadArtifacts`) and resume (`onResume`) paths. Centralizes:
//
//   1. build featureContext from feature.jsonl (loadSinceBoundary + merge)
//   2. run Compact (§13) when llm/promptPort are wired
//   3. recover the current `turnId` by matching owning `jobId`
//
// Having a single entry point prevents the resume-path defect where
// `featureContext` was rebuilt but `turnId` was forgotten, causing silent
// failures in downstream tool/direct/learn consumers that rely on turnId to
// attribute trace events and breadcrumb/boundary lines.
// ─────────────────────────────────────────────────────────────────────────────

export interface HydrateFeatureContextDeps {
  session: SessionPort | undefined;
  llm?: LLMClient;
  promptPort?: PromptPort;
}

export interface HydrateFeatureContextInput {
  /** Job id owning the current turn — used to recover `turnId`. */
  jobId?: string;
  /** Optional overrides for breadcrumb window / compaction thresholds. */
  breadcrumbWindow?: number;
  compact?: CompactFeatureContextOptions;
  /** Log prefix, e.g. `Resolve` or `Design Resolve` for consistent output. */
  logPrefix?: string;
  /**
   * Execution tier whose `compact` strategy should gate the safety-net
   * compaction (§13). When omitted the caller accepts the unconditional
   * {@link compactFeatureContext} path (backward-compatible with callers
   * that predate the 5-tier refactor). Phase nodes SHOULD pass
   * `getExecutionTier(state)` so mode/complexity literals do not leak out of
   * `core/executionTier/`.
   */
  executionTier?: ExecutionTier;
  /**
   * When `true`, skip the `compactFeatureContext` safety-net entirely. Used
   * by Triage's per-turn re-hydrate so multi-turn jobs don't trigger
   * repeated LLM compaction (cost). Compaction is guaranteed once at job
   * entry (the job's resolve node calls hydrate without `skipCompaction`).
   */
  skipCompaction?: boolean;
}

export interface HydrateFeatureContextResult {
  featureContext?: FeatureContext;
  /** Current turn id resolved by matching `jobId` against feature.jsonl. */
  turnId?: string;
}

export async function hydrateFeatureContext(
  deps: HydrateFeatureContextDeps,
  input: HydrateFeatureContextInput = {},
): Promise<HydrateFeatureContextResult> {
  const logPrefix = input.logPrefix ?? 'Resolve';

  let featureContext = await buildFeatureContext(deps.session, {
    breadcrumbWindow: input.breadcrumbWindow,
  });

  // Resolve turnId from the FULL pre-compact userTurns. Compact trims the
  // oldest entries down to FEATURE_CONTEXT_WINDOW; if the owning user_turn
  // (the one that created the current job) sits in that older half — a real
  // scenario when a long-paused job resumes after other turns accumulated —
  // running the lookup on the post-compact array returns `undefined` and
  // reintroduces the §12 defect (silent turnId loss → ChatLogAppender /
  // tier.breadcrumb / recordClassificationBias all no-op).
  //
  // Keep this search BEFORE the compact step so the owning turn is always
  // visible, regardless of how aggressively compact trims the tail window.
  let turnId: string | undefined;
  if (featureContext && input.jobId) {
    const owning = featureContext.userTurns.find((t) => t.jobId === input.jobId);
    if (owning?.turnId) turnId = owning.turnId;
  }

  if (featureContext) {
    console.log(
      `📚 [${logPrefix}] featureContext: breadcrumbs=${featureContext.breadcrumbs.length}, userTurns=${featureContext.userTurns.length}`,
    );

    if (deps.llm && deps.promptPort && !input.skipCompaction) {
      const before = featureContext.userTurns.length;
      // Tier facade is the preferred path (post 5-tier refactor). Fallback
      // to the direct helper preserves behavior for callers that have not
      // yet adopted tier-aware plumbing. Both invocations ultimately run
      // the same `compactFeatureContext` body — the tier wrapper only adds
      // opt-out for Reflex / Plan tiers that should skip the LLM call.
      const compactDeps = { llm: deps.llm, promptPort: deps.promptPort };
      if (input.executionTier) {
        featureContext = await input.executionTier.compact(featureContext, compactDeps);
      } else {
        featureContext = await compactFeatureContext(
          featureContext,
          compactDeps,
          input.compact,
        );
      }
      if (featureContext.wasCompacted) {
        console.log(
          `🗜️  [${logPrefix}] featureContext compacted: ${before} → ${featureContext.userTurns.length} user_turns + summary`,
        );
      }
    } else if (input.skipCompaction) {
      console.log(`⏭️  [${logPrefix}] featureContext compaction skipped (skipCompaction=true)`);
    }
  }

  return { featureContext, turnId };
}
