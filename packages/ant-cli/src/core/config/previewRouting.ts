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

/** Minimal header view — the fields the shared-origin admission gate reads. */
type AdmissionHeaders = {
  authorization?: string | string[];
  cookie?: string | string[];
  'sec-fetch-site'?: string | string[];
};

function headerValue(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/**
 * A caller is NON-AMBIENT iff it presents a bearer token and NO cookie. A bearer
 * is not attached automatically by the browser to a cross-document request, so
 * it proves the caller intended THIS request; an ambient cookie does not.
 */
function isNonAmbientCaller(headers: AdmissionHeaders): boolean {
  const auth = headerValue(headers.authorization);
  const hasBearer = /^bearer\s+\S/i.test(auth);
  const hasCookie = headerValue(headers.cookie).length > 0;
  return hasBearer && !hasCookie;
}

/**
 * Whether a request to a PRIVATE preview/deploy upstream must be refused because
 * it can only be reaching the shared path-mode content origin with ambient
 * authority (M-029).
 *
 * In path mode every preview, every public deploy and every private deploy share
 * ONE content origin. Script in an attacker's public-deploy page can therefore
 * issue a browser same-origin request to a victim's private-deploy URL, and the
 * browser attaches the victim's session cookie — indistinguishable, on that
 * shared origin, from the private app's own request (there is no browser signal
 * that identifies the initiating document's path). The owner-cookie check cannot
 * separate them, so a cookie/browser (ambient) request to a private upstream is
 * refused in path mode; private serving requires subdomain mode, where each
 * deploy has its own origin and an attacker cannot host content on the victim's
 * host. Non-ambient bearer callers (CLI/API) and local mode are unaffected.
 *
 * Subdomain mode → always false (per-deploy origin closes the confused deputy).
 */
export function refusesSharedOriginPrivateAdmission(headers: AdmissionHeaders): boolean {
  if (isSubdomainRouting()) return false;
  return !isNonAmbientCaller(headers);
}

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
 * `ant-preview.your-domain.tld` → `{label}.ant-preview.your-domain.tld`). When set,
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

/**
 * Listener ports for ant-preview.
 *
 * The process runs TWO listeners because it does two jobs that must not share a
 * browser origin: it serves USER CONTENT (a public deploy's built output, a user's
 * own dev server) and it exposes a cookie-authenticated CONTROL PLANE
 * (`/projects/*`) that can write a feature's `.env`. On one origin, script in a
 * deployed SVG or HTML page runs same-origin with that API and drives it with the
 * viewer's session — a browser-origin sink that no CSP or content filter closes
 * (report H-NEW-001).
 *
 * `PORT` stays the control plane, so every existing management URL is unchanged.
 * Content moves to `ANT_PREVIEW_CONTENT_PORT`, defaulting to `PORT + 1`.
 *
 * A distinct port is necessary but not sufficient: cookies ignore ports, so the
 * session still reaches the content listener. What makes the separation bite is
 * that the content listener mounts no control-plane route, `isSelfOrigin`
 * compares full origins, and `sameOriginGuard` refuses cross-origin
 * cookie-authenticated state changes. A deployment must also publish the two
 * listeners under different hostnames for the browser's own origin model to agree
 * — see docs/guides/self-host-cloud.md.
 */
export function getPreviewControlPort(fallback = 8080): number {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPreviewContentPort(controlPort = getPreviewControlPort()): number {
  const raw = process.env.ANT_PREVIEW_CONTENT_PORT;
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return controlPort + 1;
}

/**
 * Boot gate: the two listeners must not collide. A shared port would silently
 * restore the single-origin layout H-NEW-001 is about, so it fails the start
 * rather than logging.
 */
export function assertPreviewOriginSeparation(controlPort = getPreviewControlPort()): void {
  const contentPort = getPreviewContentPort(controlPort);
  if (contentPort === controlPort) {
    throw new Error(
      `ANT_PREVIEW_CONTENT_PORT (${contentPort}) must differ from PORT (${controlPort}): ` +
      'user content and the control-plane API must not share an origin.',
    );
  }
}

/**
 * Public origin the preview CONTENT listener is published on, or `undefined`
 * where a deployment has not published one yet.
 *
 * This is the ONE declaration of that fact, and it lives on the server on
 * purpose. It used to be a frontend build-time guess
 * (`VITE_PREVIEW_CONTENT_HOST` → `hasDistinctContentOrigin()`), which meant a
 * topology fact was baked into a static bundle: the cloud UI build never passed
 * the variable, so every cloud user silently got the pre-lane behaviour and the
 * HTML preview's links kept 400ing on the byte route.
 *
 * Deliberately NOT derived from `getPreviewContentPort()`: this is read by
 * ant-api, whose `PORT` is its own, not ant-preview's. A derivation there would
 * point at a port nothing serves.
 *
 * Unset is not a failure — the workspace preview lane is also mounted on the
 * control plane under an inert profile, so browsing still works; only scripting
 * is withheld until a content origin exists.
 */
export function resolvePublicContentOrigin(): string | undefined {
  const raw = process.env.ANT_PREVIEW_CONTENT_ORIGIN;
  if (!raw || !raw.trim()) return undefined;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return undefined;
  }
}
