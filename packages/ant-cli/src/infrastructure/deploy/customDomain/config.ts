/**
 * Custom-domain infrastructure config (SSOT).
 *
 * These describe the platform-side DNS targets the user points their domain at.
 * They are provisioned by the infra team (NLB + Caddy layer) and surfaced to
 * the user as DNS setup instructions. Never read these env vars elsewhere — go
 * through these helpers.
 */

/**
 * Whether custom domains are operable in this environment. Requires subdomain
 * routing (deploy base domain) AND a configured CNAME target (the NLB/Caddy
 * entry point). Unset target → the NLB+Caddy layer is not provisioned, so the
 * feature is unavailable and registration should be refused.
 */
export function isCustomDomainEnabled(): boolean {
  return getCustomDomainCnameTarget() !== undefined;
}

/**
 * Stable CNAME target users point a SUBDOMAIN at (e.g. `ant-domains.your-domain.tld`),
 * resolving to the NLB in front of Caddy. `undefined` when not provisioned.
 */
export function getCustomDomainCnameTarget(): string | undefined {
  const v = process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET;
  return v && v.trim() ? v.trim().toLowerCase() : undefined;
}

/**
 * NLB elastic IPs users point an APEX (root) domain A-record at. Comma-separated
 * in `ANT_CUSTOM_DOMAIN_APEX_IPS`. Empty when apex support is not provisioned.
 */
export function getCustomDomainApexIps(): string[] {
  const v = process.env.ANT_CUSTOM_DOMAIN_APEX_IPS;
  if (!v || !v.trim()) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
