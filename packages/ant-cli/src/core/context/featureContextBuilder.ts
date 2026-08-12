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
import type { TaskTokenUsage } from '../types/task';
import type {
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBreadcrumbLine,
  FeatureAssistantTurnLine,
  FeatureContextSummaryLine,
  LogJobType,
  TurnDigest,
} from '@ant/shared';
import { assistantProseOf, capTail } from './chatTailBuilder';
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

/**
 * P1b (e2-humming-spindle) — derived consumption state for design-family
 * breadcrumbs. NEVER persisted to feature.jsonl; recomputed on every merge.
 *
 * 'pending'  — the design job authored its artifact(s) and no code job has
 *              run since. A follow-up problem report on the same surface is
 *              an extension of this pending artifact (triage routes rev-*),
 *              because nothing was built from it yet.
 * 'consumed' — at least one code job ran after this breadcrumb; problem
 *              reports now describe built behaviour (triage routes gen-*).
 */
export type BreadcrumbConsumption = 'pending' | 'consumed';

export type AnnotatedBreadcrumb = FeatureBreadcrumbLine & {
  consumption?: BreadcrumbConsumption;
};

/**
 * Context Lens P2 — one user↔assistant exchange (band-1 verbatim unit).
 * `assistantFinalText` comes from the turn's `assistant_turn` line (durable
 * SSOT); `buildFeatureContext` backfills recent gaps from chat.jsonl (the
 * documented migration fallback for pre-P2 turns).
 */
export interface LensExchange {
  turnId: string;
  ts: string;
  jobType?: string;
  userText: string;
  actionMetadata?: FeatureUserTurnMetaLine['actionMetadata'];
  assistantFinalText?: string;
  /** This turn's breadcrumb anchors (band-1 carries its own turn's anchors). */
  anchors?: FeatureBreadcrumbLine['anchors'];
  /** ask/inline-ask — first to demote, never enters band 2. */
  ephemeral?: boolean;
}

/** Context Lens P2 — band-2 structured unit (write-once turn digest). */
export interface LensDigestEntry {
  turnId: string;
  ts: string;
  jobType?: string;
  digest: TurnDigest;
}

export interface FeatureContext {
  breadcrumbs: AnnotatedBreadcrumb[];
  userTurns: MergedUserTurn[];
  /**
   * Context Lens band 1 source — ALL merged exchanges in chronological
   * order, uncapped. Consumers MUST render through `projectLens(ctx,
   * profile)` which applies the per-node K/char caps; raw `exchanges` is
   * not a prompt surface.
   */
  exchanges?: LensExchange[];
  /** Context Lens band 2 source — digests of turns that have one. */
  digests?: LensDigestEntry[];
  /**
   * Context Lens band 3 (P3) — standing constraints, verbatim-carried.
   * Deterministic union of every folded digest's `constraints` across
   * checkpoints; NEVER dropped by compaction. Rendered by every profile
   * (injection floor, II-5).
   */
  constraintLedger?: string[];
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
    /** Context Lens P2 — optional for legacy callers/tests. */
    assistantTurns?: FeatureAssistantTurnLine[];
    /** Context Lens P3 — checkpoint lines; the latest one applies. */
    contextSummaries?: FeatureContextSummaryLine[];
  },
  // Kept for backward compatibility with callers that still pass an
  // explicit window override; ignored when undefined or negative.
  options?: { breadcrumbWindow?: number; currentJobId?: string },
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

  // Context Lens P3 — the latest checkpoint folds everything at or before
  // its `coversThroughTs`: those lines are already represented by the
  // checkpoint's summary + constraint ledger, so they leave the prompt
  // surface (disk untouched). This replaces the per-hydrate LLM
  // re-summarization: reading the checkpoint is free.
  const checkpoint = latestCheckpoint(input.contextSummaries);
  const coveredBy = (ts: string): boolean =>
    !!checkpoint && ts <= checkpoint.coversThroughTs;

  const merged = input.userTurns
    .filter((turn) => !(turn as { collapsed?: true }).collapsed)
    .filter((turn) => !coveredBy(turn.ts))
    .map((turn) => {
      const meta = metaByTurn.get(turn.turnId);
      return meta ? { ...turn, ...meta } : turn;
    });

  const liveBreadcrumbs = input.breadcrumbs.filter(
    (bc) => !(bc as { collapsed?: true }).collapsed && !coveredBy(bc.ts),
  );

  // Backward compat: callers (tests / specialised resolves) may still pass
  // `breadcrumbWindow` to enforce a hard slice. When undefined every live
  // BC flows through; compact handles overflow downstream.
  const window = options?.breadcrumbWindow;
  const windowed =
    typeof window === 'number' && window >= 0
      ? window === 0
        ? []
        : liveBreadcrumbs.slice(-window)
      : liveBreadcrumbs;

  const breadcrumbs = annotateBreadcrumbConsumption(
    windowed,
    merged,
    options?.currentJobId,
  );

  const { exchanges, digests } = buildLensBands(merged, input.assistantTurns ?? [], breadcrumbs);

  return {
    breadcrumbs,
    userTurns: merged,
    exchanges,
    digests,
    ...(checkpoint
      ? {
          summary: checkpoint.summary,
          constraintLedger: checkpoint.constraintLedger,
        }
      : {}),
  };
}

