/**
 * urlKey ↔ DNS subdomain label (Phase 2, subdomain routing).
 *
 * In subdomain mode the app is served at `{label}.<baseDomain>` at ROOT. The
 * label must be a single valid DNS label ([a-z0-9-], ≤63 chars, no leading/
 * trailing hyphen). urlKeys are `tenant--user--project--feature[--slug]` and
 * the tenant can carry a `.` (email/org domain), so dots must be encoded.
 *
 * Reversal is by RECOMPUTE-and-MATCH against the active preview/deploy set
 * (deterministic label), not a stored index — the active set per host is small
 * and the label function is pure, so no extra Redis schema is needed.
 */

import { createHash } from 'crypto';
import { toUrlKey, toUrlKeyWithService } from './serverKeyUtils';
import { getPreviewBaseDomain } from '../../../../../../core/config/previewRouting';

const MAX_LABEL = 63;

/**
 * Deterministic DNS label for a urlKey. Preserves the `--` part separators and
 * existing hyphens; maps every other invalid char (notably `.`) to `-`. Keys
 * that exceed the DNS 63-char limit are truncated and suffixed with a short
 * content hash so distinct long keys never collide.
 */
export function toDnsLabel(urlKey: string): string {
  const sanitized = urlKey
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (sanitized.length <= MAX_LABEL) return sanitized;

  const hash = createHash('sha256').update(urlKey).digest('hex').slice(0, 8);
  const head = sanitized.slice(0, MAX_LABEL - hash.length - 1).replace(/-+$/g, '');
  return `${head}-${hash}`;
}

/**
 * Extract the leading DNS label from a Host header. When `baseDomain` is
 * known, strips exactly that suffix; otherwise falls back to the first
 * dot-segment. Returns null when the host is bare (no subdomain).
 */
export function extractLabelFromHost(host: string | undefined, baseDomain?: string): string | null {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase().replace(/\.$/, '');
  if (!h) return null;
  if (baseDomain) {
    // Strict: only hosts under THIS base domain yield a label. A host under a
    // different base (e.g. the deploy base vs the preview base) returns null so
    // the caller defers to the other proxy — preview/deploy disambiguation.
    const suffix = `.${baseDomain}`;
    if (!h.endsWith(suffix)) return null;
    const label = h.slice(0, h.length - suffix.length);
    return label.length > 0 && !label.includes('.') ? label : null;
  }
  const firstDot = h.indexOf('.');
  return firstDot > 0 ? h.slice(0, firstDot) : null;
}

/**
 * The urlKey a package is reachable at: single frontend → 4-part `toUrlKey`;
 * multi-frontend → 5-part `toUrlKeyWithService` (SSOT mirrors PreviewService /
 * DeployService identity assignment). `pkgUrlKey` is used verbatim when the
 * caller already computed it (deploy carries it on the package).
 */
export function labelForPackage(serverKey: string, opts: { pkgUrlKey?: string; slug?: string; isMulti?: boolean }): string {
  if (opts.pkgUrlKey) return toDnsLabel(opts.pkgUrlKey);
  const urlKey = opts.isMulti && opts.slug
    ? toUrlKeyWithService(serverKey, opts.slug)
    : toUrlKey(serverKey);
  return toDnsLabel(urlKey);
}

/**
 * Public https URL for an app on its per-app subdomain. Returns null when no
 * base domain is configured (subdomain mode not fully provisioned) so callers
 * can fall back to the path-prefix URL.
 */
export function subdomainAppUrl(label: string): string | null {
  const base = getPreviewBaseDomain();
  return base ? `https://${label}.${base}` : null;
}

/** Convenience: subdomain URL for a urlKey (derives the label). */
export function subdomainAppUrlForUrlKey(urlKey: string): string | null {
  return subdomainAppUrl(toDnsLabel(urlKey));
}

