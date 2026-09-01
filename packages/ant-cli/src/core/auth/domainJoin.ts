/**
 * Email-domain join — the single owner of "which org does this email host
 * grant?".
 *
 * Three call sites used to re-derive the answer from their own
 * `email.split('@')[1]` (the `/auth/me` join surface, the claim email
 * fast-path, and `join-by-domain`), which is exactly why the fourth — login —
 * was never added and domain membership was offered but never granted.
 *
 * The resolver answers with a REASON, not just a yes/no, because its callers
 * need different things from the same verdict: login grants silently, the
 * join surface offers, and `join-by-domain` has to turn each refusal into its
 * own HTTP status. A boolean would have forced the route to re-derive the
 * checks it wanted to distinguish — which is the duplication this module
 * exists to end.
 */

import type { OrganizationRepositoryPort } from '../ports/organizationRepository';
import type { Organization, OrgDomainClaim } from './types';

/** Lowercased host of an email address, or `''` when there is none. */
export function emailHost(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

export type DomainJoinRefusal =
  /** The address has no host at all. */
  | 'no-host'
  /** Nobody has claimed this host. */
  | 'no-claim'
  /** Claimed but not verified (pending DNS challenge, or rejected). */
  | 'unverified'
  /** The claimed org is gone, soft-deleted, or not a team. */
  | 'org-unavailable'
  /** Already in — the shortcut has nothing left to do. */
  | 'already-member'
  /** Left or was removed; the shortcut must not undo that. */
  | 'blocked';

export type DomainJoinResolution =
  | { ok: true; org: Organization; claim: OrgDomainClaim; domain: string }
  | { ok: false; reason: DomainJoinRefusal };

/**
 * Is the domain shortcut available to this account at all?
 *
 * `ok` only when every shared precondition holds: the email has a host, that
 * host carries a VERIFIED claim, the claimed org is a live team, the account
 * is not already a member, and the account carries no removal row for that
 * org (a removal must survive the member's next login — otherwise an admin's
 * removal is undone by the very shortcut that put them there).
 *
 * Callers layer their own condition on top of `ok`:
 *   - login auto-join additionally requires `grantsAtLogin(claim)`;
 *   - the `/auth/me` banner is the offer for claims whose auto-join is off;
 *   - `join-by-domain` needs no toggle — an explicit gesture outranks the
 *     org's default.
 */
export async function resolveDomainJoin(
  repo: OrganizationRepositoryPort,
  userId: string,
  email: string,
): Promise<DomainJoinResolution> {
  const domain = emailHost(email);
  if (!domain) return { ok: false, reason: 'no-host' };

  const claim = await repo.getDomainClaim(domain);
  if (!claim) return { ok: false, reason: 'no-claim' };
  if (claim.status !== 'verified') return { ok: false, reason: 'unverified' };

  const org = await repo.getOrganization(claim.organizationId);
  if (!org || org.deletedAt || (org.kind ?? 'team') !== 'team') {
    return { ok: false, reason: 'org-unavailable' };
  }

  if (await repo.getMembership(userId, org.id)) {
    return { ok: false, reason: 'already-member' };
  }
  if (await repo.getMemberRemoval(org.id, userId)) {
    return { ok: false, reason: 'blocked' };
  }

  return { ok: true, org, claim, domain };
}

/**
 * May a LOGIN alone grant this claim's membership?
 *
 * Opt-in, so `undefined` is off. It defaulted on once, and the result was a
 * team whose admin had claimed their own email host — instantly verified by
 * the fast path — silently absorbing every account on that domain at their
 * next login. From the member's side there was no gesture to make and no
 * button to find: they searched for the team and were already in it. Finding a
 * team must not be the same act as joining one, so the grant now waits for
 * either an explicit `join-by-domain` click or an admin turning this on.
 *
 * The predicate lives here because `resolveDomainJoin` is already the single
 * owner of "what does this email host grant"; a second reading of the toggle
 * at a call site is how the question splits in two.
 */
export function grantsAtLogin(claim: OrgDomainClaim): boolean {
  return claim.autoJoin === true;
}
