/**
 * workerGroupPolicy — pure derivation helpers for parallel-worker chat groups
 * (plan curious-spinning-twilight, Part C).
 *
 * All functions here are pure and operate on the projector's `TurnSection`.
 * Deliberately NOT part of the projector: group status / labels / collapse
 * defaults are render-time concerns shared by `WorkerGroupSection` and the
 * `WorkerGroupDock`, and keeping them out of `selectTurns` keeps the per-turn
 * incremental cache untouched (collapse state must never flow through
 * projector inputs — see ChatHistory's autoscroll/signature invariants).
 */

import { generateChatStatusContent } from '@ant/shared';
import { MAIN_WORKER_SCOPE, type TurnSection } from '@/domain/store/selectors/chat';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scope parsing — `worker-N` | `worker-N#task-K` | `worker-N#task-K#pM`
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ParsedWorkerScope {
  workerLabel: string;
  workerId?: number;
  taskKey?: string;
  /** Retry-cycle sequence (`#p2` → 2). Cycles are DISTINCT groups
   *  (even-getting-knave) — this is label decoration only. */
  cycleSeq?: number;
}

/** True for scopes that render as a worker group container. `_main_` and
 *  `_cancelled_:{cardId}` synthetic scopes are never wrapped. */
export function isWorkerGroupScope(scope: string): boolean {
  return scope !== MAIN_WORKER_SCOPE && !scope.startsWith('_cancelled_:') && scope.startsWith('worker-');
}

