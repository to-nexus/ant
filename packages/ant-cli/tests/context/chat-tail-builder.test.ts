/**
 * P1 — chat.jsonl rich tail assembly (e2-humming-spindle Context Lens).
 *
 * The tail feeds ask/inline-ask and Tier 0/1 direct with the recent
 * user↔assistant exchanges that featureContext structurally lacks
 * (assistant utterances never re-enter cross-job context otherwise).
 */

import { describe, it, expect } from 'vitest';
import { buildChatTail } from '../../src/core/context/chatTailBuilder';
import type { SessionPort } from '../../src/core/ports/session';

function sessionWith(lines: any[]): SessionPort {
  return { loadAllChat: async () => lines } as unknown as SessionPort;
}

let seq = 0;
function ts(): string {
  seq += 1;
  return `2026-07-21T00:00:${String(seq).padStart(2, '0')}.000Z`;
}

function userTurn(turnId: string, text: string, jobType = 'design') {
  return { type: 'user_turn', ts: ts(), jobId: `job-${turnId}`, turnId, jobType, text, sourceRef: 'x' };
}
function assistantMsg(turnId: string, text: string, kind?: string) {
  return { type: 'assistant_message', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design', text, ...(kind ? { kind } : {}) };
}
function taskResponse(turnId: string, content: string) {
  return {
    type: 'chat_status', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design',
    cardId: `card-${seq}`, statusType: 'task_response', metadata: { content },
  };
}

describe('buildChatTail', () => {
  it('groups exchanges by turn: user text + assistant finals + task_response cards', async () => {
    const tail = await buildChatTail(sessionWith([
      userTurn('t1', 'add a login page'),
      assistantMsg('t1', 'I added the login page.'),
      taskResponse('t1', 'Login page created at src/pages/Login.tsx.'),
    ]));

    expect(tail?.exchanges).toHaveLength(1);
    expect(tail!.exchanges[0].userText).toBe('add a login page');
    expect(tail!.exchanges[0].assistantText).toContain('I added the login page.');
    expect(tail!.exchanges[0].assistantText).toContain('Login page created');
  });

  it('treats absent kind as user-facing (legacy) and excludes non-prose kinds', async () => {
    const tail = await buildChatTail(sessionWith([
      userTurn('t1', 'q'),
      assistantMsg('t1', 'legacy free text'), // no kind — current production shape
      assistantMsg('t1', 'SHOULD NOT APPEAR 1', 'thinking_chunk'),
      assistantMsg('t1', 'SHOULD NOT APPEAR 2', 'rendered_payload'),
      assistantMsg('t1', 'SHOULD NOT APPEAR 3', 'system_notice'),
      assistantMsg('t1', 'final reply', 'directive_reply'),
    ]));

    const text = tail!.exchanges[0].assistantText!;
    expect(text).toContain('legacy free text');
    expect(text).toContain('final reply');
    expect(text).not.toContain('SHOULD NOT APPEAR');
  });

  it('keeps only the last K exchanges and excludes the current turn', async () => {
    const lines = [];
    for (let i = 1; i <= 9; i++) {
      lines.push(userTurn(`t${i}`, `directive ${i}`));
      lines.push(assistantMsg(`t${i}`, `answer ${i}`));
    }
    const tail = await buildChatTail(sessionWith(lines), { k: 3, excludeTurnId: 't9' });

    expect(tail!.exchanges.map((e) => e.turnId)).toEqual(['t6', 't7', 't8']);
  });

  it('caps assistant text keeping the tail (final answer trails)', async () => {
    const long = `${'x'.repeat(5000)}THE-END`;
    const tail = await buildChatTail(sessionWith([
      userTurn('t1', 'q'),
      assistantMsg('t1', long),
    ]), { assistantCharCap: 100 });

    const text = tail!.exchanges[0].assistantText!;
    expect(text).toContain('THE-END');
    expect(text).toContain('[earlier output truncated]');
    expect(text.length).toBeLessThan(200);
  });

  it('returns undefined without a session and empty exchanges on empty chat', async () => {
    expect(await buildChatTail(undefined)).toBeUndefined();
    expect((await buildChatTail(sessionWith([])))!.exchanges).toEqual([]);
  });

  it('drops turns with no user_turn anchor (status-only turns)', async () => {
    const tail = await buildChatTail(sessionWith([
      assistantMsg('orphan', 'no user turn here'),
      userTurn('t1', 'real'),
      assistantMsg('t1', 'answer'),
    ]));

    expect(tail!.exchanges.map((e) => e.turnId)).toEqual(['t1']);
  });
});
