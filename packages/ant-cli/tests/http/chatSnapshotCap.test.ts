/**
 * capSnapshotProcessEvents — guards the `chat_initial_state` snapshot shaping.
 *
 * Rule: keep every conversation / choice line; cap the transient process
 * trail (`chat_status` + `assistant_thinking`) to the most recent N,
 * preserving chronological order. On-disk chat.jsonl is never mutated — this
 * only shapes the reload snapshot so a single long-lived turn (a verification
 * run alone emits thousands of status cards) can't blow up the virtualizer.
 */

import { describe, it, expect } from 'vitest';
import type { ChatLine } from '@ant/shared';
import {
  capSnapshotProcessEvents,
  selectUnclosedWorkerScopes,
} from '../../src/periphery/adapters/http/services/ChatService';

const CAP = 400;

function line(type: ChatLine['type'], i: number): ChatLine {
  // Opaque, strictly-ascending ts (cap preserves input order; the only ts
  // consumer is the chronological-order assertion). Zero-pad so string
  // compare == numeric order.
  const ts = String(i).padStart(9, '0');
  return { type, ts, jobId: 'j', turnId: 't', jobType: 'code' } as unknown as ChatLine;
}

function scopeEnd(i: number, workerScope: string, outcome = 'completed'): ChatLine {
  return {
    ...(line('chat_status', i) as any),
    statusType: 'task_scope_end',
    cardId: `c${i}`,
    metadata: { outcome },
    workerScope,
  } as unknown as ChatLine;
}

function scopeLine(i: number, workerScope: string, statusType = 'tool_action'): ChatLine {
  return {
    ...(line('chat_status', i) as any),
    statusType,
    cardId: `c${i}`,
    workerScope,
  } as unknown as ChatLine;
}

describe('capSnapshotProcessEvents', () => {
  it('is a no-op when process events are at/under the cap', () => {
    const lines: ChatLine[] = [
      line('user_turn', 0),
      ...Array.from({ length: CAP }, (_, i) => line('chat_status', i + 1)),
      line('assistant_message', CAP + 1),
    ];
    const out = capSnapshotProcessEvents(lines);
    expect(out).toBe(lines); // same reference — untouched
  });

  it('keeps all conversation/choice lines and only the most recent N process lines', () => {
    const convo: ChatLine[] = [
      line('user_turn', 0),
      line('assistant_message', 1),
      line('choice_presented', 2),
      line('choice_resolved', 3),
    ];
    // 1000 process events interleaved after the conversation
    const process = Array.from({ length: 1000 }, (_, i) =>
      line(i % 2 ? 'assistant_thinking' : 'chat_status', 100 + i),
    );
    const out = capSnapshotProcessEvents([...convo, ...process]);

    const isProcess = (l: ChatLine) =>
      l.type === 'chat_status' || l.type === 'assistant_thinking';
    const outProcess = out.filter(isProcess);
    const outConvo = out.filter((l) => !isProcess(l));

    // All conversation/choice preserved
    expect(outConvo).toHaveLength(4);
    // Process capped to N
    expect(outProcess).toHaveLength(CAP);
    // The kept process events are the most recent ones (oldest dropped)
    expect(outProcess[0].ts).toBe(process[1000 - CAP].ts);
    expect(outProcess[outProcess.length - 1].ts).toBe(process[999].ts);
    // Chronological order preserved across the whole result
    const ts = out.map((l) => l.ts);
    expect([...ts].sort()).toEqual(ts);
  });

  // `task_scope_end` is the ONLY input to the FE's `TurnSection.outcome`.
  // Dropping one leaves a worker group spinning forever — the badge never
  // resolves, and after the job dies it lingers as an empty row.
  it('never drops task_scope_end markers, however old', () => {
    const markers = Array.from({ length: 50 }, (_, i) => scopeEnd(i, `worker-${i}#task-${i}`));
    const trail = Array.from({ length: 1000 }, (_, i) => scopeLine(1000 + i, 'worker-99#task-x'));
    const out = capSnapshotProcessEvents([...markers, ...trail]);

    const kept = out.filter(
      (l) => l.type === 'chat_status' && (l as any).statusType === 'task_scope_end',
    );
    expect(kept).toHaveLength(50);
  });

  it('does not spend the cap budget on structural markers', () => {
    // CAP cappable lines + markers interleaved → nothing is dropped.
    const lines: ChatLine[] = [];
    for (let i = 0; i < CAP; i++) {
      lines.push(scopeLine(i, 'worker-1#task-a'));
      if (i % 10 === 0) lines.push(scopeEnd(10_000 + i, `worker-${i}#task-${i}`));
    }
    const out = capSnapshotProcessEvents(lines);
    expect(out).toBe(lines); // same reference — untouched
  });
});

describe('selectUnclosedWorkerScopes', () => {
  it('reports a scope that never received a terminal marker', () => {
    const open = selectUnclosedWorkerScopes(
      [scopeLine(0, 'worker-1#task-a'), scopeLine(1, 'worker-2#task-b'), scopeEnd(2, 'worker-2#task-b')],
      'j',
    );
    expect([...open.keys()]).toEqual(['worker-1#task-a']);
  });

  // Regression: trailing lines under an already-closed scope used to re-open
  // it, so the cleanup backstop re-stamped `cancelled` over `completed` /
  // `superseded` scopes of a fully successful job → red ✗ in the FE.
  it('keeps a closed scope closed when later lines carry the same workerScope', () => {
    const open = selectUnclosedWorkerScopes(
      [
        scopeLine(0, 'worker-1#task-a'),
        scopeEnd(1, 'worker-1#task-a', 'superseded'),
        scopeLine(2, 'worker-1#task-a'),
        { ...(line('assistant_message', 3) as any), workerScope: 'worker-1#task-a' } as ChatLine,
      ],
      'j',
    );
    expect(open.size).toBe(0);
  });

  it('ignores other jobs, collapsed lines and non-worker scopes', () => {
    const foreign = { ...(scopeLine(0, 'worker-9#task-z') as any), jobId: 'other' } as ChatLine;
    const collapsed = { ...(scopeLine(1, 'worker-8#task-y') as any), collapsed: true } as ChatLine;
    const main = scopeLine(2, '_main_');
    const open = selectUnclosedWorkerScopes([foreign, collapsed, main], 'j');
    expect(open.size).toBe(0);
  });
});
