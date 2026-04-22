/**
 * SessionPersistence — chat.jsonl / feature.jsonl write + collapse helpers
 *
 * Session redesign §16.2 (revised by the "chat SSOT fragmentation purge"):
 * chat.json is retired. The Chat API layer now treats `chat.jsonl`
 * (+ `feature.jsonl`) as the SSOT and only keeps a transient in-memory /
 * Redis scratchpad for live streaming.
 *
 * This class is the single place that constructs a {@link FileSessionAdapter}
 * from WorkspaceResolver, so the rest of the ChatService modules don't need
 * to know about feature paths.
 */

import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../../core/types/user';
import type {
  LogJobType,
  ChatAssistantMessageLine,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
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
   * Emit an assistant_message line to chat.jsonl. Fire-and-forget: never
   * throws, never blocks the caller.
   */
  async emitAssistantMessageLine(params: {
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
    const line: ChatAssistantMessageLine = {
      type: 'assistant_message',
      ts: new Date().toISOString(),
      jobId: params.jobId,
      turnId,
      jobType: params.jobType ?? 'code',
      text: params.text,
    };
    try {
      await adapter.appendLine('chat', line);
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
    const line: ChatChoicePresentedLine = {
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
      await adapter.appendLine('chat', line);
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
    const line: ChatChoiceResolvedLine = {
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
      await adapter.appendLine('chat', line);
    } catch (err) {
      logger.warn(
        `[SessionPersistence] appendLine(choice_resolved) failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence' },
      );
    }
  }

  /**
   * Collapse chat.jsonl only — Chat Clear / Sweep.
   *
   * `feature.jsonl` is intentionally preserved so the LLM retains
   * conversation context across a chat clear. The UI chat view, which
   * renders from chat.jsonl, will appear empty.
   *
   * Hard Reset does NOT go through here — it physically unlinks the
   * session files via `clearCanonicalDirectory` in the
   * `/context/reset` route handler instead.
   */
  async collapseChatLogOnly(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<void> {
    const adapter = this.makeAdapter(projectId, featureName, userContext);
    if (!adapter) return;
    try {
      await adapter.collapseChatLog();
    } catch (err) {
      logger.warn(
        `[SessionPersistence] collapseChatLogOnly failed: ${(err as Error)?.message ?? err}`,
        { component: 'SessionPersistence', projectId, featureName },
      );
    }
  }
}
