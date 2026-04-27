/**
 * Streaming-delta RAF batcher (Phase: chat-render-jank-fix Axis 3).
 *
 * SSE token bursts arrive much faster than the 60fps redraw budget — in
 * a long-session viewport every individual `applyStreamingDelta` causes
 * a Zustand commit + selector run + React re-conciliation, which is the
 * dominant frame-time cost once turn count grows. The fix is to coalesce
 * deltas that target the same `(turnId, workerScope, kind, cardId)` tuple
 * within a single animation frame and flush them as one slice update.
 *
 * Contract preserved:
 *
 *   • Stale-snapshot gating (`producedAt < lastChatSnapshotTs`) is applied
 *     at ENQUEUE time, not after flush — same observable behaviour as the
 *     unbatched reducer.
 *   • Finalize / snapshot / clear / hydrate events MUST flush first so the
 *     durable line never appears before its accumulated streaming chunks
 *     (see `chatSseHandler.ts` callsites).
 *   • Tests can switch to a synchronous flush via
 *     `__setStreamingBatchSyncForTests(true)` — slice-level reducer tests
 *     bypass this batcher entirely (they call the slice action directly),
 *     so the default RAF mode does not affect existing tests.
 *
 * Trade-off: a delta enqueued just before a finalize event still races
 * with the finalize flush — but `flushStreamingDeltaBatch` is invoked
 * synchronously from the finalize branch BEFORE the finalize itself
 * mutates state, so the stream is always observably "complete-then-final".
 */

interface PendingDeltaEntry {
  turnId: string;
  workerScope?: string;
  kind: 'text' | 'thinking' | 'card_output';
  cardId?: string;
  chunks: string[];
  producedAt: string;
}

const pendingDeltas = new Map<string, PendingDeltaEntry>();
let scheduledRafId: number | null = null;
let syncMode = false;

function deltaKey(d: {
  turnId: string;
  workerScope?: string;
  kind: string;
  cardId?: string;
}): string {
  return `${d.turnId}\u0000${d.workerScope ?? ''}\u0000${d.kind}\u0000${d.cardId ?? ''}`;
}

function rafSupported(): boolean {
  return (
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function'
  );
}

function cancelScheduled(): void {
  if (scheduledRafId !== null) {
    if (rafSupported()) {
      cancelAnimationFrame(scheduledRafId);
    }
    scheduledRafId = null;
  }
}

/**
 * Flush every coalesced delta into the slice via `applyStreamingDelta`.
 * Safe to call repeatedly — re-entrant calls are no-ops while the queue
 * is empty. Used both by the RAF callback and by finalize events that
 * need to drain pending chunks before a durable mutation lands.
 */
export function flushStreamingDeltaBatch(get: () => any): void {
  cancelScheduled();
  if (pendingDeltas.size === 0) return;
  const entries = Array.from(pendingDeltas.values());
  pendingDeltas.clear();

  const apply = get().applyStreamingDelta;
  if (typeof apply !== 'function') return;

  for (const entry of entries) {
    const merged = entry.chunks.join('');
    if (!merged) continue;
    apply({
      turnId: entry.turnId,
      workerScope: entry.workerScope,
      kind: entry.kind,
      cardId: entry.cardId,
      chunk: merged,
      producedAt: entry.producedAt,
    });
  }
}

/**
 * Coalesce one streaming chunk into the per-frame batch, scheduling a
 * RAF flush on first enqueue. Stale chunks (produced before the latest
 * snapshot) are dropped at enqueue time so the gate behaviour matches
 * `sseSlice.applyStreamingDelta`.
 */
export function enqueueStreamingDelta(
  get: () => any,
  args: {
    turnId: string;
    workerScope?: string;
    kind: 'text' | 'thinking' | 'card_output';
    cardId?: string;
    chunk: string;
    producedAt: string;
  },
): void {
  if (!args.turnId || !args.chunk) return;
  if (args.kind === 'card_output' && !args.cardId) return;

  const last = get().lastChatSnapshotTs as string | undefined;
  if (last && args.producedAt < last) return;

  const k = deltaKey(args);
  const existing = pendingDeltas.get(k);
  if (existing) {
    existing.chunks.push(args.chunk);
    if (args.producedAt > existing.producedAt) {
      existing.producedAt = args.producedAt;
    }
  } else {
    pendingDeltas.set(k, {
      turnId: args.turnId,
      workerScope: args.workerScope,
      kind: args.kind,
      cardId: args.cardId,
      chunks: [args.chunk],
      producedAt: args.producedAt,
    });
  }

  if (syncMode || !rafSupported()) {
    flushStreamingDeltaBatch(get);
    return;
  }
  if (scheduledRafId === null) {
    scheduledRafId = requestAnimationFrame(() => {
      scheduledRafId = null;
      flushStreamingDeltaBatch(get);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Test hooks — keep slice-level reducer tests deterministic.
// ─────────────────────────────────────────────────────────────────────

export function __setStreamingBatchSyncForTests(sync: boolean): void {
  syncMode = sync;
  if (sync) cancelScheduled();
}

export function __resetStreamingBatchForTests(): void {
  pendingDeltas.clear();
  cancelScheduled();
  syncMode = false;
}

export function __pendingStreamingDeltaCountForTests(): number {
  return pendingDeltas.size;
}
