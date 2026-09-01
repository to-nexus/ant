/**
 * Who may embed content we serve — one owner for the `frame-ancestors` list.
 *
 * Two surfaces need it and must not drift apart: the IDE proxy (which strips the
 * upstream's `X-Frame-Options`) and the workspace preview lane (which removes
 * helmet's `SAMEORIGIN` so the app origin can frame the content origin). In both,
 * this is defense in depth, NOT the control that admits the request — that is the
 * ticket. A same-site page cannot obtain a ticket.
 */

import { allowedFrontendOrigins } from './corsConfig';

/**
 * `'self'` covers the single-origin deployment; the registered frontend origins
 * cover split-host. Loopback is prefix-matched by the origin predicate and so
 * cannot be enumerated — outside cloud, allow it by pattern instead.
 */
export function frameAncestors(): string[] {
  const sources = ["'self'", ...allowedFrontendOrigins()];
  if (process.env.ANT_SERVER_MODE !== 'cloud') {
    sources.push('http://localhost:*', 'http://127.0.0.1:*');
  }
  return sources;
}
