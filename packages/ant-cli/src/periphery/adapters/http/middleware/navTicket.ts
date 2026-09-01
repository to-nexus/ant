/**
 * Navigation ticket primitive — the non-ambient credential lane.
 *
 * A document navigation is the one request shape the browser gives us no origin
 * attestation for: a GET navigation carries no `Origin`, and in a split-host
 * deployment (FE and API on different subdomains of one registrable domain)
 * `Sec-Fetch-Site` reads `same-site` — the exact value the cookie-origin
 * predicate must refuse, because attacker-authored preview/deploy content is
 * same-site too (H-013). The two are indistinguishable from headers alone, so no
 * Fetch-Metadata rule can admit one and refuse the other. A ticket supplies the
 * attestation the headers cannot.
 *
 * This module owns what every scope shares: the random value, the hash-as-key
 * storage, the TTL, the shape gate, the URL strip, the store handle.
 *
 * It deliberately does NOT own admission. The `/ide/*` gate compares the stored
 * owner against a verified cookie payload; the workspace preview lane has no
 * cookie to compare against (its listener has no cookie-parser, and an operator
 * may publish the content origin on a different registrable domain entirely) and
 * must read the owner OUT of the ticket. "Check the cookie if one happens to be
 * present" is a fail-open predicate — each scope's own module decides instead.
 */

import crypto from 'crypto';

/** Query parameter carrying the ticket on an iframe navigation. */
export const NAV_TICKET_PARAM = 'ant_nav';

/** The slice of `StateStorePort` this module needs — keeps it unit-testable. */
export interface NavTicketStore {
  setKeyWithTTL(key: string, value: string, ttlSeconds: number): Promise<void>;
  getKey(key: string): Promise<string | null>;
}

export type NavTicketScope = 'ide' | 'workspace';

/**
 * Explicit map rather than a template: `ide:nav:` is the key prefix already in
 * production, so a rolling deploy must keep spelling it exactly that way.
 */
const SCOPE_PREFIX: Record<NavTicketScope, string> = {
  ide: 'ide:nav:',
  workspace: 'ws:nav:',
};

/**
 * The Redis key holds the ticket's SHA-256, not the ticket. A key dump or a
 * `SCAN` in an incident log then yields nothing replayable.
 */
function ticketKey(scope: NavTicketScope, ticket: string): string {
  return SCOPE_PREFIX[scope] + crypto.createHash('sha256').update(ticket).digest('hex');
}

export async function mintNavTicket<T extends object>(
  store: NavTicketStore,
  scope: NavTicketScope,
  claims: T,
  ttlSec: number,
): Promise<{ ticket: string; expiresInSec: number }> {
  const ticket = crypto.randomBytes(32).toString('hex');
  await store.setKeyWithTTL(ticketKey(scope, ticket), JSON.stringify(claims), ttlSec);
  return { ticket, expiresInSec: ttlSec };
}

/**
 * The stored claims, or null when the ticket is absent, malformed or expired.
 *
 * The shape gate runs BEFORE the store read: this is reachable from
 * unauthenticated paths, and an arbitrary string must not cost a state-store
 * round trip.
 */
export async function readNavTicket<T>(
  store: NavTicketStore,
  scope: NavTicketScope,
  ticket: unknown,
): Promise<T | null> {
  if (typeof ticket !== 'string' || !/^[0-9a-f]{64}$/.test(ticket)) return null;

  const raw = await store.getKey(ticketKey(scope, ticket));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Drop the ticket from the URL before a proxy forwards it, so it reaches neither
 * the upstream nor `baseProxy`'s `req.url` debug log.
 */
export function stripNavTicket(url: string): string {
  const [pathPart, queryPart] = splitQuery(url);
  if (queryPart === undefined) return url;
  const kept = queryPart
    .split('&')
    .filter(pair => pair !== '' && decodeURIComponent(pair.split('=')[0]) !== NAV_TICKET_PARAM);
  return kept.length > 0 ? `${pathPart}?${kept.join('&')}` : pathPart;
}

function splitQuery(url: string): [string, string | undefined] {
  const i = url.indexOf('?');
  return i === -1 ? [url, undefined] : [url.slice(0, i), url.slice(i + 1)];
}

/**
 * Lazily resolve the shared state store. Dynamic import mirrors `ideProxy.ts` —
 * the middleware wiring must not pull the infrastructure factory at module load.
 */
export async function resolveNavTicketStore(): Promise<NavTicketStore> {
  const { getInfrastructureFactory } = await import(
    '../../../../infrastructure/adapters/InfrastructureFactory'
  );
  return getInfrastructureFactory().getStateStore() as unknown as NavTicketStore;
}
