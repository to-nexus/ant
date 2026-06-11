/**
 * selectResumeFallbackCard — resume-affordance safety net.
 *
 * Bug (job `grim-padding-grove`): a cross-pod finalize race left a job persisted
 * as `paused + canResume:true` but the durable `cancelled` card never landed in
 * chat.jsonl, so the FE (which renders the resume card only from the chat log)
 * showed no way to resume on reconnect — even though the polled kanban already
 * carried the resumable interruption.
 *
 * This selector synthesizes a `choice_presented` cancelled card from the polled
 * kanban when (and only when) no durable card exists, the job is not running,
 * and the interruption is resumable and undismissed — so it flows through the
 * existing CancelledVariant + resume path without double-rendering a real card.
 */

import { describe, it, expect } from 'vitest';
import type { ChatChoicePresentedLine, KanbanData } from '@ant/shared';
import {
  selectResumeFallbackCard,
  MAIN_WORKER_SCOPE,
  type Turn,
  type TurnItem,
} from '../../src/domain/store/selectors/chat';

function kanban(extra: Partial<KanbanData> = {}): KanbanData {
  return {
    jobId: 'grim-padding-grove',
    todo: [],
    inProgress: [],
    completed: [],
    isEstimating: false,
    dataSource: 'session',
    interruption: {
      reason: 'server_shutdown',
      message: 'Job interrupted: server_shutdown',
      canResume: true,
      timestamp: '2026-06-11T04:26:24.446Z',
    },
    ...extra,
  } as KanbanData;
}

function turnWithCancelled(jobId: string, resolved = false): Turn {
  const presented = {
    type: 'choice_presented',
    ts: 't',
    jobId,
    turnId: 't1',
    jobType: 'code',
    cardId: 'real-card',
    cardType: 'cancelled',
  } as ChatChoicePresentedLine;
  const item: TurnItem = resolved
    ? { kind: 'choice', presented, resolved: { type: 'choice_resolved', ts: 't', jobId, turnId: 't1', jobType: 'code', cardId: 'real-card', choiceId: 'dismiss' } as any }
    : { kind: 'choice', presented };
  return { turnId: 't1', jobId, jobType: 'code', ts: 't', sections: [{ workerScope: MAIN_WORKER_SCOPE, items: [item] }] };
}

describe('selectResumeFallbackCard', () => {
  it('synthesizes a cancelled card when kanban is resumable and no durable card exists', () => {
    const card = selectResumeFallbackCard([], kanban(), false, null);
    expect(card).not.toBeNull();
    expect(card!.cardType).toBe('cancelled');
    expect(card!.jobId).toBe('grim-padding-grove');
    expect(card!.payload?.jobId).toBe('grim-padding-grove');
    expect(card!.payload?.reason).toBe('server_shutdown');
  });

  it('returns null when a durable cancelled card already exists for the job (no double-render)', () => {
    const turns = [turnWithCancelled('grim-padding-grove')];
    expect(selectResumeFallbackCard(turns, kanban(), false, null)).toBeNull();
  });

  it('returns null even when the durable cancelled card is already resolved', () => {
    const turns = [turnWithCancelled('grim-padding-grove', /* resolved */ true)];
    expect(selectResumeFallbackCard(turns, kanban(), false, null)).toBeNull();
  });

  it('returns null when the job is running', () => {
    expect(selectResumeFallbackCard([], kanban(), true, null)).toBeNull();
  });

  it('returns null when the interruption was dismissed (timestamp matches)', () => {
    expect(selectResumeFallbackCard([], kanban(), false, '2026-06-11T04:26:24.446Z')).toBeNull();
  });

  it('returns null when the interruption is not resumable', () => {
    const k = kanban({ interruption: { reason: 'user_stopped', message: 'x', canResume: false, timestamp: 't' } as any });
    expect(selectResumeFallbackCard([], k, false, null)).toBeNull();
  });

  it('returns null when there is no interruption / no jobId', () => {
    expect(selectResumeFallbackCard([], kanban({ interruption: undefined }), false, null)).toBeNull();
    expect(selectResumeFallbackCard([], kanban({ jobId: undefined }), false, null)).toBeNull();
  });

  it('does not dedup against a cancelled card for a DIFFERENT job', () => {
    const turns = [turnWithCancelled('some-other-job')];
    expect(selectResumeFallbackCard(turns, kanban(), false, null)).not.toBeNull();
  });
});
