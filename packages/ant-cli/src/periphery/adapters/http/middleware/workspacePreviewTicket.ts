/**
 * Workspace preview ticket — the content origin's binding of the shared
 * nav-ticket primitive (`navTicket.ts`).
 *
 * The file editor previews an HTML artifact by serving its whole feature root as
 * a static site on the preview CONTENT origin. That listener deliberately has no
 * cookie-parser and no JWT middleware — and an operator may publish it on a
 * different registrable domain, where the session cookie never arrives at all.
 * So the ticket is the ONLY credential, and redemption returns the owner rather
 * than comparing against one: there is nothing to compare against, and "check
 * the cookie if one happens to be present" would fail open.
 *
 * It is minted only by a cookie-authenticated POST on ant-api, behind
 * `createSameOriginGuard` — an attacker's content origin is not a registered
 * frontend, so it cannot mint one.
 */

import { mintNavTicket, readNavTicket, type NavTicketStore } from './navTicket';

/**
 * 30 minutes: a browsing session, not the IDE's one-shot iframe mount.
 *
 * Deliberately NOT sliding. Refreshing per request would cost one Redis write
 * per subresource (a page with 30 assets = 30 writes), and refreshing only on
 * HTML navigations would mean keying admission-adjacent logic on
 * `Sec-Fetch-Dest`, which this codebase refuses to build on.
 */
export const WORKSPACE_PREVIEW_TICKET_TTL_SEC = 30 * 60;

/**
 * The identity and scope a ticket is bound to. Never taken from client input,
 * and never re-read from the URL — the lane resolves the served root from THIS,
 * which is what makes a stolen ticket useless for another account or feature.
 *
 * Scope is the whole feature root because the bundles this exists for link
 * across it (`screens/home.html` → `../styles.css`); anything narrower breaks
 * `..`, which `express.static` refuses outright.
 */
export interface WorkspacePreviewOwner {
  org: string;
  userId: string;
  projectId: string;
  feature: string;
}

export function mintWorkspacePreviewTicket(
  store: NavTicketStore,
  owner: WorkspacePreviewOwner,
): Promise<{ ticket: string; expiresInSec: number }> {
  return mintNavTicket(store, 'workspace', owner, WORKSPACE_PREVIEW_TICKET_TTL_SEC);
}

/** The owner this ticket was minted for, or null when it is absent/expired/malformed. */
export async function redeemWorkspacePreviewTicket(
  store: NavTicketStore,
  ticket: unknown,
): Promise<WorkspacePreviewOwner | null> {
  const stored = await readNavTicket<WorkspacePreviewOwner>(store, 'workspace', ticket);
  if (!stored) return null;
  // A stored blob that lost a field would resolve to a wrong (or root) path.
  if (!stored.org || !stored.userId || !stored.projectId || !stored.feature) return null;
  return stored;
}
