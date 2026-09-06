/**
 * Approvals inbox — pending gates across the caller's own activations PLUS
 * the gates other members' activations name the caller an approver of — and
 * the API resolve leg (same NX-guarded ChatService funnel as a card click).
 *
 * Resolve authority (A2, doc 48 approver plan): the activation owner decides
 * everything as before; a NON-owner decides ONLY a `gate`-kind approval step
 * they are on the roster of — the roster re-read LIVE from the owner's
 * activation.json (an S9 edit or a revoked membership takes effect on the
 * next resolve, 404). Tool approvals (L3) and clarify stay activator-scoped.
 */

import type { Router, Request, Response } from 'express';
import {
  isApprovalStep,
  PIPELINE_GATE_NOTE_MAX_CHARS,
  UNIVERSAL_FEATURE,
  validatePipelineActivation,
  type PipelineActivation,
} from '@ant/shared';
import { sendErrorResponse } from '../helpers/errorResponse';
import { approverUnion, syncApproverIndexForActivation } from '../../../../../core/pipelines/approverIndex';
import { resolveDefRoot } from '../../../../../core/pipelines/scopeRoots';
import {
  loadActivationByProject,
  loadPipeline,
  saveActivationRecord,
  PipelineValidationError,
} from '../../../../../core/pipelines/store';
import { isSingleSegment, reject400, ownerOf, type PipelinesRouteContext } from './context';

