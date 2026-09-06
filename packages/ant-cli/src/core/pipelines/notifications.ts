/**
 * Pipeline HITL notification port — fire-and-forget fan-out of gate lifecycle
 * notices to their audience ({activator} ∪ approvers[stepId]). ONE publish
 * owner: the coordinator's gate arm/remind/resolve legs call `notify` per
 * recipient instead of publishing inline, so a later Slack/email channel is an
 * adapter drop-in that never touches permission code (doc 46 §5).
 *
 * v1 ships `InAppChannel` only: the Transfer precedent — publish onto the
 * recipient's user-scoped realtime channel; failures are warn-logged and never
 * block dispatch or gate arming. Durability is NOT the channel's job — the
 * `GET /approvals` refetch is what heals a missed event.
 */

import type { GateDecision, PipelineEventData } from '@ant/shared';
import { getRealtimeBroadcastChannel } from '../constants/redis';
import type { StateStorePort } from '../ports/stateStore';
import { logger } from '../../utils/logger';

export interface PipelineNoticeRecipient {
  userId: string;
  organizationId: string;
  /** How this recipient relates to the gate — approver rows are marked on the wire. */
  role: 'owner' | 'approver';
}

export interface PipelineNotice {
  kind: 'approvalRequested' | 'approvalReminder' | 'approvalResolved';
  recipient: PipelineNoticeRecipient;
  gateId: string;
  cardId: string;
  runId: string;
  pipelineId: string;
  pipelineName: string;
  projectId: string;
  /** The activation's owner — approver-side reads key off it. */
  ownerUserId: string;
  stepId: string;
  prompt: string;
  /** Required on requested/reminder notices; resolved notices may omit it. */
  armedAt?: string;
  timeoutAt?: string;
  /** In-app routing token today; Phase C promotes it to a magic-link. */
  deepLink: string;
  /** approvalResolved only. */
  decision?: GateDecision;
  decidedBy?: string;
}

export interface NotificationChannelPort {
  /** Fire-and-forget: failures are logged, never thrown — dispatch and gate arming must not block. */
  notify(notice: PipelineNotice): Promise<void>;
}

export function pipelineGateDeepLink(gateId: string): string {
  return `ant://pipelines/approvals/${gateId}`;
}

/**
 * In-app adapter — the recipient's user-scoped SSE channel (Transfer
 * precedent). Reminder rides the same `approvalRequested` cause the FE already
 * folds idempotently (gateId-keyed).
 */
export class InAppChannel implements NotificationChannelPort {
  constructor(private readonly stateStore: Pick<StateStorePort, 'publish'>) {}

  async notify(notice: PipelineNotice): Promise<void> {
    const { recipient } = notice;
    const data: PipelineEventData =
      notice.kind === 'approvalResolved'
        ? {
            cause: 'approvalResolved',
            projectId: notice.projectId,
            pipelineId: notice.pipelineId,
            runId: notice.runId,
            gateId: notice.gateId,
            decision: notice.decision ?? 'approved',
            decidedBy: notice.decidedBy,
          }
        : {
            cause: 'approvalRequested',
            projectId: notice.projectId,
            approval: {
              gateId: notice.gateId,
              cardId: notice.cardId,
              runId: notice.runId,
              pipelineId: notice.pipelineId,
              pipelineName: notice.pipelineName,
              projectId: notice.projectId,
              stepId: notice.stepId,
              prompt: notice.prompt,
              armedAt: notice.armedAt ?? new Date().toISOString(),
              ...(notice.timeoutAt && { timeoutAt: notice.timeoutAt }),
              ...(recipient.role === 'approver' && { role: 'approver' as const, ownerUserId: notice.ownerUserId }),
            },
          };
    try {
      await this.stateStore.publish(getRealtimeBroadcastChannel(recipient.organizationId, recipient.userId), {
        type: 'pipeline',
        data,
        userContext: { userId: recipient.userId, organizationId: recipient.organizationId },
      });
    } catch (err) {
      logger.warn(`[Pipeline] ${notice.kind} notify failed for ${recipient.userId}`, { component: 'PipelineNotify' }, err);
    }
  }
}
