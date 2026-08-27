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

/**
 * Shared secret Caddy sends on `/internal/tls-ask`, or `undefined`.
 *
 * REQUIRED in cloud whenever custom domains are enabled — `assertTlsAskSecretConfigured`
 * refuses to boot without it. `tls-ask` is reachable before authentication by
 * design (Caddy pauses a TLS handshake to ask it), and answering it starts a
 * deploy via `ensureRunning()`. NetworkPolicy is supposed to be the boundary,
 * but a NetworkPolicy is a deployment artifact this process cannot verify;
 * the secret is one it can (L-NEW-002).
 */
export function getTlsAskSecret(): string | undefined {
  const v = process.env.ANT_TLS_ASK_SECRET;
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Fail closed at boot rather than serving an unauthenticated deploy-wake endpoint.
 *
 * Scoped to deployments that actually enabled custom domains: one that never set
 * `ANT_CUSTOM_DOMAIN_CNAME_TARGET` has no `tls-ask` sink to protect and is not
 * asked for a new variable.
 */
export function assertTlsAskSecretConfigured(isCloud: boolean): void {
  if (!isCloud || !isCustomDomainEnabled()) return;
  if (getTlsAskSecret()) return;
  throw new Error(
    'ANT_TLS_ASK_SECRET is required when custom domains are enabled in cloud mode: ' +
    '/internal/tls-ask answers before authentication and starts a deploy, so it must ' +
    'not rely on NetworkPolicy alone. Set it here and on the Caddy side.',
  );
}
