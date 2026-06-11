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
import { capSnapshotProcessEvents } from '../../src/periphery/adapters/http/services/ChatService';

const CAP = 400;

function line(type: ChatLine['type'], i: number): ChatLine {
  // Opaque, strictly-ascending ts (cap preserves input order; the only ts
  // consumer is the chronological-order assertion). Zero-pad so string
  // compare == numeric order.
  const ts = String(i).padStart(9, '0');
  return { type, ts, jobId: 'j', turnId: 't', jobType: 'code' } as unknown as ChatLine;
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
});
