/**
 * Consumer Email Domain SSOT
 *
 * Single source of truth for "consumer" (personal) email domains. Used by
 * `resolveOrganizationId` and `suggestOrganizationName` to distinguish
 * personal accounts (gmail, naver, …) — which must NEVER collapse into a
 * shared organization — from business accounts where the domain itself
 * is a reasonable default organization id.
 *
 * Do NOT duplicate this list. Other modules MUST import `isConsumerDomain`
 * rather than re-derive the classification.
 */

export const CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Global webmail
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'aol.com', 'gmx.com', 'mail.com',
  // Korea
  'naver.com', 'hanmail.net', 'daum.net', 'kakao.com', 'nate.com',
]);

export function isConsumerDomain(domain: string): boolean {
  return CONSUMER_EMAIL_DOMAINS.has(domain.toLowerCase());
}
