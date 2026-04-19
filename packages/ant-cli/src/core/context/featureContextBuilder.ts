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
import type {
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBreadcrumbLine,
} from '@ant/shared';

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
