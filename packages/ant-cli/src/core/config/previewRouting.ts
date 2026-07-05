/**
 * Preview/Deploy routing mode — SSOT (Phase 2, D-subdomain).
 *
 * ANT multiplexes every preview/deploy app on ONE host. Two strategies:
 *
 *   'path'      (default) — identifier is a URL PATH prefix:
 *                 preview `https://<host>/{urlKey}/...`
 *                 deploy  `https://<host>/deploy/{urlKey}/...`
 *               The app runs under a framework basePath equal to that prefix.
 *
 *   'subdomain' — identifier moves into the HOSTNAME (a DNS label):
 *                 `https://{label}.<baseDomain>/...` served at ROOT, no basePath.
 *               Eliminates the whole class of "root-absolute asset loses the
 *               path prefix" bugs (e.g. next/image `unoptimized` emitting
 *               `/images/x` with no basePath) because there is no prefix to
 *               lose — the host identifies the app.
 *
 * `subdomain` REQUIRES infra that is provisioned OUTSIDE this codebase:
 *   - wildcard DNS `*.<baseDomain>` → the preview host
 *   - wildcard TLS certificate for `*.<baseDomain>`
 * Because subdomain routing is physically impossible without that infra, the
 * mode is NOT a separate manual toggle — it is driven by a SINGLE signal:
 * whether a base domain is configured. Setting `ANT_PREVIEW_BASE_DOMAIN` means
 * "the wildcard infra exists, use subdomains"; leaving it unset (local dev, or
 * a not-yet-provisioned env) automatically falls back to `path`. One env var,
 * self-evident — no redundant on/off flag to keep in sync.
 *
 * This is a host-environment capability signal (like K8s-vs-Docker), NOT a
 * local/cloud business-logic fork — both modes share the same distributed data
 * plane.
 *
 * SSOT: never read `process.env.ANT_PREVIEW_BASE_DOMAIN` / `ANT_DEPLOY_BASE_DOMAIN`
 * anywhere else — go through these helpers.
 */

export type PreviewRoutingMode = 'path' | 'subdomain';

/**
 * Subdomain routing is active iff a base domain is configured (its presence is
 * the switch — see the module comment). No separate `ANT_PREVIEW_ROUTING` flag.
 */
export function isSubdomainRouting(): boolean {
  return getPreviewBaseDomain() !== undefined;
}

export function getPreviewRoutingMode(): PreviewRoutingMode {
  return isSubdomainRouting() ? 'subdomain' : 'path';
}

/**
 * The base domain under which per-app subdomains live (e.g.
 * `ant-preview.cross.nexus` → `{label}.ant-preview.cross.nexus`). When set,
 * subdomain routing is active; when unset, routing falls back to `path`.
 */
export function getPreviewBaseDomain(): string | undefined {
  const v = process.env.ANT_PREVIEW_BASE_DOMAIN;
  return v && v.trim() ? v.trim().toLowerCase() : undefined;
}

/**
 * Base domain for DEPLOY subdomains — distinct from the preview base so a
 * feature that has BOTH a preview and a deploy (same urlKey → same label) is
 * disambiguated at the host level. Defaults to the preview base with a
 * `deploy.` prefix when not explicitly set.
 */
export function getDeployBaseDomain(): string | undefined {
  const v = process.env.ANT_DEPLOY_BASE_DOMAIN;
  if (v && v.trim()) return v.trim().toLowerCase();
  const preview = getPreviewBaseDomain();
  return preview ? `deploy.${preview}` : undefined;
}
