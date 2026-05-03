import { describe, expect, it } from 'vitest';
import type { ChatStatusLine } from '@ant/shared';
import { shouldSuppressPreviewOnlyStatusCard } from '../../src/presentation/components/chat/statusCardVisibility';

function makeLine(partial: Partial<ChatStatusLine>): ChatStatusLine {
  return {
    type: 'chat_status',
    ts: '2026-05-04T00:00:00.000Z',
    jobId: 'job-1',
    turnId: 'turn-1',
    jobType: 'code',
    cardId: 'card-1',
    statusType: 'tool_action',
    metadata: {},
    ...partial,
  };
}

describe('turn item preview-only policy', () => {
  it('suppresses file card statuses for plan/design jobs', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'plan', statusType: 'file_create' }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'design', statusType: 'file_editing' }),
      ),
    ).toBe(true);
  });

  it('suppresses plan and task response statuses for plan/design jobs', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'plan', statusType: 'plan_generating' }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'design', statusType: 'task_response' }),
      ),
    ).toBe(true);
  });

  it('does not suppress statuses for code jobs', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'code', statusType: 'file_create' }),
      ),
    ).toBe(false);
  });

  it('does not suppress non-target statuses in plan/design jobs', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'plan', statusType: 'tool_action' }),
      ),
    ).toBe(false);
  });
});