function latestCheckpoint(
  summaries: FeatureContextSummaryLine[] | undefined,
): FeatureContextSummaryLine | undefined {
  if (!summaries?.length) return undefined;
  const live = summaries.filter((s) => !(s as { collapsed?: true }).collapsed);
  return live.length ? live[live.length - 1] : undefined;
}

/**
 * Context Lens P2 — pair user turns with their assistant_turn lines (by
 * turnId) and collect the per-turn breadcrumb anchors. Pure and uncapped;
 * `projectLens` applies profile caps at render time.
 */
function buildLensBands(
  userTurns: MergedUserTurn[],
  assistantTurns: FeatureAssistantTurnLine[],
  breadcrumbs: AnnotatedBreadcrumb[],
): { exchanges: LensExchange[]; digests: LensDigestEntry[] } {
  const assistantByTurn = new Map<string, FeatureAssistantTurnLine>();
  for (const at of assistantTurns) {
    if (!(at as { collapsed?: true }).collapsed) assistantByTurn.set(at.turnId, at);
  }
  const anchorsByTurn = new Map<string, FeatureBreadcrumbLine['anchors']>();
  for (const bc of breadcrumbs) anchorsByTurn.set(bc.turnId, bc.anchors);

  const exchanges: LensExchange[] = [];
  const digests: LensDigestEntry[] = [];
  for (const turn of userTurns) {
    const at = assistantByTurn.get(turn.turnId);
    const ephemeral = (turn as { ephemeral?: true }).ephemeral === true || at?.ephemeral === true;
    exchanges.push({
      turnId: turn.turnId,
      ts: turn.ts,
      jobType: turn.jobType,
      userText: turn.text || '',
      actionMetadata: turn.actionMetadata,
      assistantFinalText: at?.finalText || undefined,
      anchors: anchorsByTurn.get(turn.turnId),
      ...(ephemeral ? { ephemeral: true } : {}),
    });
    // Ephemeral turns never enter band 2 — they demote straight out.
    if (at?.digest && !ephemeral) {
      digests.push({ turnId: turn.turnId, ts: turn.ts, jobType: turn.jobType, digest: at.digest });
    }
  }
  return { exchanges, digests };
}

/**
 * P1b — annotate design-job breadcrumbs with their consumption state.
 *
 * A design breadcrumb is 'consumed' when any code-job user_turn was recorded
 * after it, else 'pending'. The current job's own turn is excluded from the
 * scan: at triage time the classified turn is already on disk with its
 * routed jobType, and counting it would let the turn being classified flip
 * the very state that classifies it. Deterministic — no LLM.
 */
