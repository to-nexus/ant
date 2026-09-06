/**
 * Run surface — detail read (Redis projection with disk fallback), cancel,
 * and the clarify-answer API channel.
 */

import type { Router, Request, Response } from 'express';
import { sendErrorResponse } from '../helpers/errorResponse';
import { directiveTooLarge } from '../helpers/submitUserTurn';
import { hasRunLog } from '../../../../../core/pipelines/store';
import { isSingleSegment, reject400 } from './context';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerRunRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, actRootOf } = ctx;

  // ── Run detail / cancel (before /:pipelineId so "runs" never matches an id) ──
  router.get('/runs/:runId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!isSingleSegment(req.params.runId)) return void reject400(res, 'runId');
      let run = await deps.coordinator.getRun(req.params.runId);
      if (!run) {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
        if (projectId !== undefined && !isSingleSegment(projectId)) return void reject400(res, 'projectId');
        if (projectId) run = deps.coordinator.readRunFromDisk(owner, projectId, req.params.runId);
      }
      // Own runs only: the caller's own activation dir must hold the run log
      // (the coordinator writes it there on fire) — members' rows are summaries.
      if (run && !hasRunLog(actRootOf(owner), run.projectId, run.runId)) run = null;
      if (!run) {
        res.status(404).json({ error: 'run not found', runId: req.params.runId });
        return;
      }
      const { defSnapshot: _snapshot, ...publicRun } = run;
      res.json({ run: publicRun });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRunDetail');
    }
  });

  router.post('/runs/:runId/cancel', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!isSingleSegment(req.params.runId)) return void reject400(res, 'runId');
      const run = await deps.coordinator.getRun(req.params.runId);
      // Own runs only — same structural check as the detail read.
      if (!run || !hasRunLog(actRootOf(owner), run.projectId, run.runId)) {
        res.status(404).json({ error: 'run not found or already terminal', runId: req.params.runId });
        return;
      }
      const ok = await deps.coordinator.cancelRun(owner, req.params.runId);
      if (!ok) {
        res.status(404).json({ error: 'run not found or already terminal', runId: req.params.runId });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRunCancel');
    }
  });

  // ── Clarify answer (inbox/API channel; the chat clarify card is the other) ──
  // Deliberately NOT funneled through appendChoiceResolved: the chat card is
  // child-minted and its cardId is not discoverable here — the coordinator's
  // status guard is the double-submit authority, so an API answer leaves the
  // card visually open but inert (a later click no-ops).
  router.post('/runs/:runId/steps/:stepId/clarify', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!isSingleSegment(req.params.runId)) return void reject400(res, 'runId');
      const answer = req.body?.answer;
      if (typeof answer !== 'string' || !answer.trim()) {
        res.status(400).json({ error: 'answer must be a non-empty string' });
        return;
      }
      // The answer becomes the resume directive verbatim (the stored audit copy
      // is truncated, the dispatched one is not), so it carries the same ceiling
      // as every other directive ingress (M-NEW-029).
      const answerTooLarge = directiveTooLarge(answer, 'answer');
      if (answerTooLarge) {
        res.status(413).json(answerTooLarge);
        return;
      }
      const run = await deps.coordinator.getRun(req.params.runId);
      // Own runs only — same structural check as the detail read.
      if (!run || !hasRunLog(actRootOf(owner), run.projectId, run.runId)) {
        res.status(404).json({ error: 'run not found', runId: req.params.runId });
        return;
      }
      const step = run.steps.find((s) => s.stepId === req.params.stepId);
      if (!step || step.status !== 'awaiting_clarify' || !step.clarify) {
        res.status(409).json({ error: 'clarify-already-resolved', stepId: req.params.stepId });
        return;
      }
      const ok = await deps.coordinator.applyClarifyAnswer({
        jobId: step.clarify.jobId,
        answer,
        answeredBy: owner.userId,
        via: 'api',
      });
      if (!ok) {
        res.status(409).json({ error: 'clarify-already-resolved', stepId: req.params.stepId });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesClarify');
    }
  });
}
