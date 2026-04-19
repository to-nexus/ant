/**
 * Feature Context Builder (Phase C — session redesign)
 *
 * Shared helper consumed by code/design resolve nodes to turn the output of
 * `SessionPort.loadSinceBoundary()` into a `featureContext` state field that
 * plan/direct prompts can inject as prior-context reminders.
 *
 * Responsibilities:
 *  - Merge `user_turn_meta` patch lines into their owning `user_turn` by
 *    `turnId` (complexity / decidedBy / reason → the same line).
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

/** Default breadcrumb window surfaced to plan/direct prompts. */
export const DEFAULT_BREADCRUMB_WINDOW = 5;

/**
 * Shape consumed by plan/direct prompt renderers (Handlebars). Keep the
 * user_turn as the base line and surface meta fields (`complexity` etc.)
 * as optional patches so templates can reference either side uniformly.
 *
 * We deliberately intersect with `Omit<FeatureUserTurnMetaLine, 'type'>`'s
 * patch fields — intersecting with the full meta line would collapse the
 * `type` discriminant to `never` ('user_turn' & 'user_turn_meta').
 */
export type MergedUserTurn = FeatureUserTurnLine & {
  complexity?: FeatureUserTurnMetaLine['complexity'];
  decidedBy?: FeatureUserTurnMetaLine['decidedBy'];
  reason?: FeatureUserTurnMetaLine['reason'];
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
 * Merge user_turn + user_turn_meta by `turnId` and trim the breadcrumb list.
 * Pure function — pulled out for unit testing and so the adapter read can
 * be stubbed in tests.
 */
export function mergeFeatureContext(
  input: {
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
    breadcrumbs: FeatureBreadcrumbLine[];
  },
  options?: { breadcrumbWindow?: number },
): FeatureContext {
  const metaByTurn = new Map<
    string,
    Pick<FeatureUserTurnMetaLine, 'complexity' | 'decidedBy' | 'reason'>
  >();
  for (const meta of input.userTurnMetas) {
    // Defensive: ignore collapsed meta patches — adapter already filters but
    // legacy entries may slip through.
    if ((meta as { collapsed?: true }).collapsed) continue;
    metaByTurn.set(meta.turnId, {
      complexity: meta.complexity,
      decidedBy: meta.decidedBy,
      reason: meta.reason,
    });
  }

  const merged = input.userTurns
    .filter((turn) => !(turn as { collapsed?: true }).collapsed)
    .map((turn) => {
      const meta = metaByTurn.get(turn.turnId);
      return meta ? { ...turn, ...meta } : turn;
    });

  const window = options?.breadcrumbWindow ?? DEFAULT_BREADCRUMB_WINDOW;
  const breadcrumbs = input.breadcrumbs
    .filter((bc) => !(bc as { collapsed?: true }).collapsed)
    .slice(-Math.max(0, window));

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
// Collapse (boundary-triggered) is handled at write time by
// FileSessionAdapter.appendBoundary. Compact is the orthogonal safety net:
// when T2 user_turns grow past FEATURE_CONTEXT_THRESHOLD we summarize the
// oldest entries via LLM while keeping FEATURE_CONTEXT_WINDOW most-recent
// turns intact. Breadcrumbs are never compacted (bounded by design).
// ─────────────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 2.8;

function estimateTurnsTokens(turns: MergedUserTurn[]): number {
  return turns.reduce(
    (sum, turn) => sum + Math.ceil((turn.user || '').length / CHARS_PER_TOKEN),
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
 * Run LLM-based Compact on a `FeatureContext` when its user_turn payload
 * exceeds the budget. Returns a new `FeatureContext` with:
 *  - `userTurns` trimmed to the last `windowSize` entries,
 *  - `summary` populated with the LLM-generated digest of the older entries,
 *  - `wasCompacted = true`.
 *
 * No-ops (returning the input unchanged) when:
 *  - token estimate is within threshold,
 *  - or fewer than `windowSize + 1` user_turns exist (nothing to compact),
 *  - or the LLM call throws (graceful degradation — original ctx preserved,
 *    caller keeps full user_turns for the prompt).
 */
export async function compactFeatureContext(
  ctx: FeatureContext,
  deps: CompactFeatureContextDeps,
  options?: CompactFeatureContextOptions,
): Promise<FeatureContext> {
  const threshold = options?.threshold ?? FEATURE_CONTEXT_THRESHOLD;
  const windowSize = options?.windowSize ?? FEATURE_CONTEXT_WINDOW;

  if (ctx.userTurns.length <= windowSize) return ctx;

  const totalTokens = estimateTurnsTokens(ctx.userTurns);
  if (totalTokens <= threshold) return ctx;

  const entries: CompactableEntry[] = ctx.userTurns.map((turn) => ({
    role: 'user',
    content: turn.user || '',
    timestamp: turn.ts,
  }));

  try {
    const result = await compactJob(entries, deps.llm, deps.promptPort, {
      threshold,
      recentWindowSize: windowSize,
      maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
    });
    if (!result.wasCompacted || !result.summary) return ctx;

    const keptUserTurns = ctx.userTurns.slice(-windowSize);
    return {
      ...ctx,
      userTurns: keptUserTurns,
      summary: result.summary,
      wasCompacted: true,
    };
  } catch (err) {
    console.warn('⚠️  [FeatureContext] Compact failed, keeping full context:', err);
    return ctx;
  }
}