function annotateBreadcrumbConsumption(
  breadcrumbs: FeatureBreadcrumbLine[],
  userTurns: MergedUserTurn[],
  currentJobId?: string,
): AnnotatedBreadcrumb[] {
  const priorCodeTurnTs = userTurns
    .filter((t) => t.jobType === 'code' && (!currentJobId || t.jobId !== currentJobId))
    .map((t) => t.ts);

  return breadcrumbs.map((bc) => {
    if (bc.jobType !== 'design') return bc;
    const consumed = priorCodeTurnTs.some((ts) => ts > bc.ts);
    return { ...bc, consumption: consumed ? 'consumed' : 'pending' };
  });
}

/**
 * Load feature.jsonl since the latest boundary and merge into a
 * `FeatureContext` ready for prompt injection. Returns `undefined` when the
 * session port is not wired (e.g. tests bypassing adapters) so callers can
 * keep the state field optional.
 */
export async function buildFeatureContext(
  session: SessionPort | undefined,
  options?: { breadcrumbWindow?: number; currentJobId?: string },
): Promise<FeatureContext | undefined> {
  if (!session) return undefined;

  let loaded: {
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
    breadcrumbs: FeatureBreadcrumbLine[];
    assistantTurns?: FeatureAssistantTurnLine[];
  };
  try {
    loaded = await session.loadSinceBoundary();
  } catch (err) {
    console.warn('⚠️  [FeatureContext] loadSinceBoundary failed:', err);
    return { breadcrumbs: [], userTurns: [] };
  }

  const ctx = mergeFeatureContext(loaded, options);
  await backfillExchangesFromChat(ctx, session);
  return ctx;
}

/** Max trailing exchanges eligible for the chat.jsonl migration backfill. */
const LENS_BACKFILL_WINDOW = 6;

/**
 * Migration fallback (Context Lens P2): turns recorded before assistant_turn
 * lines existed have no `assistantFinalText`. For the trailing band-1 window
 * only, reconstruct it from chat.jsonl via `loadChatByTurnIds`. This is the
 * ONE sanctioned live read of chat.jsonl in the context pipeline (Chat Clear
 * invariant) — it converges to zero as assistant_turn lines accumulate.
 */
