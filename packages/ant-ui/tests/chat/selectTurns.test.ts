/**
 * `selectTurns` projector — Phase 13 신규 시나리오.
 *
 * Phase 10/11 chat-SSOT 의 핵심 derivation 함수. 두 disjoint 입력
 * (`chatEvents: ChatLine[]` + `streamingBuffers`) 을 ChatHistory /
 * TurnItem 이 직접 소비하는 `Turn[]` 형태로 fold 한다.
 *
 * 본 파일은 master plan 이 §D.4 (Phase 13) 에 적시한 9가지 회귀
 * 가드를 단위 테스트로 잠근다:
 *
 *  1. 다중 turn — turnId 별로 chronology 가 깨지지 않는다.
 *  2. collapsed 라인은 출력에서 제외된다.
 *  3. 같은 cardId 의 chat_status 는 last-write-wins 로 fold 된다.
 *  4. workerScope 별 sub-section 분리 (`_main_` 우선, 그 외 alpha 정렬).
 *  5. streaming buffer overlay (`activeText` / `activeThinking` /
 *     `pendingCards`) 가 finalized 라인 위에 surface 된다.
 *  6. choice_presented 단독 (미해결) — `resolved` 없이 emit.
 *  7. choice_presented + choice_resolved 페어링 — cardId 매칭으로 한
 *     아이템에 합쳐진다.
 *  8. 낙관적 (optimistic) ChoiceResolved — 동일 cardId 의 두 번째
 *     resolved 가 dedup 되어 한 번만 emit.
 *  9. 표준 cache identity — 동일 references 입력에 대해 동일
 *     `Turn[]` 참조를 반환한다 (React bail-out).
 *
 * 이는 master plan 의 negative-grep 가드 (Phase 14) 가 잡지 못하는
 * "올바른 fold 시맨틱" 을 verify 한다.
 */

import { describe, it, expect } from 'vitest';
import type {
  ChatLine,
  ChatStatusLine,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
  ChatUserTurnLine,
  ChatThinkingLine,
  ChatAssistantMessageLine,
  PendingCardSnapshot,
} from '@ant/shared';
import {
  selectTurns,
  type StreamingBuffer,
  type BufferKey,
  MAIN_WORKER_SCOPE,
  makeBufferKey,
} from '../../src/domain/store/selectors/chat';

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

let _seq = 0;
function nextTs(): string {
  _seq += 1;
  // Monotonic ISO strings so last-write-wins ordering is stable.
  return new Date(2026, 0, 1, 0, 0, _seq).toISOString();
}

function userTurn(turnId: string, text = 'do it', jobId = 'j1'): ChatUserTurnLine {
  return {
    type: 'user_turn',
    ts: nextTs(),
    jobId,
    turnId,
    jobType: 'code',
    text,
    sourceRef: `feature.jsonl#${turnId}`,
  };
}

function status(
  turnId: string,
  cardId: string,
  statusType: ChatStatusLine['statusType'],
  metadata: Record<string, unknown> = {},
  workerScope?: string,
): ChatStatusLine {
  return {
    type: 'chat_status',
    ts: nextTs(),
    jobId: 'j1',
    turnId,
    jobType: 'code',
    cardId,
    statusType,
    metadata,
    ...(workerScope ? { workerScope } : {}),
  } as ChatStatusLine;
}

function thinking(turnId: string, text = 'pondering'): ChatThinkingLine {
  return {
    type: 'assistant_thinking',
    ts: nextTs(),
    jobId: 'j1',
    turnId,
    jobType: 'code',
    text,
  };
}

function assistantMessage(turnId: string, text = 'done'): ChatAssistantMessageLine {
  return {
    type: 'assistant_message',
    ts: nextTs(),
    jobId: 'j1',
    turnId,
    jobType: 'code',
    text,
  };
}