/** Empty rosters normalize away — an empty array means "activator only" exactly like absence. */
function normalizeApprovers(raw: Record<string, string[]> | undefined): Record<string, string[]> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string[]> = {};
  for (const [stepId, list] of Object.entries(raw)) {
    if (Array.isArray(list) && list.length > 0) out[stepId] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function registerApprovalRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, ctxOf, actRootOf } = ctx;

  // ── Approvals (inbox — own activations + gates the caller approves) ───
  router.get('/approvals', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const [own, asApprover] = await Promise.all([
        deps.coordinator.listPendingApprovals(owner),
        deps.coordinator.listApproverPendingApprovals(owner),
      ]);
      res.json({ approvals: [...own, ...asApprover] });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprovals');
    }
  });

  router.post('/approvals/:gateId', async (req: Request, res: Response) => {
    try {
      const caller = ownerOf(req);
      const decision = req.body?.decision;
      if (decision !== 'approve' && decision !== 'reject') {
        res.status(400).json({ error: 'decision must be "approve" or "reject"' });
        return;
      }
      const note = req.body?.note;
      if (note !== undefined && typeof note !== 'string') {
        res.status(400).json({ error: 'note must be a string' });
        return;
      }
      if (typeof note === 'string' && note.length > PIPELINE_GATE_NOTE_MAX_CHARS) {
        res.status(400).json({ error: `note must be at most ${PIPELINE_GATE_NOTE_MAX_CHARS} characters` });
        return;
      }
      const hitl = await deps.coordinator.getHitlByGateId(req.params.gateId);
      const isOwner =
        !!hitl && hitl.owner.userId === caller.userId && hitl.owner.organizationId === caller.organizationId;
      let isApprover = false;
      if (hitl && !isOwner && hitl.kind !== 'tool' && hitl.owner.organizationId === caller.organizationId) {
        // Live re-read of the owner's roster — the ONLY approver authority.
        try {
          const activation = loadActivationByProject(actRootOf(hitl.owner), hitl.projectId);
          isApprover = (activation?.approvers?.[hitl.stepId] ?? []).includes(caller.userId);
        } catch {
          isApprover = false;
        }
        // A removed org member's standing rosters go dead immediately (S6):
        // re-check the LIVE membership row. Fail-OPEN on a repo error (the
        // checkApproval posture — an infra blip must not silently 404).
        if (isApprover) {
          try {
            const membership = await deps.organizationRepository.getMembership(caller.userId, caller.organizationId);
            if (!membership) isApprover = false;
          } catch {
            /* fail-open */
          }
        }
      }
      if (!hitl || (!isOwner && !isApprover)) {
        res.status(404).json({ error: 'gate not found', gateId: req.params.gateId });
        return;
      }
      if (!deps.chatService) {
        res.status(503).json({ error: 'Chat service not available' });
        return;
      }
      // The card lives in the RUN's project (the route is cross-project).
      const run = await deps.coordinator.getRun(hitl.runId);
      if (!run) {
        res.status(404).json({ error: 'run not found for gate', gateId: req.params.gateId });
        return;
      }
      // Single funnel: same NX-guarded resolve as a chat-card click. The chat
      // path context is the RUN OWNER's (the card lives in their project);
      // the decider is recorded separately on the gate (`decidedBy`).
      const approvedLabel = isOwner ? 'Approved' : `Approved by ${caller.userId}`;
      const rejectedLabel = isOwner ? 'Rejected' : `Rejected by ${caller.userId}`;
      const result = await deps.chatService.appendChoiceResolved(run.projectId, UNIVERSAL_FEATURE, {
        jobId: hitl.anchorJobId,
        cardId: hitl.cardId,
        choiceSelected: decision,
        resolvedLabel: decision === 'approve' ? approvedLabel : rejectedLabel,
        userContext: hitl.owner,
      });
      if (!result.resolved) {
        // S7 — the losing side of a race learns who won.
        const lost = await deps.coordinator.getRun(hitl.runId);
        const decidedBy = lost?.steps.find((s) => s.stepId === hitl.stepId)?.gate?.decidedBy;
        res.status(409).json({ error: 'gate already resolved', gateId: req.params.gateId, ...(decidedBy && { decidedBy }) });
        return;
      }
      await deps.coordinator.applyResolvedGate(
        hitl.cardId,
        decision === 'approve' ? 'approved' : 'rejected',
        caller.userId,
        'api',
        typeof note === 'string' && note.trim() ? { note } : {},
      );
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprove');
    }
  });

  // ── Approver roster edit (activator-only; live from the next resolve on) ──
  router.put('/activations/:projectId/approvers', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const projectId = req.params.projectId;
      if (!isSingleSegment(projectId)) return void reject400(res, 'projectId');
      const rawMap = req.body?.approvers;
      if (rawMap === undefined || rawMap === null || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
        res.status(400).json({ error: 'approvers must be a map of { <gateStepId>: [memberId, …] }' });
        return;
      }
      let activation: PipelineActivation | null = null;
      try {
        activation = loadActivationByProject(actRootOf(owner), projectId);
      } catch {
        res.status(409).json({ error: `Project "${projectId}" has an unreadable activation record`, code: 'invalid-pipeline-activation' });
        return;
      }
      if (!activation) {
        res.status(404).json({ error: `No activation on project "${projectId}"`, code: 'not-activated' });
        return;
      }
      const approvers = normalizeApprovers(rawMap as Record<string, string[]>);
      if (approvers && owner.organizationKind !== 'team') {
        res.status(400).json({ error: 'Gate approvers need a team organization', code: 'approvers-require-team-org' });
        return;
      }
      // The activation's def is frozen while it exists — its gate-id set is
      // the validation universe for the map's keys.
      let gateStepIds: string[];
      try {
        const def = loadPipeline(resolveDefRoot(ctxOf(owner), activation.pipelineScope), activation.pipelineId);
        gateStepIds = def.steps.filter(isApprovalStep).map((s) => s.id);
      } catch (e) {
        res.status(409).json({
          error: `Pipeline "${activation.pipelineId}" no longer resolves: ${e instanceof Error ? e.message : String(e)}`,
          code: 'invalid-pipeline-def',
        });
        return;
      }
      const next: PipelineActivation = { ...activation, ...(approvers ? { approvers } : {}) };
      if (!approvers) delete next.approvers;
      const errors = validatePipelineActivation(next, { gateStepIds });
      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors, code: 'invalid-approvers' });
        return;
      }
      // Every listed member must be a LIVE member of the activator's org.
      const union = approverUnion(next);
      if (owner.organizationKind === 'team' && union.length > 0) {
        const dead: string[] = [];
        for (const userId of union) {
          const membership = await deps.organizationRepository.getMembership(userId, owner.organizationId);
          if (!membership) dead.push(userId);
        }
        if (dead.length > 0) {
          res.status(400).json({
            error: `Not a member of this organization: ${dead.join(', ')}`,
            code: 'approver-not-member',
            invalidApprovers: dead,
          });
          return;
        }
      }
      const prevUnion = approverUnion(activation);
      await saveActivationRecord(actRootOf(owner), next);
      await syncApproverIndexForActivation(
        deps.stateStore,
        owner.organizationId,
        owner.userId,
        projectId,
        prevUnion,
        union,
      );
      // S9 — a currently-armed gate re-fires its request notice to the new roster.
      await deps.coordinator.republishArmedGates(owner, projectId);
      res.json({ projectId, approvers: next.approvers ?? {} });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-activation' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesApprovers');
    }
  });
}
