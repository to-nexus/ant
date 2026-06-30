/**
 * Proxy ownership gate — SSOT for the IDE / Preview / Deploy proxy family.
 *
 * All three proxy surfaces route by an enumerable urlKey whose first two
 * segments are the owning `(tenantId, userId)` — true for both the 4-part
 * `tenant:user:project:feature` key and the 5-part `…:serviceName` /
 * `…:package` variants. A logged-in user holding a valid JWT must only reach
 * resources keyed to their own `(org, sub)`; without this gate any session
 * could guess another tenant's urlKey and proxy into their pod / dev server.
 *
 * The deploy proxy's private-access check is the reference this generalizes
 * (see `deployProxy.ts`) — that owner comparison now routes through
 * `assertProxyOwnership` so the family cannot drift.
 */

/** The owning identity baked into a urlKey's first two segments. */
export interface ProxyOwner {
  tenantId: string;
  userId: string;
}

/** Minimal JWT-verify surface the gate needs. */
export interface ProxyJwtVerifier {
  verify(token: string): { org: string; sub: string };
}

/**
 * Pure ownership predicate: does this verified JWT payload own the urlKey?
 * Owner is the urlKey's first two segments regardless of arity (4- or 5-part).
 *
 * Team extension point: replace `payload.sub === userId` with a
 * team-membership lookup when team orgs ship (mirrors deployProxy's note).
 */
export function assertProxyOwnership(
  payload: { org: string; sub: string },
  parts: ProxyOwner,
): boolean {
  return payload.org === parts.tenantId && payload.sub === parts.userId;
}

/**
 * Cookie-token → authorization decision for a proxy request.
 *
 * - `jwtService === undefined` → local mode (single tenant): always authorized.
 * - missing / malformed / non-owner token → `false`.
 *
 * The caller is responsible for turning `false` into the surface-appropriate
 * rejection (403 for HTTP, `socket.destroy()` for WS upgrades).
 */
export function authorizeProxyToken(
  token: string | undefined,
  jwtService: ProxyJwtVerifier | undefined,
  parts: ProxyOwner,
): boolean {
  if (!jwtService) return true; // local mode: single tenant, owner-accessible
  if (!token) return false;
  try {
    return assertProxyOwnership(jwtService.verify(token), parts);
  } catch {
    return false;
  }
}
