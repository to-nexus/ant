/**
 * Agent-definition change broadcast — the `_agents` twin of
 * `publishPipelineEvent(owner, { cause: 'defChanged' })`.
 *
 * One router-level hook per definitions router, keyed on the SET of mutating
 * requests (any non-GET that finished 2xx) rather than on a list of routes
 * someone remembered: a route added later is covered by construction. The
 * event is a refresh hint on the owner's user channel — best-effort, never
 * blocks or fails the write.
 */

import type { Request, Response, NextFunction, Router } from 'express';
import { isValidCustomId, type AgentDefinitionEventData } from '@ant/shared';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';
import { getRealtimeBroadcastChannel } from '../../../../../core/constants/redis';
import { extractUserContext } from './userContext';
import { logger } from '../../../../../utils/logger';

export interface AgentDefinitionBroadcastDeps {
  stateStore?: Pick<StateStorePort, 'publish'>;
  /**
   * Which requests are definition writes, and which agent they address.
   * Return null for a request this router serves that is NOT a definition
   * write (the project-scoped router also carries artifact endpoints).
   * `agentId: null` = a write that addresses no single agent (folder import).
   */
  match: (req: Request) => { agentId: string | null } | null;
  ownerOf?: (req: Request) => UserContext;
}

/** Path segment → agent id when it is one; reserved literals and blanks are not. */
export function agentIdFromSegment(segment: string | undefined, reserved: ReadonlySet<string>): string | null {
  if (!segment || reserved.has(segment) || !isValidCustomId(segment)) return null;
  return segment;
}

/**
 * The agent a definition write addresses: the path segment when the route
 * carries one, else the body's `id` (a create names the new agent there).
 * Null when neither does (folder import).
 */
export function agentIdOfWrite(req: Request, segment: string | undefined, reserved: ReadonlySet<string>): string | null {
  const fromPath = agentIdFromSegment(segment, reserved);
  if (fromPath) return fromPath;
  const bodyId = (req.body as { id?: unknown } | undefined)?.id;
  return agentIdFromSegment(typeof bodyId === 'string' ? bodyId : undefined, reserved);
}

export function attachAgentDefinitionChangeBroadcast(router: Router, deps: AgentDefinitionBroadcastDeps): void {
  const ownerOf = deps.ownerOf ?? extractUserContext;
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const matched = deps.match(req);
    if (!matched) return next();
    res.on('finish', () => {
      if (res.statusCode >= 300) return;
      void publishAgentDefinitionChanged(deps.stateStore, ownerOf(req), matched.agentId);
    });
    next();
  });
}

export async function publishAgentDefinitionChanged(
  stateStore: Pick<StateStorePort, 'publish'> | undefined,
  owner: UserContext,
  agentId: string | null,
): Promise<void> {
  if (!stateStore || !owner?.organizationId || !owner?.userId) return;
  const data: AgentDefinitionEventData = { cause: 'defChanged', agentId };
  try {
    await stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
      type: 'agentDefinition',
      data,
      userContext: { userId: owner.userId, organizationId: owner.organizationId },
    });
  } catch (err) {
    logger.warn(`agentDefinition defChanged publish failed (${agentId ?? 'import'})`, { component: 'AccountAgents' }, err);
  }
}
