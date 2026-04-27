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

import { describe, it, expect, beforeEach } from 'vitest';
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
  __resetTurnsCacheForTests,
  type StreamingBuffer,
  type BufferKey,
  MAIN_WORKER_SCOPE,
  makeBufferKey,
} from '../../src/domain/store/selectors/chat';

// The selector keeps a module-level cache so previous tests would
// otherwise pollute incremental-cache assertions in later tests.
beforeEach(() => {
  __resetTurnsCacheForTests();
});

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
  workerScope?: string,
): ChatChoicePresentedLine {
  return {
    type: 'choice_presented',
    ts: nextTs(),
    jobId: 'j1',
    turnId,
    jobType: 'code',
    cardId,
    cardType,
    ...(workerScope ? { workerScope } : {}),
  } as ChatChoicePresentedLine;
}

function choiceResolved(
  turnId: string,
  cardId: string,
  choiceSelected = 'proceed',
  resolvedLabel = 'Proceeded',
  workerScope?: string,
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
    ...(workerScope ? { workerScope } : {}),
  } as ChatChoiceResolvedLine;
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

  it('routes cancelled cards to a synthetic `_cancelled_:{cardId}` scope so they sort chronologically below earlier worker output', () => {
    // Regression: the previous policy let cancelled cards inherit
    // `_main_`, which is hard-pinned to the first section. When the
    // user clicked Stop AFTER worker output had landed, the cancelled
    // card rendered ABOVE that worker output (scroll-top fixation).
    // ChatService.appendChoicePresentedCancelled now stamps a
    // synthetic `_cancelled_:{cardId}` workerScope; combined with
    // chronological section ordering, the cancelled card lands at its
    // actual ts — i.e. below the worker output that ran before Stop.
    const u = userTurn('t-stop');
    const mainMsg = assistantMessage('t-stop', 'decompose response');
    const w1Msg = status('t-stop', 'card-w1', 'read', { filePath: 'b.ts' }, 'worker-1');
    const cancelled = choicePresented(
      't-stop',
      'cancelled-t-stop-j1-1',
      'cancelled',
      '_cancelled_:cancelled-t-stop-j1-1',
    );

    const turns = selectTurns({
      chatEvents: [u, mainMsg, w1Msg, cancelled],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      MAIN_WORKER_SCOPE,
      'worker-1',
      '_cancelled_:cancelled-t-stop-j1-1',
    ]);

    // `_main_` keeps the orchestration intro only.
    expect(sections[0].items.map((i: any) => i.kind)).toEqual(['assistant_message']);
    // worker-1 keeps its own status card.
    expect(sections[1].items.map((i: any) => i.kind)).toEqual(['status']);
    // Cancelled card occupies its own dedicated section, rendered last.
    const cancelledItems = sections[2].items;
    expect(cancelledItems).toHaveLength(1);
    const cancelledItem = cancelledItems[0] as any;
    expect(cancelledItem.kind).toBe('choice');
    expect(cancelledItem.presented.cardType).toBe('cancelled');
    expect(cancelledItem.presented.cardId).toBe('cancelled-t-stop-j1-1');
  });

  it('pushes the cancelled card upward when post-resume worker output accumulates with later ts', () => {
    // Resume scenario: after the user clicks Resume on the cancelled
    // card, a choice_resolved sibling lands in the same synthetic
    // scope (BE inherits the presented line's workerScope), and any
    // new worker output that follows must render BELOW the cancelled
    // section because its first-event ts is later.
    const u = userTurn('t-resume');
    const mainMsg = assistantMessage('t-resume', 'decompose response');
    const w1Msg = status('t-resume', 'card-w1', 'read', { filePath: 'b.ts' }, 'worker-1');
    const cancelledScope = '_cancelled_:cancelled-t-resume-j1-1';
    const cancelled = choicePresented(
      't-resume',
      'cancelled-t-resume-j1-1',
      'cancelled',
      cancelledScope,
    );
    const resumed = choiceResolved(
      't-resume',
      'cancelled-t-resume-j1-1',
      'resume',
      'Resumed',
      cancelledScope,
    );
    const w2NewMsg = status(
      't-resume',
      'card-w2-new',
      'read',
      { filePath: 'c.ts' },
      'worker-0#new-task',
    );

    const turns = selectTurns({
      chatEvents: [u, mainMsg, w1Msg, cancelled, resumed, w2NewMsg],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      MAIN_WORKER_SCOPE,
      'worker-1',
      cancelledScope,
      'worker-0#new-task',
    ]);

    // Cancelled section still pairs presented + resolved into one item.
    const cancelledSection = sections[2];
    expect(cancelledSection.items).toHaveLength(1);
    const cancelledItem = cancelledSection.items[0] as any;
    expect(cancelledItem.kind).toBe('choice');
    expect(cancelledItem.presented.cardType).toBe('cancelled');
    expect(cancelledItem.resolved?.choiceSelected).toBe('resume');
    expect(cancelledItem.resolved?.resolvedLabel).toBe('Resumed');

    // New worker output sits below the cancelled card.
    expect(sections[3].items.map((i: any) => i.kind)).toEqual(['status']);
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

  it('interleaves cancelled cards between cycle-suffixed worker sections across multiple stop/resume cycles (`even-getting-knave` regression)', () => {
    // Reproduces the user-reported `even-getting-knave` regression in
    // `posa/features/base`: a single design task survived three
    // stop/resume cycles. Without cycle suffix, every cycle's events
    // folded into one `worker-N#task-K` section anchored to cycle 1's
    // first ts — so all cancelled cards (each minted at its own stop
    // ts) sorted BELOW the worker section, leaving the latest cancelled
    // card "stuck" right above the chat input even after Resume.
    //
    // With `worker-N#task-K#p{cycleSeq}` minted by `TaskWorker` (peek
    // of `pauseSeq` at task entry), each cycle gets its own section
    // whose first ts is the cycle's actual start. Cancelled cards
    // chronologically interleave between cycle sections.
    const u = userTurn('t-knave');
    const cancelled1Scope = '_cancelled_:cancelled-t-knave-j1-1';
    const cancelled2Scope = '_cancelled_:cancelled-t-knave-j1-2';
    const cancelled3Scope = '_cancelled_:cancelled-t-knave-j1-3';

    // Cycle 0 — first attempt (no suffix, matches legacy two-axis form).
    const c0a = status('t-knave', 'c0a', 'read', { filePath: 'a.ts' }, 'worker-1#task-A');
    const c0b = status('t-knave', 'c0b', 'read', { filePath: 'b.ts' }, 'worker-1#task-A');
    // Stop 1.
    const cancelled1 = choicePresented('t-knave', 'cancelled-t-knave-j1-1', 'cancelled', cancelled1Scope);
    // Resume 1 + cycle 1 (`#p1` suffix).
    const resolved1 = choiceResolved('t-knave', 'cancelled-t-knave-j1-1', 'resume', 'Resumed', cancelled1Scope);
    const c1a = status('t-knave', 'c1a', 'read', { filePath: 'c.ts' }, 'worker-1#task-A#p1');
    // Stop 2.
    const cancelled2 = choicePresented('t-knave', 'cancelled-t-knave-j1-2', 'cancelled', cancelled2Scope);
    // Resume 2 + cycle 2 (`#p2` suffix).
    const resolved2 = choiceResolved('t-knave', 'cancelled-t-knave-j1-2', 'resume', 'Resumed', cancelled2Scope);
    const c2a = status('t-knave', 'c2a', 'read', { filePath: 'd.ts' }, 'worker-1#task-A#p2');
    // Stop 3 — final state the user observes; cancelled-3 is the most
    // recent event so it should render at the bottom (closest to input).
    const cancelled3 = choicePresented('t-knave', 'cancelled-t-knave-j1-3', 'cancelled', cancelled3Scope);

    const turns = selectTurns({
      chatEvents: [
        u,
        c0a,
        c0b,
        cancelled1,
        resolved1,
        c1a,
        cancelled2,
        resolved2,
        c2a,
        cancelled3,
      ],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      'worker-1#task-A',
      cancelled1Scope,
      'worker-1#task-A#p1',
      cancelled2Scope,
      'worker-1#task-A#p2',
      cancelled3Scope,
    ]);

    // The latest cancelled card occupies the LAST section — visually
    // closest to the chat input — which matches user expectation while
    // a stop is in effect.
    const last = sections[sections.length - 1];
    expect(last.workerScope).toBe(cancelled3Scope);
    expect(last.items).toHaveLength(1);
    const lastItem = last.items[0] as any;
    expect(lastItem.kind).toBe('choice');
    expect(lastItem.presented.cardType).toBe('cancelled');
    expect(lastItem.presented.cardId).toBe('cancelled-t-knave-j1-3');
    expect(lastItem.resolved).toBeUndefined();
  });

  it('pushes the cancelled card upward once cycle-N+1 worker output starts emitting after Resume', () => {
    // Same setup as above but the user clicks Resume on cancelled-3 and
    // a fresh cycle-3 (`#p3`) section starts collecting messages. The
    // cycle-3 section's first ts is later than cancelled-3's first ts,
    // so chronological sort puts cycle-3 BELOW the cancelled-3 section.
    // This is the behaviour the architecture doc §섹션-정렬 rule 4
    // promised; before the cycle-suffix fix it never held.
    const u = userTurn('t-knave-r');
    const cancelled3Scope = '_cancelled_:cancelled-t-knave-r-j1-3';

    const c0 = status('t-knave-r', 'c0', 'read', { filePath: 'a.ts' }, 'worker-1#task-A');
    const cancelled3 = choicePresented('t-knave-r', 'cancelled-t-knave-r-j1-3', 'cancelled', cancelled3Scope);
    const resolved3 = choiceResolved('t-knave-r', 'cancelled-t-knave-r-j1-3', 'resume', 'Resumed', cancelled3Scope);
    // Cycle-3 (`#p3`) first message — emitted AFTER cancelled-3 ts.
    const c3a = status('t-knave-r', 'c3a', 'read', { filePath: 'b.ts' }, 'worker-1#task-A#p3');

    const turns = selectTurns({
      chatEvents: [u, c0, cancelled3, resolved3, c3a],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      'worker-1#task-A',
      cancelled3Scope,
      'worker-1#task-A#p3',
    ]);
    // The cancelled card now sits ABOVE the cycle-3 worker output and
    // the bottom-most section is the worker (= chat input shows new
    // worker output, not the cancelled card).
    expect(sections[sections.length - 1].workerScope).toBe('worker-1#task-A#p3');
    // The resolved sibling is paired with its presented in the
    // cancelled section.
    const cancelledItem = sections[1].items[0] as any;
    expect(cancelledItem.kind).toBe('choice');
    expect(cancelledItem.resolved?.choiceSelected).toBe('resume');
  });

  it('keeps multiple parallel workers in the same cycle aligned via shared cycleSeq suffix', () => {
    // pauseSeq is turnId-level, so every worker that re-enters
    // `runInTaskScope` after the same Resume click reads the same peek
    // value and stamps the same `#p{n}` suffix. This guarantees that a
    // 2-worker fan-out emits two sibling sections with identical cycle
    // suffix instead of drifting apart.
    const u = userTurn('t-fan');

    // Cycle 0 — both workers' first attempts.
    const w0a = status('t-fan', 'w0a', 'read', { filePath: 'a.ts' }, 'worker-0#task-A');
    const w1a = status('t-fan', 'w1a', 'read', { filePath: 'b.ts' }, 'worker-1#task-B');
    // Stop happens (cancelled card omitted for brevity — the suffix
    // contract is what matters here).
    // Cycle 1 — both workers re-enter at the same cycleSeq.
    const w0b = status('t-fan', 'w0b', 'read', { filePath: 'c.ts' }, 'worker-0#task-A#p1');
    const w1b = status('t-fan', 'w1b', 'read', { filePath: 'd.ts' }, 'worker-1#task-B#p1');

    const turns = selectTurns({
      chatEvents: [u, w0a, w1a, w0b, w1b],
      streamingBuffers: emptyBuffers(),
    });

    const sections = turns[0].sections;
    expect(sections.map((s) => s.workerScope)).toEqual([
      'worker-0#task-A',
      'worker-1#task-B',
      'worker-0#task-A#p1',
      'worker-1#task-B#p1',
    ]);
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

  it('returns the same Turn[] reference when chatEvents has new array ref but identical contents (incremental-cache contract)', () => {
    // Phase 11.1: the projector switched to a per-turn incremental
    // cache. When events content is identical (every element ref-equal),
    // every per-turn slot is reused, so the root `Turn[]` reference is
    // preserved too. This is what lets `React.memo` on `TurnItem` bail
    // out across `replaceChatEvents` snapshots that match the cache.
    const evA: ChatLine[] = [userTurn('t-1'), assistantMessage('t-1')];
    const evB: ChatLine[] = [...evA];

    const a = selectTurns({ chatEvents: evA, streamingBuffers: emptyBuffers() });
    const b = selectTurns({ chatEvents: evB, streamingBuffers: emptyBuffers() });

    expect(a).toBe(b);
  });

  it('returns a fresh Turn[] when content actually differs between calls', () => {
    const evA: ChatLine[] = [userTurn('t-1'), assistantMessage('t-1', 'first')];
    const evB: ChatLine[] = [userTurn('t-2'), assistantMessage('t-2', 'second')];

    const a = selectTurns({ chatEvents: evA, streamingBuffers: emptyBuffers() });
    const b = selectTurns({ chatEvents: evB, streamingBuffers: emptyBuffers() });

    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. Incremental projection cache (Phase 11.1 — chat-render-jank-fix)
// ─────────────────────────────────────────────────────────────────────
//
// The projector splits its work per-turn so an SSE delta on one turn
// (or one streaming buffer) never re-folds the entire history. Each
// untouched turn keeps its previous `Turn` reference, which is what
// `React.memo` on `TurnItem` reads to bail out for the rest of the
// viewport. These tests pin those reference-stability invariants.
// ─────────────────────────────────────────────────────────────────────

describe('selectTurns — incremental cache (per-turn reference stability)', () => {
  it('preserves Turn references for older turns when a new turn is appended', () => {
    const u1 = userTurn('t-1');
    const m1 = assistantMessage('t-1', 'reply 1');
    const evA: ChatLine[] = [u1, m1];
    const a = selectTurns({ chatEvents: evA, streamingBuffers: emptyBuffers() });
    expect(a).toHaveLength(1);

    // Append a new turn — old turn must keep its reference.
    const u2 = userTurn('t-2');
    const m2 = assistantMessage('t-2', 'reply 2');
    const evB: ChatLine[] = [...evA, u2, m2];
    const b = selectTurns({ chatEvents: evB, streamingBuffers: emptyBuffers() });

    expect(b).toHaveLength(2);
    expect(b[0]).toBe(a[0]); // t-1 reference preserved
    expect(b).not.toBe(a);
  });

  it('preserves Turn references for unaffected turns when a new line lands in an existing turn', () => {
    const u1 = userTurn('t-1');
    const m1 = assistantMessage('t-1', 'reply 1');
    const u2 = userTurn('t-2');
    const m2 = assistantMessage('t-2', 'reply 2');
    const evA: ChatLine[] = [u1, m1, u2, m2];
    const a = selectTurns({ chatEvents: evA, streamingBuffers: emptyBuffers() });
    expect(a).toHaveLength(2);

    // New line in t-2 only — t-1 must keep its ref, t-2 must change.
    const m2b = status('t-2', 'card-x', 'read', { filePath: 'x.ts' });
    const evB: ChatLine[] = [...evA, m2b];
    const b = selectTurns({ chatEvents: evB, streamingBuffers: emptyBuffers() });

    expect(b[0]).toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
  });

  it('preserves Turn references when only the streamingBuffers reference changes but no buffer entry differs', () => {
    const evA: ChatLine[] = [userTurn('t-1'), assistantMessage('t-1')];
    const buf: StreamingBuffer = {
      turnId: 't-1',
      workerScope: MAIN_WORKER_SCOPE,
      text: 'hello',
    };
    const buffersA: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-1', MAIN_WORKER_SCOPE)]: buf,
    };
    const buffersB: Record<BufferKey, StreamingBuffer> = { ...buffersA };

    const a = selectTurns({ chatEvents: evA, streamingBuffers: buffersA });
    const b = selectTurns({ chatEvents: evA, streamingBuffers: buffersB });

    // Same buffer entry, different outer ref — Turn ref must be reused.
    expect(b[0]).toBe(a[0]);
  });

  it('only re-projects the affected turn when a streaming-delta updates one turn`s buffer', () => {
    const u1 = userTurn('t-1');
    const m1 = assistantMessage('t-1', 'reply 1');
    const u2 = userTurn('t-2');
    const events: ChatLine[] = [u1, m1, u2];

    const t1Buf: StreamingBuffer = { turnId: 't-1', workerScope: MAIN_WORKER_SCOPE, text: 'a' };
    const t2Buf: StreamingBuffer = { turnId: 't-2', workerScope: MAIN_WORKER_SCOPE, text: 'b' };
    const buffersA: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-1', MAIN_WORKER_SCOPE)]: t1Buf,
      [makeBufferKey('t-2', MAIN_WORKER_SCOPE)]: t2Buf,
    };
    const a = selectTurns({ chatEvents: events, streamingBuffers: buffersA });

    // Update only t-2's buffer (mimics applyStreamingDelta on t-2).
    const t2BufNext: StreamingBuffer = { ...t2Buf, text: 'b+' };
    const buffersB: Record<BufferKey, StreamingBuffer> = {
      ...buffersA,
      [makeBufferKey('t-2', MAIN_WORKER_SCOPE)]: t2BufNext,
    };
    const b = selectTurns({ chatEvents: events, streamingBuffers: buffersB });

    expect(b[0]).toBe(a[0]); // t-1 untouched
    expect(b[1]).not.toBe(a[1]); // t-2 reprojected
    expect(b[1].sections[0].activeText).toBe('b+');
  });

  it('full-rebuild path triggers when chatEvents is no longer a prefix of the previous array', () => {
    const evA: ChatLine[] = [userTurn('t-1'), assistantMessage('t-1', 'hello')];
    const a = selectTurns({ chatEvents: evA, streamingBuffers: emptyBuffers() });

    // Brand new history (e.g. clearChatEvents → new turn) — no prefix
    // overlap, full reproject is forced.
    const evB: ChatLine[] = [userTurn('t-2'), assistantMessage('t-2', 'hi')];
    const b = selectTurns({ chatEvents: evB, streamingBuffers: emptyBuffers() });

    expect(b).not.toBe(a);
    expect(b[0].turnId).toBe('t-2');
  });

  it('drops orphan turns whose buffers were cleared between calls', () => {
    const orphanBuf: StreamingBuffer = {
      turnId: 't-orphan',
      workerScope: MAIN_WORKER_SCOPE,
      thinking: 'pre-flight',
    };
    const buffersA: Record<BufferKey, StreamingBuffer> = {
      [makeBufferKey('t-orphan', MAIN_WORKER_SCOPE)]: orphanBuf,
    };
    const a = selectTurns({ chatEvents: [], streamingBuffers: buffersA });
    expect(a).toHaveLength(1);
    expect(a[0].turnId).toBe('t-orphan');

    // Real user_turn lands AND orphan buffer is gone.
    const u = userTurn('t-real');
    const b = selectTurns({ chatEvents: [u], streamingBuffers: emptyBuffers() });
    expect(b).toHaveLength(1);
    expect(b[0].turnId).toBe('t-real');
  });

  it('500-turn append: 499 unchanged Turn refs are preserved', () => {
    // Build a 500-turn history (one user_turn + one assistant_message
    // per turn). This is the long-session smoke case from the plan §검증
    // — we don't time the call (CI flake risk) but verify the
    // structural invariant that drives the win: every untouched turn
    // must reuse its previous Turn reference, so React.memo on
    // `TurnItem` bails out for 499 of 500 viewport candidates.
    const TURN_COUNT = 500;
    const events: ChatLine[] = [];
    for (let i = 0; i < TURN_COUNT; i++) {
      events.push(userTurn(`t-${i}`, `prompt ${i}`));
      events.push(assistantMessage(`t-${i}`, `reply ${i}`));
    }
    const a = selectTurns({ chatEvents: events, streamingBuffers: emptyBuffers() });
    expect(a).toHaveLength(TURN_COUNT);

    // Append one new turn — only the trailing Turn should differ.
    const eventsB: ChatLine[] = [
      ...events,
      userTurn(`t-${TURN_COUNT}`),
      assistantMessage(`t-${TURN_COUNT}`),
    ];
    const b = selectTurns({ chatEvents: eventsB, streamingBuffers: emptyBuffers() });
    expect(b).toHaveLength(TURN_COUNT + 1);
    for (let i = 0; i < TURN_COUNT; i++) {
      expect(b[i]).toBe(a[i]);
    }
  });
});
