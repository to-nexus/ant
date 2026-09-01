/**
 * Workspace preview lane — the file editor's HTML preview, served as a real
 * static site on the preview CONTENT origin.
 *
 * "Hand a directory to a browser" already has one owner (`createStaticApp`), and
 * the file editor used to borrow the byte-transport route instead: its
 * `<base href>` pointed at `/api/.../files-raw/<dir>/`, whose contract is one
 * path → one file's bytes. So a link to a folder came back as
 * `400 {"error":"Path is a directory, not a file"}` rendered as raw JSON in the
 * frame, and a link to a valid file was refused by `frame-ancestors 'self'`
 * whenever the API sits on its own host. Both are the same mistake: browsing a
 * document is a static-host job, and it does not belong on the control plane.
 *
 * This lane is READ-ONLY and identity-free. Its only credential is the ticket in
 * the URL, which is also what lets the frame drop `allow-same-origin`: with no
 * cookie to restore, the preview frame runs as an opaque origin, so scripts in an
 * LLM-authored document reach nothing at all.
 */

import * as path from 'path';

import { Request, RequestHandler, Response, Express } from 'express';

import {
  UNIVERSAL_ARTIFACTS_DIRNAME,
} from '../../../../core/customAgents/universalContainer';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { isReservedSessionRelativePath } from '../../../../core/utils/sessionPaths';
import { createStaticApp } from '../../../../infrastructure/static/staticApp';
import { logger } from '../../../../utils/logger';
import { resolveUniversalPlaneRoot } from '../routes/helpers/featureFiles';

import { frameAncestors } from './frameAncestors';
import type { NavTicketStore } from './navTicket';
import { redeemWorkspacePreviewTicket, type WorkspacePreviewOwner } from './workspacePreviewTicket';

/** URL prefix this lane claims on the content listener. */
export const WORKSPACE_LANE_PREFIX = '/workspace';

/**
 * Per-root static apps. Roots are `(org,user,project,feature)`-stable and the app
 * holds only the root string, so a deleted workspace simply 404s. Bounded because
 * an account can open previews across many features.
 */
const MAX_CACHED_ROOTS = 64;
const staticApps = new Map<string, Express>();

function staticAppFor(root: string): Express {
  const cached = staticApps.get(root);
  if (cached) {
    // Refresh LRU position.
    staticApps.delete(root);
    staticApps.set(root, cached);
    return cached;
  }
  const app = createStaticApp({ root, basePath: '/', cache: 'none', fallback: 'none' });
  staticApps.set(root, app);
  if (staticApps.size > MAX_CACHED_ROOTS) {
    const oldest = staticApps.keys().next().value as string | undefined;
    if (oldest !== undefined) staticApps.delete(oldest);
  }
  return app;
}

/**
 * The feature tree this ticket's owner may browse.
 *
 * A workspace project resolves to `{container}/artifacts` and NOT the merged
 * view: the merged view grafts `sessions/**` in, which is job-lifecycle state,
 * not a user artifact.
 */
function resolveLaneRoot(resolver: WorkspaceResolver, owner: WorkspacePreviewOwner): string {
  const userContext = { organizationId: owner.org, userId: owner.userId } as any;
  const container = resolveUniversalPlaneRoot(resolver, userContext, owner.projectId, owner.feature);
  return container
    ? path.join(container, UNIVERSAL_ARTIFACTS_DIRNAME)
    : resolver.getFeaturePath(userContext, owner.projectId, owner.feature);
}

/**
 * Rendered inside an iframe, so the refusal is a page rather than JSON — a user
 * whose 30-minute ticket lapsed must be told what to do, not shown a payload.
 *
 * Every refusal is 401 with the same body: whether a ticket exists is not
 * something an unauthenticated caller gets to learn.
 */
function refuse(res: Response): void {
  res.status(401).type('html').send(
    '<!doctype html><meta charset="utf-8">' +
      '<style>body{font:14px system-ui;margin:2rem;color:#555}</style>' +
      '<p>Preview session expired. Close and reopen the preview to continue.</p>',
  );
}

export interface WorkspacePreviewLaneDeps {
  workspaceResolver: WorkspaceResolver;
  ticketStore: NavTicketStore;
}

/**
 * Mounted at `/workspace` on the content listener, BEFORE the preview proxy.
 *
 * Once a request reaches here it is answered — the lane never calls `next()`, so
 * a `POST /workspace/...` cannot fall through and become a new admission surface
 * on the proxies behind it.
 */
export function createWorkspacePreviewLane(deps: WorkspacePreviewLaneDeps): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).type('text/plain').send('Method Not Allowed');
      return;
    }

    // Parsed by hand rather than through `app.use('/workspace/:ticket')`:
    // path-to-regexp v8 param semantics are not worth depending on for the
    // one segment that authorizes the whole request.
    const [, ticket = '', ...rest] = req.path.split('/');
    const relPath = rest.join('/');

    const owner = await redeemWorkspacePreviewTicket(deps.ticketStore, ticket);
    if (!owner) {
      refuse(res);
      return;
    }

    // `sessions/**` is job state on both planes and is off-limits to every
    // generic file surface — the artifacts root closes it for workspace
    // projects, this closes it for canonical features.
    if (isReservedSessionRelativePath(decodeSafe(relPath))) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    let root: string;
    try {
      root = resolveLaneRoot(deps.workspaceResolver, owner);
    } catch (error) {
      logger.warn('🖼️ [WorkspacePreview] root resolution failed', { component: 'WorkspacePreview' }, {
        projectId: owner.projectId,
        error: (error as Error)?.message,
      });
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    stampLaneHeaders(res);

    // The sub-app is mounted at '/', so hand it the path with the ticket segment
    // removed. `req.originalUrl` is untouched, which is what serve-static's
    // "directory without a trailing slash → 301" builds its Location from.
    req.url = req.url.slice(`/${ticket}`.length) || '/';

    staticAppFor(root)(req, res);
  };
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `helmet()` on the content listener disables only COEP/COOP/CSP, so it still
 * stamps `X-Frame-Options: SAMEORIGIN` and `Cross-Origin-Resource-Policy:
 * same-origin` — which would block the app origin from framing this lane and
 * block every subresource an opaque-origin frame requests. Both are correct
 * defaults for a deployed page opened in its own tab; they are wrong for the one
 * surface that exists to be embedded, so they are overridden HERE and not by
 * loosening helmet for the whole listener.
 *
 * `Access-Control-Allow-Origin: *` is safe precisely because it cannot be
 * combined with credentials: the ticket is the credential, and this lane must
 * never be cookie-authenticated.
 */
function stampLaneHeaders(res: Response): void {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors().join(' ')}`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Keeps the ticket out of the Referer of anything the document links out to.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');
}
