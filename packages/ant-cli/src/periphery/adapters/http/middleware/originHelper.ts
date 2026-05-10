/**
 * Extract the start-of-flow origin of an HTTP request. Cross-origin
 * navigations and fetch requests carry an `Origin` header set by the
 * browser; same-origin GETs (e.g. anchor click within the same site)
 * may only carry `Referer`. Returning `undefined` lets the caller fall
 * back to a deploy-time default (e.g. `process.env.FRONTEND_URL`)
 * without confusing "missing" with "rejected".
 *
 * Used by the OAuth start handler to record the origin into Redis state
 * so the callback can route the redirect back to the same origin.
 */
export function extractStartOrigin(
  originHeader: string | string[] | undefined,
  refererHeader: string | string[] | undefined,
): string | undefined {
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (origin) return origin;
  const referer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
