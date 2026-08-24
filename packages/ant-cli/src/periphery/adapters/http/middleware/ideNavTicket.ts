/**
 * IDE navigation ticket — the non-ambient credential lane for the `/ide/*` gate.
 *
 * The IDE is embedded as an `<iframe src>`, and a document navigation is the one
 * request shape the browser gives us no origin attestation for: a GET navigation
 * carries no `Origin`, and in a split-host deployment (FE and API on different
 * subdomains of one registrable domain) `Sec-Fetch-Site` reads `same-site` — the
 * exact value the cookie-origin predicate must refuse, because attacker-authored
 * preview/deploy content is same-site too (H-013). The two are indistinguishable
 * from headers alone, so no Fetch-Metadata rule can admit one and refuse the other.
 *
 * A ticket supplies the attestation the headers cannot. It is minted only by a
 * cookie-authenticated POST behind `createSameOriginGuard` — an attacker's content
 * origin is not a registered frontend, so it cannot mint one, and it cannot read
 * the FE's ticket across origins. That makes it a bearer credential delivered in
 * the only channel a navigation has, which is why it sits beside the existing
 * `Authorization: Bearer` exemption rather than inside the origin predicate:
 * `isTrustedCookieOrigin` is untouched and still refuses `same-site`.
 */

import crypto from 'crypto';

import { createIDEKey } from '../../../../infrastructure/state/redisKeyUtils';

/** Query parameter carrying the ticket on the iframe navigation. */
export const NAV_TICKET_PARAM = 'ant_nav';

/**
 * Ticket lifetime. Long enough for pod pre-flight plus the iframe mount, short
 * enough that a ticket leaked through a Referer or a shoulder-surfed URL is dead
 * before it can be replayed.
 */
export const NAV_TICKET_TTL_SEC = 60;

/**
 * Deliberately NOT single-use: the iframe re-navigates on retry and under React
 * StrictMode's double mount, and burning the ticket there breaks legitimate users
 * for no security gain — the window is already 60s on a value the attacker cannot
 * read. Strict one-shot would need an atomic `GETDEL` on `StateStorePort`.
 */

/** The identity a ticket is bound to. Never taken from client input. */
export interface NavTicketOwner {
  org: string;
  userId: string;
  projectId: string;
  feature: string;
}

/** The slice of `StateStorePort` this module needs — keeps it unit-testable. */
export interface NavTicketStore {
  setKeyWithTTL(key: string, value: string, ttlSeconds: number): Promise<void>;
  getKey(key: string): Promise<string | null>;
}

interface StoredTicket {
  serverKey: string;
  org: string;
  sub: string;
}

/**
 * The Redis key holds the ticket's SHA-256, not the ticket. A key dump or a
 * `SCAN` in an incident log then yields nothing replayable.
 */
function ticketKey(ticket: string): string {
  return `ide:nav:${crypto.createHash('sha256').update(ticket).digest('hex')}`;
}

export async function mintIdeNavTicket(
  store: NavTicketStore,
  owner: NavTicketOwner,
): Promise<{ ticket: string; expiresInSec: number }> {
  const ticket = crypto.randomBytes(32).toString('hex');
  const stored: StoredTicket = {
    serverKey: createIDEKey(owner.org, owner.userId, owner.projectId, owner.feature),
    org: owner.org,
    sub: owner.userId,
  };
  await store.setKeyWithTTL(ticketKey(ticket), JSON.stringify(stored), NAV_TICKET_TTL_SEC);
  return { ticket, expiresInSec: NAV_TICKET_TTL_SEC };
}

/**
 * A ticket admits exactly the navigation it was minted for: it must name the
 * serverKey in the URL AND the account whose session cookie is on the request.
 * A stolen ticket is therefore useless to another account, and a ticket for one
 * IDE cannot open another.
 */
export async function redeemIdeNavTicket(
  store: NavTicketStore,
  args: { ticket: unknown; serverKey: string; payload: { org: string; sub: string } },
): Promise<boolean> {
  const { ticket, serverKey, payload } = args;
  if (typeof ticket !== 'string' || !/^[0-9a-f]{64}$/.test(ticket)) return false;

  const raw = await store.getKey(ticketKey(ticket));
  if (!raw) return false;

  let stored: StoredTicket;
  try {
    stored = JSON.parse(raw) as StoredTicket;
  } catch {
    return false;
  }

  return stored.serverKey === serverKey && stored.org === payload.org && stored.sub === payload.sub;
}

/**
 * Drop the ticket from the URL before the proxy forwards it, so it reaches
 * neither the upstream IDE nor `baseProxy`'s `req.url` debug log.
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