async function backfillExchangesFromChat(
  ctx: FeatureContext,
  session: SessionPort,
): Promise<void> {
  const exchanges = ctx.exchanges ?? [];
  const tail = exchanges.slice(-LENS_BACKFILL_WINDOW);
  const missing = tail.filter((e) => !e.assistantFinalText);
  if (missing.length === 0) return;

  try {
    const lines = await session.loadChatByTurnIds(missing.map((e) => e.turnId));
    const proseByTurn = new Map<string, string[]>();
    for (const line of lines) {
      const prose = assistantProseOf(line);
      if (!prose) continue;
      const list = proseByTurn.get(line.turnId) ?? [];
      list.push(prose);
      proseByTurn.set(line.turnId, list);
    }
    for (const exchange of missing) {
      const parts = proseByTurn.get(exchange.turnId);
      if (parts?.length) {
        exchange.assistantFinalText = capTail(parts.join('\n').trim(), 2240);
      }
    }
  } catch (err) {
    console.warn('⚠️  [FeatureContext] chat backfill failed (non-fatal):', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §13 compaction_policy — Compact mechanism
//
// Collapse (Hard Reset only after job-context-bridge T2) is handled at
// write time by FileSessionAdapter.appendBoundary. Compact is the
// orthogonal safety net: when the carry-over reservoir
// (estimateCarryoverTokens — all channels) crosses
// FEATURE_CONTEXT_THRESHOLD, the older entries are folded into a single
// MECE summary while the most recent FEATURE_CONTEXT_WINDOW user_turns
// (and the breadcrumbs/exchanges/digests at or after the window cutoff
// timestamp) stay intact. The threshold is a fold trigger evaluated at the
// next job's hydrate — NOT an injection cap (per-call injection is bounded
// separately by contextProfile caps), so an over-threshold reservoir
// between jobs is a normal state.
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

function digestChars(d: LensDigestEntry): number {
  const parts = [
    d.digest.outcome,
    ...d.digest.decisions,
    ...d.digest.constraints,
    ...(d.digest.openQuestions ?? []),
  ];
  return parts.reduce((sum, p) => sum + (p?.length ?? 0), 0);
}

/**
 * Single measurement of the carry-over reservoir — the ONLY definition of
 * "how many tokens transfer to the next job". Sums every channel (user
 * turns, breadcrumbs, assistant finals, band-2 digests, rolling summary,
 * constraint ledger). Both the compaction trigger and the FE gauge's
 * GET context/estimate consume this; keeping them on one formula is what
 * makes the gauge number and the fold threshold the same quantity.
 */
export function estimateCarryoverTokens(ctx: FeatureContext): number {
  const digestTokens = (ctx.digests ?? []).reduce(
    (sum, d) => sum + Math.ceil(digestChars(d) / CHARS_PER_TOKEN),
    0,
  );
  const assistantTokens = (ctx.exchanges ?? []).reduce(
    (sum, e) => sum + Math.ceil((e.assistantFinalText?.length ?? 0) / CHARS_PER_TOKEN),
    0,
  );
  const ledgerTokens = (ctx.constraintLedger ?? []).reduce(
    (sum, c) => sum + Math.ceil(c.length / CHARS_PER_TOKEN),
    0,
  );
  const summaryTokens = Math.ceil((ctx.summary?.length ?? 0) / CHARS_PER_TOKEN);
  return (
    estimateTurnsTokens(ctx.userTurns) +
    estimateBreadcrumbsTokens(ctx.breadcrumbs) +
    assistantTokens +
    digestTokens +
    summaryTokens +
    ledgerTokens
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
  /**
   * Context Lens P3 — when wired, an overflow compaction persists a
   * `context_summary` checkpoint line so subsequent hydrates read it for
   * free instead of re-running the LLM (per-hydrate re-summarization is
   * retired). Absent (legacy callers/tests): in-memory compaction only.
   */
  session?: SessionPort;
  /** Line identity for the persisted checkpoint. */
  identity?: { jobId?: string; turnId?: string; jobType?: string };
  /**
   * Usage sink for the compaction LLM call. `compactJob` returns `tokenUsage`
   * and this used to be discarded outright, so an overflow compaction was
   * unbilled. Callers that wire it MUST also return the token channels from
   * their node — mutating state without returning them drops the update
   * (the unreturned-channel-drop class).
   */
  onUsage?: (usage: TaskTokenUsage) => void;
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

  if (estimateCarryoverTokens(ctx) <= threshold) return ctx;

  const keptUserTurns = ctx.userTurns.slice(-windowSize);
  const oldUserTurns = ctx.userTurns.slice(0, -windowSize);
  const cutoffTs = keptUserTurns[0]?.ts ?? '';
  // BCs at or after the window-cutoff are "fresh" enough to flow through
  // verbatim — they correspond to the kept user_turns. Earlier BCs go
  // into the summary as MECE Artifacts so their anchor info survives in
  // condensed form rather than being cut by the old fixed window.
  const oldBreadcrumbs = ctx.breadcrumbs.filter((bc) => !cutoffTs || bc.ts < cutoffTs);
  const keptBreadcrumbs = ctx.breadcrumbs.filter((bc) => !cutoffTs || bc.ts >= cutoffTs);

  // Lens bands follow the same cutoff (P3): folded exchanges leave band 1,
  // folded digests leave band 2 — their constraints move to the ledger.
  const oldExchanges = (ctx.exchanges ?? []).filter((e) => !cutoffTs || e.ts < cutoffTs);
  const keptExchanges = (ctx.exchanges ?? []).filter((e) => cutoffTs && e.ts >= cutoffTs);
  const oldDigests = (ctx.digests ?? []).filter((d) => !cutoffTs || d.ts < cutoffTs);
  const keptDigests = (ctx.digests ?? []).filter((d) => cutoffTs && d.ts >= cutoffTs);

  // Constraint Ledger (P3) — DETERMINISTIC verbatim carry: previous ledger ∪
  // constraints of the digests being folded, deduped. The LLM never rewrites
  // the ledger, so "채팅에서 말한 제약" cannot be silently dropped by a bad
  // summary. Supersession is handled at read time (the current directive
  // wins per the render constraints), not by deletion.
  const constraintLedger = [
    ...new Set([
      ...(ctx.constraintLedger ?? []),
      ...oldDigests.flatMap((d) => d.digest.constraints),
    ]),
  ];

  // Mix old user_turns + old BCs (+ old assistant finals) in chronological
  // order so the LLM sees a single timeline. role='breadcrumb' renders as
  // MECE "Artifact"; the previous rolling summary re-enters as 'system' so
  // the narrative accumulates across checkpoints.
  const entries: CompactableEntry[] = [
    ...(ctx.summary
      ? [{ role: 'system', content: ctx.summary, timestamp: '' }]
      : []),
    ...oldUserTurns.map((turn) => ({
      role: 'user',
      content: turn.text || '',
      timestamp: turn.ts,
    })),
    ...oldExchanges
      .filter((e) => e.assistantFinalText)
      .map((e) => ({
        role: 'assistant',
        content: e.assistantFinalText as string,
        timestamp: e.ts,
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
    if (result.tokenUsage && deps.onUsage) {
      try {
        deps.onUsage(result.tokenUsage);
      } catch (err) {
        console.warn('⚠️  [FeatureContext] compaction onUsage sink threw:', err);
      }
    }
    if (!result.wasCompacted || !result.summary) return ctx;

    // P3 — persist the checkpoint so the NEXT hydrate reads it for free.
    // coversThroughTs = the newest folded conversational line.
    if (deps.session) {
      const coversThroughTs = [
        ...oldUserTurns.map((t) => t.ts),
        ...oldBreadcrumbs.map((b) => b.ts),
      ].sort().pop();
      if (coversThroughTs) {
        try {
          await deps.session.appendContextSummary({
            type: 'context_summary',
            ts: new Date().toISOString(),
            jobId: deps.identity?.jobId ?? 'unknown',
            turnId: deps.identity?.turnId ?? 'unknown',
            jobType: (deps.identity?.jobType ?? 'code') as FeatureContextSummaryLine['jobType'],
            coversThroughTs,
            summary: result.summary,
            constraintLedger,
          });
          console.log(
            `🗜️  [FeatureContext] context_summary checkpoint appended (covers ≤ ${coversThroughTs}, ledger=${constraintLedger.length})`,
          );
          // F3 (P4) — surface the compaction as a chat card so memory
          // changes are visible, not silent. Best-effort: renderer drift
          // must be observable (no silent catch), never fatal.
          try {
            const { getChatAPIClient } = await import('../adapters/ChatAPIClient');
            await getChatAPIClient().showChatStatus('context_compacted', {
              foldedTurns: oldUserTurns.length,
              ledgerCount: constraintLedger.length,
            });
          } catch (err) {
            console.warn('⚠️  [FeatureContext] context_compacted card emit failed:', err);
          }
        } catch (err) {
          console.warn('⚠️  [FeatureContext] checkpoint append failed (in-memory compact still applies):', err);
        }
      }
    }

    return {
      ...ctx,
      userTurns: keptUserTurns,
      breadcrumbs: keptBreadcrumbs,
      exchanges: keptExchanges,
      digests: keptDigests,
      summary: result.summary,
      constraintLedger,
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
  /** Forwarded to the compaction step — see CompactFeatureContextDeps.onUsage. */
  onUsage?: (usage: TaskTokenUsage) => void;
}

export interface HydrateFeatureContextInput {
  /** Job id owning the current turn — used to recover `turnId`. */
  jobId?: string;
  /**
   * jobType owning the current turn. Threaded into the persisted
   * `context_summary` line's identity — without it every checkpoint, in
   * every job type, was stamped with the `'code'` fallback.
   */
  jobType?: LogJobType;
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
    // P1b — excluded from the breadcrumb consumption scan so the turn being
    // classified cannot flip the pending/consumed state it is judged by.
    currentJobId: input.jobId,
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
      //
      // P3 — session + identity let an overflow persist a `context_summary`
      // checkpoint so subsequent hydrates skip the LLM entirely.
      const compactDeps: CompactFeatureContextDeps = {
        llm: deps.llm,
        promptPort: deps.promptPort,
        session: deps.session,
        identity: { jobId: input.jobId, turnId, jobType: input.jobType },
        ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
      };
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
