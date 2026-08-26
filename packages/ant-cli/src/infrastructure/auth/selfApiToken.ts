/**
 * `self-api` token minter — the credential a universal job uses to call this
 * Ant server's own account-agents API (`apis` self entry).
 *
 * Minted HERE, in the process that holds the ES256 private key, and never in a
 * worker or a job child: signing authority stays with ant-api (C-001), and the
 * child receives one already-signed, capability-pinned token.
 *
 * The pin lives server-side in `selfApiScopeGuard` — this module only stamps
 * the claim. Local mode mints nothing: there is no auth gate to satisfy.
 */

import type { OrganizationKind } from '@ant/shared';
import { createJwtServiceFromEnv, type JwtService } from './JwtService';
import { logger } from '../../utils/logger';

/**
 * Lifetime. Long enough to outlive a job that spends its turns waiting on a
 * model, short enough that a token recovered from a queue payload after the
 * fact is dead. Not renewable — a pinned token cannot reach the auth routes.
 */
export const SELF_API_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export interface SelfApiTokenOwner {
  userId: string;
  organizationId: string;
  organizationKind?: OrganizationKind;
}

export type SelfApiTokenMinter = (owner: SelfApiTokenOwner) => string | undefined;

export function mintSelfApiToken(jwtService: JwtService, owner: SelfApiTokenOwner): string {
  return jwtService.sign(
    {
      sub: owner.userId,
      email: `${owner.userId}@${owner.organizationId}`,
      org: owner.organizationId,
      ...(owner.organizationKind ? { kind: owner.organizationKind } : {}),
      scope: 'self-api',
    },
    SELF_API_TOKEN_TTL_SECONDS,
  );
}

/**
 * Minter for this process, or undefined when it cannot sign — local mode (no
 * JWT service at all) and any process that holds only the public key. A job
 * that needed a token and did not get one fails loud at connect time rather
 * than silently 401-ing mid-turn (`resolveSelfApiConfig`).
 */
export function createSelfApiTokenMinter(): SelfApiTokenMinter | undefined {
  const jwtService = createJwtServiceFromEnv();
  if (!jwtService?.canSign) return undefined;
  return (owner) => {
    try {
      return mintSelfApiToken(jwtService, owner);
    } catch (e) {
      logger.error(`[SelfApiToken] mint failed for ${owner.organizationId}/${owner.userId}`, { component: 'SelfApiToken' }, e as Error);
      return undefined;
    }
  };
}