export function parseWorkerScope(scope: string): ParsedWorkerScope | null {
  if (!isWorkerGroupScope(scope)) return null;
  const parts = scope.split('#');
  const workerLabel = parts[0];
  const idMatch = /^worker-(\d+)$/.exec(workerLabel);
  let taskKey: string | undefined;
  let cycleSeq: number | undefined;
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const cycleMatch = /^p(\d+)$/.exec(last);
    if (parts.length >= 3 && cycleMatch) {
      cycleSeq = Number(cycleMatch[1]);
      taskKey = parts.slice(1, -1).join('#');
    } else {
      taskKey = parts.slice(1).join('#');
    }
  }
  return {
    workerLabel,
    ...(idMatch ? { workerId: Number(idMatch[1]) } : {}),
    ...(taskKey ? { taskKey } : {}),
    ...(cycleSeq !== undefined ? { cycleSeq } : {}),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Group status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type WorkerGroupStatus = 'active' | 'completed' | 'failed';

function statusLineFailed(statusType: string, metadata?: Record<string, unknown>): boolean {
  if (statusType.endsWith('_failed')) return true;
  if (!metadata) return false;
  if (metadata.error) return true;
  if (metadata.success === false) return true;
  return false;
}

export function sectionHasStreamingOverlay(section: TurnSection): boolean {
  return !!(
    section.activeText ||
    section.activeThinking ||
    (section.pendingCards && Object.keys(section.pendingCards).length > 0)
  );
}

/**
 * Group tri-state:
 *  - `failed` — any folded status line landed as a failure.
 *  - `completed` — the terminal `task_response` card landed and nothing is
 *    streaming.
 *  - `active` — everything else. A quiet section (empty buffer between LLM
 *    calls, no terminal card yet) stays `active` — keying "completed" off
 *    buffer emptiness would flicker (see SectionStack's isStreaming).
 */
export function sectionStatus(section: TurnSection): WorkerGroupStatus {
  let hasTerminalResponse = false;
  for (const item of section.items) {
    if (item.kind !== 'status') continue;
    const md = item.line.metadata as Record<string, unknown> | undefined;
    if (statusLineFailed(item.line.statusType, md)) return 'failed';
    if (item.line.statusType === 'task_response') hasTerminalResponse = true;
  }
  if (hasTerminalResponse && !sectionHasStreamingOverlay(section)) return 'completed';
  return 'active';
}

/** Unresolved choice cards force the group open — a collapsed group must
 *  never hide a required user action. */
export function sectionHasUnresolvedChoice(section: TurnSection): boolean {
  return section.items.some((it) => it.kind === 'choice' && it.presented && !it.resolved);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Labels / ticker / summary
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Human task label: BE-stamped `line.taskName` (Phase 2) → metadata scrape
 *  (today's buildSectionHeader behavior) → raw taskKey. */
export function sectionTaskName(section: TurnSection): string | undefined {
  for (const item of section.items) {
    if (item.kind !== 'status') continue;
    const stamped = (item.line as { taskName?: unknown }).taskName;
    if (typeof stamped === 'string' && stamped) return stamped;
  }
  for (const item of section.items) {
    if (item.kind !== 'status') continue;
    const md = (item.line.metadata ?? {}) as Record<string, unknown>;
    if (typeof md.taskName === 'string' && md.taskName) return md.taskName;
  }
  return parseWorkerScope(section.workerScope)?.taskKey;
}

/**
 * One-line live ticker for a collapsed active group — the most recent
 * observable activity: streaming text tail → pending card title → last
 * folded status line's content.
 */
export function sectionTicker(section: TurnSection): string | undefined {
  if (section.activeText) return tail(section.activeText);
  if (section.activeThinking) return tail(section.activeThinking);
  const pending = section.pendingCards ? Object.values(section.pendingCards) : [];
  if (pending.length > 0) {
    const last = pending[pending.length - 1];
    const label = generateChatStatusContent(
      last.statusType as Parameters<typeof generateChatStatusContent>[0],
      last.metadata as Record<string, unknown> | undefined,
    );
    if (label) return label;
  }
  for (let i = section.items.length - 1; i >= 0; i--) {
    const item = section.items[i];
    if (item.kind !== 'status') continue;
    const label = generateChatStatusContent(
      item.line.statusType,
      item.line.metadata as Record<string, unknown> | undefined,
    );
    if (label) return firstLine(label);
  }
  return undefined;
}

function tail(text: string, cap = 80): string {
  const t = text.trim().split('\n').filter(Boolean).pop() ?? '';
  return t.length <= cap ? t : `…${t.slice(-cap)}`;
}

function firstLine(text: string, cap = 80): string {
  const t = text.trim().split('\n')[0] ?? '';
  return t.length <= cap ? t : `${t.slice(0, cap)}…`;
}

/** Post-fold item count for the collapsed summary line. */
export function sectionStepCount(section: TurnSection): number {
  return section.items.length;
}

/** Wall-clock span of the section's durable items, in ms (0 when <2 items). */
export function sectionDurationMs(section: TurnSection): number {
  let first: string | undefined;
  let last: string | undefined;
  for (const item of section.items) {
    const ts =
      item.kind === 'choice' ? item.presented.ts : item.kind === 'status' ? item.line.ts : item.line.ts;
    if (!first) first = ts;
    last = ts;
  }
  if (!first || !last) return 0;
  const span = Date.parse(last) - Date.parse(first);
  return Number.isFinite(span) && span > 0 ? span : 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Collapse policy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type GroupOverride = 'expanded' | 'collapsed';

export function groupOverrideKey(turnId: string, workerScope: string): string {
  return `${turnId}:${workerScope}`;
}

/**
 * Resolved collapsed state, in priority order:
 *  1. unresolved choice → forced expanded (override ignored);
 *  2. user override;
 *  3. defaults — genuinely parallel turn (≥2 worker sections) → collapsed
 *     (active groups tick, settled groups summarize); failed → expanded;
 *     single worker section → expanded (no behavior change vs today).
 */
export function resolveGroupCollapsed(
  section: TurnSection,
  workerSectionCount: number,
  override: GroupOverride | undefined,
): boolean {
  if (sectionHasUnresolvedChoice(section)) return false;
  if (override) return override === 'collapsed';
  if (sectionStatus(section) === 'failed') return false;
  return workerSectionCount >= 2;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Worker hue identity — aurora set cycled by workerId (badge + dock chips)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WORKER_HUES = [290, 350, 195, 50] as const; // violet / pink / teal / orange

export function workerHue(workerId: number | undefined): number {
  if (workerId === undefined || !Number.isFinite(workerId)) return WORKER_HUES[0];
  return WORKER_HUES[Math.abs(workerId) % WORKER_HUES.length];
}

/** Theme-safe tint recipe (WorkingCard precedent). */
export function workerTintBg(hue: number): string {
  return `oklch(from var(--bg-surface-2) calc(l - 0.01) max(c, 0.025) ${hue})`;
}
export function workerTintFg(hue: number): string {
  return `oklch(56% 0.20 ${hue})`;
}
