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

/**
 * Ceiling on a single user directive, applied at EVERY HTTP ingress that reaches
 * the durable turn writer below.
 *
 * `ensureSubmitUserTurn` appends the directive to `chat.jsonl` (and the worker
 * copies it into `feature.jsonl`) before the job-start gates run, and the
 * continue path additionally unshifts it into canonical session state that is
 * re-read on every subsequent turn. An uncapped field therefore rides the 50 MiB
 * authenticated JSON body straight into files that timers, jobs and the UI then
 * read back (M-NEW-029). One owner so a new ingress cannot pick a different
 * number — or none at all, which is how `/execute` and `/inline-ask` were missed.
 */
export const DIRECTIVE_MAX_CHARS = 100_000;

/**
 * 413 body for an over-cap directive, or null when it fits. Callers MUST answer
 * with this BEFORE calling `ensureSubmitUserTurn` — the durable append is what
 * is being budgeted, so a check after it protects nothing.
 */
export function directiveTooLarge(
  directive: unknown,
  field: string,
): { error: string; code: 'DIRECTIVE_TOO_LARGE'; message: string } | null {
  if (typeof directive !== 'string' || directive.length <= DIRECTIVE_MAX_CHARS) return null;
  return {
    error: 'Directive too large',
    code: 'DIRECTIVE_TOO_LARGE',
    message: `${field} exceeds ${DIRECTIVE_MAX_CHARS} characters`,
  };
}

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
