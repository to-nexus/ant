/**
 * P2 — assistant_turn distillation (e2-humming-spindle Context Lens).
 *
 * Job-end write-once seam: finalText harvested from the turn's chat lines,
 * digest built from choice_resolved lines (deterministic) plus an optional
 * LLM pass (Tier 2+). Failure policy: never throws, LLM failures fall back
 * to the template digest.
 */

import { describe, it, expect, vi } from 'vitest';
import { distillAssistantTurn, extractChoiceDecisions } from '../../src/core/context/assistantTurn';
import type { SessionPort } from '../../src/core/ports/session';

function makeSession(chatLines: any[]) {
  const appended: any[] = [];
  const session = {
    loadChatByTurnIds: vi.fn(async () => chatLines),
    appendAssistantTurn: vi.fn(async (line: any) => { appended.push(line); }),
  } as unknown as SessionPort;
  return { session, appended };
}

const BASE = { ts: '2026-07-21T00:00:01.000Z', jobId: 'j1', turnId: 't1', jobType: 'design' };

describe('distillAssistantTurn', () => {
  it('harvests finalText from the turn chat lines and appends the line', async () => {
    const { session, appended } = makeSession([
      { ...BASE, type: 'assistant_message', text: 'I created the spec.' },
      { ...BASE, type: 'chat_status', cardId: 'c1', statusType: 'task_response', metadata: { content: 'Spec written to architecture/spec/x.md.' } },
      { ...BASE, type: 'chat_status', cardId: 'c2', statusType: 'read', metadata: { filePath: 'noise' } },
    ]);

    const line = await distillAssistantTurn({
      session, jobId: 'j1', turnId: 't1', jobType: 'design', directive: 'make a spec',
    });

    expect(line).toBeDefined();
    expect(appended).toHaveLength(1);
    expect(appended[0].type).toBe('assistant_turn');
    expect(appended[0].finalText).toContain('I created the spec.');
    expect(appended[0].finalText).toContain('Spec written');
    expect(appended[0].finalText).not.toContain('noise');
    expect(appended[0].ephemeral).toBeUndefined();
  });

  it('ingests resolved choices deterministically into digest.decisions', async () => {
    const { session, appended } = makeSession([
      { ...BASE, type: 'assistant_message', text: 'done' },
      { ...BASE, type: 'choice_presented', cardId: 'card-1', cardType: 'clarifying', prompt: 'Which auth flow?' },
      { ...BASE, type: 'choice_resolved', cardId: 'card-1', choiceSelected: 'proceed', resolvedLabel: 'OK', answer: { flow: 'oauth' } },
    ]);

    await distillAssistantTurn({ session, jobId: 'j1', turnId: 't1', jobType: 'design' });

    const digest = appended[0].digest;
    expect(digest.decisions).toHaveLength(1);
    expect(digest.decisions[0]).toContain('Which auth flow?');
    expect(digest.decisions[0]).toContain('proceed');
    expect(digest.decisions[0]).toContain('oauth');
  });

  it('uses finalTextOverride (ask path) without touching chat.jsonl', async () => {
    const { session, appended } = makeSession([]);

    await distillAssistantTurn({
      session, jobId: 'j1', turnId: 't1', jobType: 'inline-ask',
      ephemeral: true, finalTextOverride: 'You changed the login page.',
    });

    expect((session as any).loadChatByTurnIds).not.toHaveBeenCalled();
    expect(appended[0].finalText).toBe('You changed the login page.');
    expect(appended[0].ephemeral).toBe(true);
  });

  it('runs the LLM digest for tier>=2 and merges choice decisions first', async () => {
    const { session, appended } = makeSession([
      { ...BASE, type: 'assistant_message', text: 'implemented per your constraint' },
      { ...BASE, type: 'choice_presented', cardId: 'c', cardType: 'clarifying', prompt: 'P?' },
      { ...BASE, type: 'choice_resolved', cardId: 'c', choiceSelected: 'optionB', resolvedLabel: 'B' },
    ]);
    const llm = {
      invoke: vi.fn(async () => JSON.stringify({
        decisions: ['use option B'],
        constraints: ['항상 한국어로 답해라'],
        outcome: 'login page implemented',
      })),
    };
    const promptPort = { render: vi.fn(async () => 'digest prompt') };

    await distillAssistantTurn({
      session, jobId: 'j1', turnId: 't1', jobType: 'code',
      executionTierId: 3, llm: llm as any, promptPort: promptPort as any,
    });

    const digest = appended[0].digest;
    expect(digest.decisions[0]).toContain('P?'); // deterministic first
    expect(digest.decisions).toContain('use option B');
    expect(digest.constraints).toEqual(['항상 한국어로 답해라']);
    expect(digest.outcome).toBe('login page implemented');
  });

  it('falls back to the template digest when the LLM output is unparseable', async () => {
    const { session, appended } = makeSession([
      { ...BASE, type: 'assistant_message', text: 'final answer text' },
    ]);
    const llm = { invoke: vi.fn(async () => 'not json at all') };
    const promptPort = { render: vi.fn(async () => 'p') };

    await distillAssistantTurn({
      session, jobId: 'j1', turnId: 't1', jobType: 'code',
      executionTierId: 3, llm: llm as any, promptPort: promptPort as any,
    });

    expect(appended).toHaveLength(1);
    expect(appended[0].digest.outcome).toContain('final answer');
    expect(appended[0].digest.constraints).toEqual([]);
  });

  it('skips silently when the turn has no prose and no decisions', async () => {
    const { session, appended } = makeSession([
      { ...BASE, type: 'chat_status', cardId: 'c', statusType: 'read', metadata: {} },
    ]);

    const line = await distillAssistantTurn({ session, jobId: 'j1', turnId: 't1', jobType: 'code' });

    expect(line).toBeUndefined();
    expect(appended).toHaveLength(0);
  });

  it('never throws on session failure', async () => {
    const session = {
      loadChatByTurnIds: vi.fn(async () => { throw new Error('disk gone'); }),
      appendAssistantTurn: vi.fn(),
    } as unknown as SessionPort;

    await expect(
      distillAssistantTurn({ session, jobId: 'j1', turnId: 't1', jobType: 'code' }),
    ).resolves.toBeUndefined();
  });
});

describe('extractChoiceDecisions', () => {
  it('records dismissals too and tolerates unpaired resolutions', () => {
    const decisions = extractChoiceDecisions([
      { ...BASE, type: 'choice_presented', cardId: 'a', cardType: 'spec_complete', prompt: 'Generate code now?' },
      { ...BASE, type: 'choice_resolved', cardId: 'a', choiceSelected: 'dismiss', resolvedLabel: 'Dismissed' },
      { ...BASE, type: 'choice_resolved', cardId: 'zz-unpaired', choiceSelected: 'proceed', resolvedLabel: 'OK' },
    ] as any);

    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toBe('Generate code now? → dismiss');
    expect(decisions[1]).toBe('choice → proceed');
  });
});
