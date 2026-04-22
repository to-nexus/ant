/**
 * Round-trip tests for choice_presented / choice_resolved trace lines.
 *
 * Covers the session redesign §16.2 refactor: chat.json is retired, choice
 * cards live in chat.jsonl as presented/resolved pairs, and
 * `buildChatMessagesFromChatLog` rebuilds them as legacy `ChatMessage`
 * content so the existing UI can render them unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionPersistence } from '../../../src/periphery/adapters/http/services/ChatService/SessionPersistence';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import { buildChatMessagesFromChatLog } from '../../../src/periphery/adapters/http/services/ChatService/ChatLogToMessages';
import type { UserContext } from '../../../src/core/types/user';

function makeResolverStub(featurePath: string) {
  return {
    getFeaturePath: () => featurePath,
    getProjectPath: () => path.dirname(featurePath),
  } as any;
}

const USER_CTX: UserContext = {
  userId: 'local',
  organizationId: 'local',
  email: 'local@local',
} as any;

describe('choice_presented / choice_resolved round-trip', () => {
  let tmpRoot: string;
  let featurePath: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-choice-'));
    featurePath = path.join(tmpRoot, 'features', 'feat-a');
    await fs.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function seedUserTurn(jobId: string, turnId: string): Promise<FileSessionAdapter> {
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId,
        turnId,
        jobType: 'code',
        text: 'do it',
      } as any,
      { skipFeature: false },
    );
    return adapter;
  }

  it('unresolved choice_presented renders as actionable cancelled card', async () => {
    const adapter = await seedUserTurn('job-1', 't-aa');
    const persistence = new SessionPersistence(makeResolverStub(featurePath));

    await persistence.emitChoicePresented({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-1',
      cardId: 'card-cancelled-1',
      cardType: 'cancelled',
      prompt: 'Job was cancelled — what next?',
      payload: { reason: 'user_interrupt', jobId: 'job-1' },
    });

    const chatLines = await adapter.loadAllChat();
    const messages = buildChatMessagesFromChatLog({ chatLines });
    // user + assistant
    expect(messages).toHaveLength(2);
    const asst = messages[1];
    expect(asst.contents).toHaveLength(1);
    const c = asst.contents[0];
    expect(c.type).toBe('cancelled');
    expect(c.content).toBe('Job was cancelled — what next?');
    expect((c.metadata as any)?.reason).toBe('user_interrupt');
    expect((c.metadata as any)?.choiceSelected).toBeUndefined();
    expect((c.metadata as any)?.resolved).toBeUndefined();
  });

  it('choice_resolved overlays choiceSelected + resolvedLabel on the same cardId', async () => {
    const adapter = await seedUserTurn('job-2', 't-bb');
    const persistence = new SessionPersistence(makeResolverStub(featurePath));

    await persistence.emitChoicePresented({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-2',
      cardId: 'card-eval-1',
      cardType: 'eval_save',
      prompt: 'Save eval report?',
      payload: { evalType: 'code' },
    });
    await persistence.emitChoiceResolved({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-2',
      cardId: 'card-eval-1',
      choiceSelected: 'save',
      resolvedLabel: 'Saved: outputs/evals/code/…',
    });

    const chatLines = await adapter.loadAllChat();
    const messages = buildChatMessagesFromChatLog({ chatLines });
    const asst = messages[1];
    const c = asst.contents[0];
    expect(c.type).toBe('choice_card');
    expect((c.metadata as any)?.cardType).toBe('eval_save');
    expect((c.metadata as any)?.evalType).toBe('code');
    expect((c.metadata as any)?.choiceSelected).toBe('save');
    expect((c.metadata as any)?.resolvedLabel).toBe('Saved: outputs/evals/code/…');
    expect((c.metadata as any)?.resolved).toBe(true);
  });

  it('triage_choice cardType maps to MessageContent.type=triage_choice', async () => {
    const adapter = await seedUserTurn('job-3', 't-cc');
    const persistence = new SessionPersistence(makeResolverStub(featurePath));

    await persistence.emitChoicePresented({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-3',
      cardId: 'card-triage-1',
      cardType: 'triage_choice',
      prompt: 'This looks like a design job — redirect?',
      payload: {
        choiceOptions: {
          positive: { label: 'Redirect', action: 'redirect' },
          negative: { label: 'Dismiss', action: 'dismiss' },
        },
      },
    });

    const chatLines = await adapter.loadAllChat();
    const messages = buildChatMessagesFromChatLog({ chatLines });
    const c = messages[1].contents[0];
    expect(c.type).toBe('triage_choice');
    expect((c.metadata as any)?.choiceOptions?.positive?.action).toBe('redirect');
  });

  it('answer payload on choice_resolved is merged into content metadata', async () => {
    const adapter = await seedUserTurn('job-4', 't-dd');
    const persistence = new SessionPersistence(makeResolverStub(featurePath));

    await persistence.emitChoicePresented({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-4',
      cardId: 'card-clar-1',
      cardType: 'clarifying',
      prompt: 'Which option?',
      payload: { clarifyBlocks: [{ question: 'Which?', options: ['a', 'b'] }] },
    });
    await persistence.emitChoiceResolved({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-4',
      cardId: 'card-clar-1',
      choiceSelected: 'submit',
      resolvedLabel: 'Submitted',
      answer: { resolvedAnswers: { 0: 'a' } },
    });

    const chatLines = await adapter.loadAllChat();
    const messages = buildChatMessagesFromChatLog({ chatLines });
    const c = messages[1].contents[0];
    expect(c.type).toBe('choice_card');
    expect((c.metadata as any)?.resolvedAnswers?.[0]).toBe('a');
    expect((c.metadata as any)?.choiceSelected).toBe('submit');
  });
});
