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
  it('suppresses document file card statuses for plan/design jobs', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({
          jobType: 'plan',
          statusType: 'file_create',
          metadata: { filePath: 'plan/prd.md' },
        }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({
          jobType: 'design',
          statusType: 'file_editing',
          metadata: { filePath: 'architecture/spec/spec-main.md' },
        }),
      ),
    ).toBe(true);
  });

  // Non-document artifacts have no preview renderer, so the chat card is the
  // only surface — same as the code job.
  it.each([
    ['file_creating', 'visual/ui/ant/ui-tokens.json'],
    ['file_create', 'visual/ui/ant/ui-spec.json'],
    ['file_edit', 'visual/ui/handoff/tokens/colors.css'],
  ])('keeps %s in chat for a non-document artifact', (statusType, filePath) => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'design', statusType: statusType as any, metadata: { filePath } }),
      ),
    ).toBe(false);
  });

  it('keeps a path-less file status in chat', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({ jobType: 'design', statusType: 'file_create', metadata: {} }),
      ),
    ).toBe(false);
  });

  it('keeps delete statuses in chat — the preview never renders them', () => {
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({
          jobType: 'design',
          statusType: 'file_delete',
          metadata: { filePath: 'architecture/spec/spec-main.md' },
        }),
      ),
    ).toBe(false);
    expect(
      shouldSuppressPreviewOnlyStatusCard(
        makeLine({
          jobType: 'design',
          statusType: 'file_deleting',
          metadata: { filePath: 'architecture/spec/spec-main.md' },
        }),
      ),
    ).toBe(false);
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
        makeLine({
          jobType: 'code',
          statusType: 'file_create',
          metadata: { filePath: 'src/index.md' },
        }),
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
