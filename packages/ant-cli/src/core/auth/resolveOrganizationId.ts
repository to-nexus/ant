/**
 * Organization Id Resolution
 *
 * Single decision function for "what `organizationId` does this user join?".
 * Replaces the legacy `email-domain == to.nexus` guard with a 3-branch rule:
 *
 *   1. Explicit user input — slugified, reserved names rejected (highest precedence)
 *   2. Consumer email (gmail, naver, …) — `personal-${userId|email}` (per-user tenant)
 *   3. Business email — the email domain itself (e.g. `acme.io`)
 *
 * Branch 2 is the critical correctness fix: returning the bare domain for
 * `gmail.com` would collapse every gmail user into a shared organization.
 *
 * Also exports `suggestOrganizationName` which the onboarding screen uses
 * to prefill the input — business emails get a sensible domain-based
 * suggestion, consumer emails get null (user must invent a name).
 */

import { isConsumerDomain } from './consumerDomains';
import { slugify } from './slugify';
import { INDIVIDUAL_ORG_ID, type OrganizationKind } from '@ant/shared';

export interface OrgIdentity {
  id: string;
  kind: OrganizationKind;
}

/**
 * Resolve the org identity (id + kind) for a cloud signup / join.
 *
 * The single signup path today: **everyone joins the shared `individual`
 * org**, regardless of personal vs business email. The previous
 * consumer/business split (`personal-${seed}` vs bare domain) is retired
 * from the signup path.
 *
 * The `userInput` branch is the DORMANT team seam: only the future team
 * join flow passes a `userInput`, yielding a `team` org. Signup never
 * passes it, so `team` is currently unreachable here.
 *
 * @param email Authenticated user's email.
 * @param userInput Optional user-provided org name — DORMANT team join only.
 * @param _userId Reserved (durable OAuth sub); unused in the individual path.
 */
export function resolveOrgIdentity(
  email: string,
  userInput?: string,
  _userId?: string,
): OrgIdentity {
  if (userInput && userInput.trim()) {
    return { id: slugify(userInput), kind: 'team' }; // DORMANT: team join flow only
  }
  return { id: INDIVIDUAL_ORG_ID, kind: 'individual' };
}

/**
 * Back-compat shim — returns only the org id. Prefer `resolveOrgIdentity`.
 */
export function resolveOrganizationId(
  email: string,
  userInput?: string,
  userId?: string,
): string {
  return resolveOrgIdentity(email, userInput, userId).id;
}

/**
 * Onboarding-screen prefill — returns a human-friendly default for the
 * organization name input.
 *
 * - Business email (`bob@acme.io` / `bob@sub.acme.io`) → `'acme'`
 *   (second-level domain — most informative for the user)
 * - Consumer email → `null` (no sensible default; the user must invent
 *   a name or skip onboarding)
 */
export function suggestOrganizationName(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain || isConsumerDomain(domain)) return null;

  const parts = domain.split('.');
  if (parts.length >= 2) return parts[parts.length - 2] ?? domain;
  return domain;
}