function choicePresented(
  turnId: string,
  cardId: string,
  cardType = 'triage_choice',
): ChatChoicePresentedLine {
  return {
    type: 'choice_presented',
    ts: nextTs(),
    jobId: 'j1',
    turnId,
    jobType: 'code',
    cardId,
    cardType,
  } as ChatChoicePresentedLine;
}

function choiceResolved(
  turnId: string,
  cardId: string,
  choiceSelected = 'proceed',
  resolvedLabel = 'Proceeded',
): ChatChoiceResolvedLine {
  return {
    type: 'choice_resolved',
    ts: nextTs(),
    jobId: 'j1',
    turnId,
    jobType: 'code',
    cardId,
    choiceSelected,
    resolvedLabel,
  };
}

function emptyBuffers(): Record<BufferKey, StreamingBuffer> {
  return {};
}

// ─────────────────────────────────────────────────────────────────────
// 1. Multi-turn — chronology + grouping
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — multi-turn projection', () => {
  it('groups events by turnId in original order, with user_turn surfaced as Turn.user', () => {
    const events: ChatLine[] = [
      userTurn('t-1', 'first'),
      assistantMessage('t-1', 'first reply'),
      userTurn('t-2', 'second'),
      assistantMessage('t-2', 'second reply'),
    ];

    const turns = selectTurns({ chatEvents: events, streamingBuffers: emptyBuffers() });

    expect(turns).toHaveLength(2);
    expect(turns[0].turnId).toBe('t-1');
    expect(turns[0].user?.text).toBe('first');
    expect(turns[0].sections[0].items).toEqual([
      expect.objectContaining({ kind: 'assistant_message' }),
    ]);
    expect(turns[1].turnId).toBe('t-2');
    expect(turns[1].user?.text).toBe('second');
  });

  it('preserves insertion order even when events arrive interleaved across turns', () => {
    const events: ChatLine[] = [
      userTurn('t-1'),
      userTurn('t-2'),
      assistantMessage('t-1', 'reply for t-1'),
      assistantMessage('t-2', 'reply for t-2'),
    ];

    const turns = selectTurns({ chatEvents: events, streamingBuffers: emptyBuffers() });

    expect(turns.map((t) => t.turnId)).toEqual(['t-1', 't-2']);
    expect((turns[0].sections[0].items[0] as any).line.text).toBe('reply for t-1');
    expect((turns[1].sections[0].items[0] as any).line.text).toBe('reply for t-2');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Collapsed-line filter
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — collapsed lines', () => {
  it('drops collapsed lines from the projection', () => {
    const u = userTurn('t-1');
    const collapsedStatus: ChatStatusLine = {
      ...status('t-1', 'card-collapsed', 'read', { filePath: 'a.ts' }),
      collapsed: true,
    } as ChatStatusLine;
    const liveStatus = status('t-1', 'card-live', 'read', { filePath: 'b.ts' });

    const turns = selectTurns({
      chatEvents: [u, collapsedStatus, liveStatus],
      streamingBuffers: emptyBuffers(),
    });

    expect(turns).toHaveLength(1);
    const items = turns[0].sections[0].items;
    expect(items).toHaveLength(1);
    expect((items[0] as any).line.cardId).toBe('card-live');
  });

  it('returns the empty turns array when every event is collapsed', () => {
    const collapsedAll: ChatLine[] = [
      { ...userTurn('t-1'), collapsed: true } as ChatUserTurnLine,
      { ...status('t-1', 'c', 'read'), collapsed: true } as ChatStatusLine,
    ];

    const turns = selectTurns({ chatEvents: collapsedAll, streamingBuffers: emptyBuffers() });
    expect(turns).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. cardId last-write-wins fold
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — chat_status fold by cardId', () => {
  it('collapses progressive states (running → streaming → final) into one item', () => {
    const u = userTurn('t-1');
    const running = status('t-1', 'card-cmd', 'command', { command: 'ls', state: 'running' });
    const streaming = status('t-1', 'card-cmd', 'command', { command: 'ls', state: 'streaming' });
    const final = status('t-1', 'card-cmd', 'command', { command: 'ls', exitCode: 0, state: 'final' });

    const turns = selectTurns({
      chatEvents: [u, running, streaming, final],
      streamingBuffers: emptyBuffers(),
    });

    const items = turns[0].sections[0].items;
    expect(items).toHaveLength(1);
    const folded = (items[0] as any).line as ChatStatusLine;
    expect(folded.cardId).toBe('card-cmd');
    expect((folded.metadata as any).state).toBe('final');
    expect((folded.metadata as any).exitCode).toBe(0);
  });

  it('does not fold cards with different cardIds even when statusType matches', () => {
    const u = userTurn('t-1');
    const a = status('t-1', 'card-a', 'read', { filePath: 'a.ts' });
    const b = status('t-1', 'card-b', 'read', { filePath: 'b.ts' });

    const turns = selectTurns({
      chatEvents: [u, a, b],
      streamingBuffers: emptyBuffers(),
    });

    const items = turns[0].sections[0].items;
    expect(items).toHaveLength(2);
    expect((items[0] as any).line.cardId).toBe('card-a');
    expect((items[1] as any).line.cardId).toBe('card-b');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. workerScope sub-section split
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — workerScope sub-sections', () => {
  it('splits events by workerScope with `_main_` rendering first', () => {
    const u = userTurn('t-par');
    const main = status('t-par', 'card-main', 'read', { filePath: 'a.ts' });
    const w1 = status('t-par', 'card-w1', 'read', { filePath: 'b.ts' }, 'worker-1');
    const w2 = status('t-par', 'card-w2', 'read', { filePath: 'c.ts' }, 'worker-2');

    // Insertion order is intentionally non-canonical to verify sort.
    const turns = selectTurns({
      chatEvents: [u, w2, w1, main],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      MAIN_WORKER_SCOPE,
      'worker-1',
      'worker-2',
    ]);
  });

  it('orders sections chronologically by first-event timestamp (worker IDs not lexicographic)', () => {
    // worker-2 starts BEFORE worker-1; sections must follow chronology
    // (not alphabetical). When `_main_` has its own event the anchor
    // sort still pins it first.
    const u = userTurn('t-chrono');
    const mainMsg = assistantMessage('t-chrono', 'turn-level intro');
    const w2First = status('t-chrono', 'card-w2-a', 'read', { filePath: 'a.ts' }, 'worker-2');
    const w1First = status('t-chrono', 'card-w1-a', 'read', { filePath: 'b.ts' }, 'worker-1');
    const w2Second = status('t-chrono', 'card-w2-b', 'read', { filePath: 'c.ts' }, 'worker-2');

    const turns = selectTurns({
      chatEvents: [u, mainMsg, w2First, w1First, w2Second],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      MAIN_WORKER_SCOPE,
      'worker-2',
      'worker-1',
    ]);
  });

  it('splits a single long-lived worker into per-task sections via `worker-N#task-K` scope', () => {
    // Mirrors the `rigid-fanning-faith` regression: a TaskWorker picks
    // up cohort-1 task A, then cohort-2 task B. Each task must occupy
    // its own section so cohort-2 messages don't fold into cohort-1's
    // pinned screen position.
    const u = userTurn('t-multi');
    const w0Task1 = status('t-multi', 'c1', 'read', { filePath: 'a.ts' }, 'worker-0#task-A');
    const w0Task2 = status('t-multi', 'c2', 'read', { filePath: 'b.ts' }, 'worker-0#task-B');

    const turns = selectTurns({
      chatEvents: [u, w0Task1, w0Task2],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      'worker-0#task-A',
      'worker-0#task-B',
    ]);
  });

  it('renders cohort-2 tasks BELOW cohort-1 tasks even when later-cohort task runs on the same worker', () => {
    // Reproduces the user-reported regression: worker-3 in
    // `rigid-fanning-faith` ran a UI-cohort task and later a
    // visual-cohort task. Without per-task scope, cohort-2 messages
    // appended in the middle of the scroll because worker-3 was
    // pinned. With `worker-N#task-K` + chronological sort, each task
    // gets its own section in start-time order.
    const u = userTurn('t-cohort');
    const w3UiA = status('t-cohort', 'c1', 'read', { filePath: 'ui-a.ts' }, 'worker-3#task-uiA');
    const w4UiB = status('t-cohort', 'c2', 'read', { filePath: 'ui-b.ts' }, 'worker-4#task-uiB');
    // Visual cohort starts after both UI tasks emit at least one event.
    const w3VisualA = status('t-cohort', 'c3', 'read', { filePath: 'vis-a.ts' }, 'worker-3#task-visA');
    const w5VisualB = status('t-cohort', 'c4', 'read', { filePath: 'vis-b.ts' }, 'worker-5#task-visB');

    const turns = selectTurns({
      chatEvents: [u, w3UiA, w4UiB, w3VisualA, w5VisualB],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      'worker-3#task-uiA',
      'worker-4#task-uiB',
      'worker-3#task-visA',
      'worker-5#task-visB',
    ]);
  });

  it('keeps every choice card (including cancelled) in the natural workerScope — no `_terminal_` synthetic section', () => {
    // The previous policy routed cardType:'cancelled' into a synthetic
    // `_terminal_` section pinned to the bottom. That pinned the
    // cancelled card to the most-recent screen position even after
    // resume + new worker output, masking chronology. Cancelled cards
    // now flow into `_main_` (the appender omits workerScope) and
    // chronological section ordering does the right thing.
    const u = userTurn('t-stop');
    const mainMsg = assistantMessage('t-stop', 'decompose response');
    const w1Msg = status('t-stop', 'card-w1', 'read', { filePath: 'b.ts' }, 'worker-1');
    const cancelled = choicePresented('t-stop', 'cancelled-card-1', 'cancelled');

    const turns = selectTurns({
      chatEvents: [u, mainMsg, w1Msg, cancelled],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      MAIN_WORKER_SCOPE,
      'worker-1',
    ]);

    // Cancelled card lives in `_main_` alongside the assistant_message.
    const mainItems = sections[0].items;
    expect(mainItems.map((i: any) => i.kind)).toEqual(['assistant_message', 'choice']);
    const cancelledItem = mainItems[1] as any;
    expect(cancelledItem.presented.cardType).toBe('cancelled');
    expect(cancelledItem.presented.cardId).toBe('cancelled-card-1');
  });

  it('keeps non-cancelled choice cards (e.g. triage_choice) in `_main_`', () => {
    const u = userTurn('t-triage');
    const triage = choicePresented('t-triage', 'triage-1', 'triage_choice');

    const turns = selectTurns({
      chatEvents: [u, triage],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([MAIN_WORKER_SCOPE]);
    const items = sections[0].items;
    expect(items[0].kind).toBe('choice');
    if (items[0].kind === 'choice') {
      expect(items[0].presented.cardType).toBe('triage_choice');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Streaming buffer overlay
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — streaming overlay', () => {
  it('surfaces activeText / activeThinking / pendingCards on the matching section', () => {
    const u = userTurn('t-stream');
    const events = [u, thinking('t-stream', 'finalized thought')];

    const pending: PendingCardSnapshot = {
      cardId: 'spinner-1',
      statusType: 'reading',
      metadata: { filePath: 'src/foo.ts' },
    };

    const buffers: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-stream', MAIN_WORKER_SCOPE)]: {
        turnId: 't-stream',
        workerScope: MAIN_WORKER_SCOPE,
        text: 'partial reply...',
        thinking: 'still thinking...',
        pendingCards: { 'spinner-1': pending },
      },
    };

    const turns = selectTurns({ chatEvents: events, streamingBuffers: buffers });

    const main = turns[0].sections[0];
    expect(main.activeText).toBe('partial reply...');
    expect(main.activeThinking).toBe('still thinking...');
    expect(main.pendingCards?.['spinner-1']).toEqual(pending);
  });

  it('synthesises a section for a buffer that has no events yet (orphan worker scope)', () => {
    const u = userTurn('t-stream');

    const buffers: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-stream', 'worker-late')]: {
        turnId: 't-stream',
        workerScope: 'worker-late',
        text: 'late chunk',
      },
    };

    const turns = selectTurns({ chatEvents: [u], streamingBuffers: buffers });

    const scopes = turns[0].sections.map((s) => s.workerScope).sort();
    expect(scopes).toContain('worker-late');
    const orphan = turns[0].sections.find((s) => s.workerScope === 'worker-late');
    expect(orphan?.activeText).toBe('late chunk');
    expect(orphan?.items).toEqual([]);
  });

  it('emits an orphan Turn when streaming chunks arrive before any event for that turnId', () => {
    const buffers: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-orphan', MAIN_WORKER_SCOPE)]: {
        turnId: 't-orphan',
        workerScope: MAIN_WORKER_SCOPE,
        thinking: 'pre-flight thought',
      },
    };

    const turns = selectTurns({ chatEvents: [], streamingBuffers: buffers });

    expect(turns).toHaveLength(1);
    expect(turns[0].turnId).toBe('t-orphan');
    expect(turns[0].sections[0].activeThinking).toBe('pre-flight thought');
  });

  it('overlays buffer pendingCards even when a chat_status with the same cardId already exists', () => {
    const u = userTurn('t-overlay');
    const finalized = status('t-overlay', 'card-cmd', 'tool_action', { tool: 'run' });

    const pending: PendingCardSnapshot = {
      cardId: 'card-cmd',
      statusType: 'tool_action',
      metadata: { tool: 'run' },
      streamedOutput: 'partial output',
    };

    const buffers: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-overlay', MAIN_WORKER_SCOPE)]: {
        turnId: 't-overlay',
        workerScope: MAIN_WORKER_SCOPE,
        pendingCards: { 'card-cmd': pending },
      },
    };

    const turns = selectTurns({ chatEvents: [u, finalized], streamingBuffers: buffers });

    const item = turns[0].sections[0].items.find(
      (i: any) => i.kind === 'status' && i.line.cardId === 'card-cmd',
    );
    expect(item).toBeDefined();
    expect((item as any).pending).toEqual(pending);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6 & 7. Choice card pairing
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — choice card pairing', () => {
  it('emits an unresolved choice item when only choice_presented exists', () => {
    const u = userTurn('t-c');
    const presented = choicePresented('t-c', 'card-c', 'clarifying');

    const turns = selectTurns({ chatEvents: [u, presented], streamingBuffers: emptyBuffers() });

    const choices = turns[0].sections[0].items.filter((i: any) => i.kind === 'choice');
    expect(choices).toHaveLength(1);
    expect((choices[0] as any).presented.cardId).toBe('card-c');
    expect((choices[0] as any).resolved).toBeUndefined();
  });

  it('pairs choice_presented + choice_resolved by cardId into a single item', () => {
    const u = userTurn('t-c');
    const presented = choicePresented('t-c', 'card-c', 'triage_choice');
    const resolved = choiceResolved('t-c', 'card-c', 'proceed', 'Proceeded');

    const turns = selectTurns({
      chatEvents: [u, presented, resolved],
      streamingBuffers: emptyBuffers(),
    });

    const choices = turns[0].sections[0].items.filter((i: any) => i.kind === 'choice');
    expect(choices).toHaveLength(1);
    expect((choices[0] as any).presented.cardId).toBe('card-c');
    expect((choices[0] as any).resolved?.choiceSelected).toBe('proceed');
    expect((choices[0] as any).resolved?.resolvedLabel).toBe('Proceeded');
  });

  it('renders a synthetic choice item for a standalone resolved with no matching presented in scope', () => {
    const u = userTurn('t-c');
    // Only the resolved line is in scope (e.g. presented was emitted in a
    // prior turn that has been collapsed away).
    const resolved = choiceResolved('t-c', 'card-orphan', 'dismissed', 'Dismissed');

    const turns = selectTurns({
      chatEvents: [u, resolved],
      streamingBuffers: emptyBuffers(),
    });

    const choices = turns[0].sections[0].items.filter((i: any) => i.kind === 'choice');
    expect(choices).toHaveLength(1);
    expect((choices[0] as any).presented.cardType).toBe('unknown');
    expect((choices[0] as any).resolved.choiceSelected).toBe('dismissed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Optimistic ChoiceResolved dedup (multiple resolved → single item)
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — optimistic resolved dedup', () => {
  it('dedups duplicate choice_resolved lines on the same cardId and folds last-write-wins onto resolved metadata', () => {
    const u = userTurn('t-dup');
    const presented = choicePresented('t-dup', 'card-dup');
    const resolvedFirst = choiceResolved('t-dup', 'card-dup', 'proceed', 'Proceeded');
    const resolvedSecond = choiceResolved('t-dup', 'card-dup', 'proceed', 'Proceeded again');

    const turns = selectTurns({
      chatEvents: [u, presented, resolvedFirst, resolvedSecond],
      streamingBuffers: emptyBuffers(),
    });

    const items = turns[0].sections[0].items;
    const choices = items.filter((i: any) => i.kind === 'choice');
    // 1. Duplicate resolveds cannot fan out into multiple items.
    expect(choices).toHaveLength(1);
    // 2. The folded resolved metadata reflects the LATEST line (LWW).
    //    This guards the optimistic-then-server-broadcast race where the
    //    FE writes a local choice_resolved first and the BE SSE later
    //    rebroadcasts the same cardId with a (possibly updated) label.
    expect((choices[0] as any).resolved?.resolvedLabel).toBe('Proceeded again');
  });

  it('dedups when the second line carries a different choiceSelected (LWW wins on choice too)', () => {
    const u = userTurn('t-dup2');
    const presented = choicePresented('t-dup2', 'card-d2', 'clarifying');
    const optimistic = choiceResolved('t-dup2', 'card-d2', 'answered', 'Pending…');
    const authoritative = choiceResolved('t-dup2', 'card-d2', 'answered', 'Answered');

    const turns = selectTurns({
      chatEvents: [u, presented, optimistic, authoritative],
      streamingBuffers: emptyBuffers(),
    });

    const choices = turns[0].sections[0].items.filter((i: any) => i.kind === 'choice');
    expect(choices).toHaveLength(1);
    expect((choices[0] as any).resolved?.resolvedLabel).toBe('Answered');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. Cache identity (referential stability)
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — cache identity', () => {
  it('returns the same Turn[] reference when chatEvents and streamingBuffers references are unchanged', () => {
    const events: ChatLine[] = [userTurn('t-1'), assistantMessage('t-1')];
    const buffers = emptyBuffers();

    const a = selectTurns({ chatEvents: events, streamingBuffers: buffers });
    const b = selectTurns({ chatEvents: events, streamingBuffers: buffers });

    expect(a).toBe(b);
  });

  it('returns a fresh Turn[] when the chatEvents reference changes (new array, same content)', () => {
    const evA: ChatLine[] = [userTurn('t-1'), assistantMessage('t-1')];
    const evB: ChatLine[] = [...evA];

    const a = selectTurns({ chatEvents: evA, streamingBuffers: emptyBuffers() });
    const b = selectTurns({ chatEvents: evB, streamingBuffers: emptyBuffers() });

    expect(a).not.toBe(b);
  });
});
