/**
 * IDE navigation ticket — the `/ide/*` gate's binding of the shared nav-ticket
 * primitive (`navTicket.ts`, which carries the rationale for the lane).
 *
 * A ticket is minted only by a cookie-authenticated POST behind
 * `createSameOriginGuard` — an attacker's content origin is not a registered
 * frontend, so it cannot mint one, and it cannot read the FE's ticket across
 * origins. That makes it a bearer credential delivered in the only channel a
 * navigation has, which is why it sits beside the existing `Authorization:
 * Bearer` exemption rather than inside the origin predicate:
 * `isTrustedCookieOrigin` is untouched and still refuses `same-site`.
 */

import { createIDEKey } from '../../../../infrastructure/state/redisKeyUtils';

import { mintNavTicket, readNavTicket, type NavTicketStore } from './navTicket';

export {
  NAV_TICKET_PARAM,
  resolveNavTicketStore,
  stripNavTicket,
  type NavTicketStore,
} from './navTicket';

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

interface StoredTicket {
  serverKey: string;
  org: string;
  sub: string;
}

export async function mintIdeNavTicket(
  store: NavTicketStore,
  owner: NavTicketOwner,
): Promise<{ ticket: string; expiresInSec: number }> {
  const stored: StoredTicket = {
    serverKey: createIDEKey(owner.org, owner.userId, owner.projectId, owner.feature),
    org: owner.org,
    sub: owner.userId,
  };
  return mintNavTicket(store, 'ide', stored, NAV_TICKET_TTL_SEC);
}

/**
 * A ticket admits exactly the navigation it was minted for: it must name the
 * serverKey in the URL AND the account whose session cookie is on the request.
 * A stolen ticket is therefore useless to another account, and a ticket for one
 * IDE cannot open another.
 *
 * This comparison is why the primitive does not own admission — the workspace
 * lane has no cookie payload to compare against.
 */
export async function redeemIdeNavTicket(
  store: NavTicketStore,
  args: { ticket: unknown; serverKey: string; payload: { org: string; sub: string } },
): Promise<boolean> {
  const { ticket, serverKey, payload } = args;
  const stored = await readNavTicket<StoredTicket>(store, 'ide', ticket);
  if (!stored) return false;

  return stored.serverKey === serverKey && stored.org === payload.org && stored.sub === payload.sub;
}
