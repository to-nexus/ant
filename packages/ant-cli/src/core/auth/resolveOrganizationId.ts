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

/**
 * Resolve the `organizationId` for a user joining/creating an org.
 *
 * @param email Authenticated user's email (used for domain classification + fallback id)
 * @param userInput Optional user-provided org name (post-onboarding input)
 * @param userId Optional stable userId — preferred over email in the
 *   consumer `personal-${...}` fallback because email rotation can occur
 *   but the OAuth `sub` is durable.
 */
export function resolveOrganizationId(
  email: string,
  userInput?: string,
  userId?: string,
): string {
  if (userInput && userInput.trim()) {
    return slugify(userInput);
  }

  const domain = email.split('@')[1]?.toLowerCase() ?? '';

  if (isConsumerDomain(domain)) {
    // Per-user tenant — never share across consumer-email users.
    // userId is preferred (durable); email is the fallback when only the
    // email is available at the call site.
    const seed = userId ?? email;
    return slugify(`personal-${seed}`);
  }

  return domain;
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
