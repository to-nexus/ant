/**
 * SessionPersistence — trace.jsonl / feature.jsonl write + collapse helpers
 *
 * Session redesign §16.2: chat.json is retired. The Chat API layer now
 * treats `trace.jsonl` (+ `feature.jsonl`) as the SSOT and only keeps a
 * transient in-memory / Redis scratchpad for live streaming.
 *
 * This class is the single place that constructs a {@link FileSessionAdapter}
 * from WorkspaceResolver, so the rest of the ChatService modules don't need
 * to know about feature paths.
 */

import * as crypto from 'crypto';
import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../../core/types/user';
import type {
  LogJobType,
  TraceAssistantMessageLine,
  TraceChoicePresentedLine,
  TraceChoiceResolvedLine,
  FeatureBoundaryLine,
} from '@ant/shared';
import { logger } from '../../../../../utils/logger';
import { FileSessionAdapter } from '../../../session/FileSessionAdapter';

export class SessionPersistence {
  constructor(private workspaceResolver?: WorkspaceResolver) {}

  /**
   * Resolve the absolute feature path. Returns `null` when the resolver
   * is missing or the lookup fails (e.g. unknown project/feature).
   */
  getFeaturePath(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): string | null {
    if (!this.workspaceResolver || !userContext) return null;
    try {
      return this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    } catch {
      return null;
    }
  }

  private makeAdapter(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): FileSessionAdapter | null {
    const featurePath = this.getFeaturePath(projectId, featureName, userContext);
    if (!featurePath) return null;
    return new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
  }

  /**
   * Look up the turnId associated with a jobId by scanning the post-boundary
   * user_turn lines in feature.jsonl. Returns `null` when no match exists
   * (the job predated session redesign or the turn was collapsed).
   */
  async findTurnIdForJob(
    projectId: string,
    featureName: string,
    jobId: string,
    userContext?: UserContext,
  ): Promise<string | null> {
    const adapter = this.makeAdapter(projectId, featureName, userContext);
    if (!adapter) return null;
    try {
      const { userTurns } = await adapter.loadSinceBoundary();
      for (let i = userTurns.length - 1; i >= 0; i--) {
        if (userTurns[i].jobId === jobId) return userTurns[i].turnId;
      }
    } catch (err) {
      logger.warn(
        `[SessionPersistence] findTurnIdForJob failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence', projectId, featureName },
      );
    }
    return null;
  }

  /**
   * Emit an assistant_message line to trace.jsonl. Fire-and-forget: never
   * throws, never blocks the caller.
   */
  async emitAssistantMessageTrace(params: {
    projectId: string;
    featureName: string;
    userContext?: UserContext;
    jobId: string;
    turnId?: string | null;
    jobType?: LogJobType;
    text: string;
  }): Promise<void> {
    if (!params.text) return;
    const adapter = this.makeAdapter(params.projectId, params.featureName, params.userContext);
    if (!adapter) return;
    const turnId =
      params.turnId ??
      (await this.findTurnIdForJob(
        params.projectId,
        params.featureName,
        params.jobId,
        params.userContext,
      ));
    if (!turnId) return;
    const line: TraceAssistantMessageLine = {
      type: 'assistant_message',
      ts: new Date().toISOString(),
      jobId: params.jobId,
      turnId,
      jobType: params.jobType ?? 'code',
      text: params.text,
    };
    try {
      await adapter.appendLine('trace', line);
    } catch (err) {
      logger.warn(
        `[SessionPersistence] appendLine(assistant_message) failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence' },
      );
    }
  }

  /**
   * Emit a choice_presented line. `cardId` is the stable handle the UI
   * (and future `choice_resolved` lines) use to reference this card.
   */
  async emitChoicePresented(params: {
    projectId: string;
    featureName: string;
    userContext?: UserContext;
    jobId: string;
    turnId?: string | null;
    jobType?: LogJobType;
    cardId: string;
    cardType: string;
    prompt?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const adapter = this.makeAdapter(params.projectId, params.featureName, params.userContext);
    if (!adapter) return;
    const turnId =
      params.turnId ??
      (await this.findTurnIdForJob(
        params.projectId,
        params.featureName,
        params.jobId,
        params.userContext,
      ));
    if (!turnId) return;
    const line: TraceChoicePresentedLine = {
      type: 'choice_presented',
      ts: new Date().toISOString(),
      jobId: params.jobId,
      turnId,
      jobType: params.jobType ?? 'code',
      cardId: params.cardId,
      cardType: params.cardType,
      prompt: params.prompt,
      payload: params.payload,
    };
    try {
      await adapter.appendLine('trace', line);
    } catch (err) {
      logger.warn(
        `[SessionPersistence] appendLine(choice_presented) failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence' },
      );
    }
  }

  /**
   * Emit a choice_resolved line — the user answered a previously-presented
   * card. Readers pair this with the earlier `choice_presented` by `cardId`
   * to overlay the resolved label / answer.
   */
  async emitChoiceResolved(params: {
    projectId: string;
    featureName: string;
    userContext?: UserContext;
    jobId: string;
    turnId?: string | null;
    jobType?: LogJobType;
    cardId: string;
    choiceSelected: string;
    resolvedLabel: string;
    answer?: Record<string, unknown>;
  }): Promise<void> {
    const adapter = this.makeAdapter(params.projectId, params.featureName, params.userContext);
    if (!adapter) return;
    const turnId =
      params.turnId ??
      (await this.findTurnIdForJob(
        params.projectId,
        params.featureName,
        params.jobId,
        params.userContext,
      ));
    if (!turnId) return;
    const line: TraceChoiceResolvedLine = {
      type: 'choice_resolved',
      ts: new Date().toISOString(),
      jobId: params.jobId,
      turnId,
      jobType: params.jobType ?? 'code',
      cardId: params.cardId,
      choiceSelected: params.choiceSelected,
      resolvedLabel: params.resolvedLabel,
      answer: params.answer,
    };
    try {
      await adapter.appendLine('trace', line);
    } catch (err) {
      logger.warn(
        `[SessionPersistence] appendLine(choice_resolved) failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence' },
      );
    }
  }

  /**
   * Collapse the entire session log (trace.jsonl + feature.jsonl) + append a
   * `user_reset` boundary. Used by `clearMessages` and by §17 hard_reset.
   */
  async collapseSessionLogs(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<void> {
    const adapter = this.makeAdapter(projectId, featureName, userContext);
    if (!adapter) return;
    const jobId = `ui-reset-${Date.now()}`;
    const turnId = `t-reset-${crypto.randomBytes(4).toString('hex')}`;
    const reason: FeatureBoundaryLine['reason'] = 'user_reset';
    try {
      await adapter.collapseAll(reason, jobId, turnId);
    } catch (err) {
      logger.warn(
        `[SessionPersistence] collapseSessionLogs failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence', projectId, featureName },
      );
    }
  }
}
