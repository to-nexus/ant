/**
 * submitUserTurn — single owner of the *submit-time* `user_turn` line.
 *
 * `ChatService.appendUserTurn` is the only writer that both persists the UI
 * copy to chat.jsonl AND broadcasts `chat_event_appended`. The worker's
 * `recordUserTurn` writes the same line to disk but has no broadcaster, so a
 * job started without passing through this helper produces every assistant
 * line live while the user bubble only materialises on the next SSE reconnect
 * (the API-started-job defect).
 *
 * Every HTTP entry point that accepts a NEW user directive routes through
 * here. `seedTurnId` present ⇒ some earlier call (`/chat/user-message`)
 * already owns the turn, so we hand the id straight back; the worker-side
 * copy dedupes by turnId in `FileSessionAdapter.appendUserTurn`.
 */

import type { ChatService } from '../../services';
import type { ActionMetadata, LogJobType } from '@ant/shared';
import { generateTurnId } from '../../../../../composition/recordUserTurn';

export interface SubmitUserTurnArgs {
  chatService?: ChatService;
  /** Used to resolve featurePath/projectPath for metadata enrichment + the universal probe. */
  workspaceResolver?: any;
  projectId: string;
  featureName: string;
  /** The user's directive. Absent (file-driven job) ⇒ no turn is minted. */
  directive?: string;
  /** Already-owned turn id (from `/chat/user-message`). Short-circuits. */
  seedTurnId?: string;
  userContext: { userId: string; organizationId: string };
  actionMetadata?: ActionMetadata;
  /**
   * Permanent jobType stamp for the chat line. When omitted the universal
   * container is probed (A15 — the stamp is never corrected later).
   */
  jobType?: LogJobType;
}

/**
 * Mint + durably record + broadcast the user's turn, unless it is already
 * owned. Returns the turn id to forward as the job's `seedTurnId`, or
 * `undefined` when there is nothing to record.
 */
export async function ensureSubmitUserTurn(args: SubmitUserTurnArgs): Promise<string | undefined> {
  const { chatService, workspaceResolver, projectId, featureName, directive, seedTurnId, userContext, actionMetadata } = args;

  if (seedTurnId) return seedTurnId;
  if (!chatService || !directive) return undefined;

  const turnId = generateTurnId();

  // Fold full-folder selections into a single `📂` badge before the SSE echo
  // so the user sees the same compressed view the durable line carries.
  // Best-effort; failures degrade to raw paths via the helper's own guards.
  let enrichedActionMetadata = actionMetadata;
  if (actionMetadata && workspaceResolver) {
    try {
      const featurePath: string = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const { AdapterFactory } = await import('../../../../../infrastructure/adapters/AdapterFactory');
      const { enrichActionMetadataWithFolders } = await import('../../../../../core/context/enrichActionMetadataWithFolders');
      const fs = AdapterFactory.createFileSystemAdapterWithPath(featurePath);
      enrichedActionMetadata = await enrichActionMetadataWithFolders(actionMetadata, fs);
    } catch (err) {
      console.warn('[submitUserTurn] foldersCompressed enrichment failed:', err);
    }
  }

  const jobType = args.jobType ?? (await probeUniversalJobType(workspaceResolver, userContext, projectId));

  await chatService.appendUserTurn(
    projectId,
    featureName,
    directive,
    turnId,
    undefined,
    userContext,
    enrichedActionMetadata,
    jobType,
  );

  return turnId;
}

/**
 * Universal projects file their turns under jobType 'universal' so
 * chat.jsonl's jobType filter stays honest. Partial resolvers (tests) and
 * lookup failures fall through to the ChatService default stamp.
 */
async function probeUniversalJobType(
  workspaceResolver: any,
  userContext: { userId: string; organizationId: string },
  projectId: string,
): Promise<LogJobType | undefined> {
  if (!workspaceResolver) return undefined;
  try {
    const { isUniversalProject } = await import('../../../../../core/customAgents/universalContainer');
    const projectPath: string = workspaceResolver.getProjectPath(userContext, projectId);
    return isUniversalProject(projectPath) ? 'universal' : undefined;
  } catch {
    return undefined;
  }
}
