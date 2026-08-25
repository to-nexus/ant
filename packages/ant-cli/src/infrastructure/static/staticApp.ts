/**
 * Static file serving — the single owner of "hand a directory to a browser".
 *
 * Two callers with different products:
 *   deploy  — a built SPA artifact, cached, every unmatched path is the app's
 *             own client-side route (`always-index`).
 *   preview — a live source directory a code job keeps rewriting, so nothing is
 *             cached and an unmatched asset must 404 honestly rather than come
 *             back as HTML (`navigation-only`).
 *
 * `basePath` is the URL prefix the preview/deploy proxy forwards VERBATIM, so
 * the app mounts at that prefix rather than rewriting HTML.
 */

import express, { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export interface StaticAppOptions {
  /** Absolute directory to serve. */
  root: string;
  /** URL prefix: `'/'` (subdomain routing) or `'/{urlKey}'` (path routing). */
  basePath: string;
  /** `'none'` for a live source dir; `'short'` for an immutable build artifact. */
  cache: 'none' | 'short';
  /**
   * `'always-index'` — every unmatched path returns `index.html` (SPA routing).
   * `'navigation-only'` — only extension-less HTML navigations do; a missing
   * `.css` / `.js` / image 404s, so a typo'd asset stays visible as a typo.
   */
  fallback: 'always-index' | 'navigation-only';
}

/** Any `/.`-prefixed path segment — `.env`, `.git/config`, `foo/.ssh/id_rsa`. */
function hasDotSegment(reqPath: string): boolean {
  return reqPath.split('/').some(seg => seg.startsWith('.') && seg !== '.' && seg !== '..');
}

/** Does this request look like a browser navigating, rather than fetching an asset? */
function isHtmlNavigation(reqPath: string, accept: string | undefined): boolean {
  if (path.extname(reqPath)) return false;
  return (accept ?? '').includes('text/html');
}

export function createStaticApp(options: StaticAppOptions): Express {
  const { root, basePath, cache, fallback } = options;
  const app: Express = express();

  // Dotfiles are refused by US, before serve-static gets a say: a preview root
  // is the user's live workspace and may hold a `.env` the preview machinery
  // itself wrote, and whether `dotfiles: 'deny'` answers 403 or falls through to
  // the SPA fallback is an express-version detail we must not depend on.
  app.use((req, res, next) => {
    if (hasDotSegment(req.path)) {
      res.status(403).send('Forbidden');
      return;
    }
    next();
  });

  app.use(
    basePath,
    express.static(root, {
      dotfiles: 'deny',
      etag: cache === 'short',
      maxAge: cache === 'short' ? '1h' : 0,
      // `setHeaders` runs before the body is sent — a middleware AFTER
      // express.static would never see a request it already answered.
      ...(cache === 'none'
        ? { lastModified: false, setHeaders: (res: express.Response) => res.setHeader('Cache-Control', 'no-store') }
        : {}),
    }),
  );

  app.get(`${basePath === '/' ? '' : basePath}/{*splat}`, (req, res) => {
    if (fallback === 'navigation-only' && !isHtmlNavigation(req.path, req.headers.accept)) {
      res.status(404).send('Not found');
      return;
    }
    const indexPath = path.join(root, 'index.html');
    if (fs.existsSync(indexPath)) {
      if (cache === 'none') res.setHeader('Cache-Control', 'no-store');
      res.sendFile(indexPath);
    } else {
      res.status(404).send('index.html not found');
    }
  });

  // Root redirect to basePath — also what makes the preview health check (which
  // probes `/`) see a response on a path-routed server.
  if (basePath !== '/') {
    app.get('/', (_req, res) => {
      res.redirect(basePath);
    });
  }

  return app;
}
