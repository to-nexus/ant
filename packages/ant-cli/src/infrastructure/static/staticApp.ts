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
import { resolveWithinRoot } from '../../core/config/pathContainment';

export interface StaticAppOptions {
  /** Absolute directory to serve. */
  root: string;
  /** URL prefix: `'/'` (subdomain routing) or `'/{urlKey}'` (path routing). */
  basePath: string;
  /** `'none'` for a live source dir; `'short'` for an immutable build artifact. */
  cache: 'none' | 'short';
  /**
   * `'always-index'` — every unmatched path returns the entry file (SPA
   * routing). `'navigation-only'` — only extension-less HTML navigations do; a
   * missing `.css` / `.js` / image 404s, so a typo'd asset stays visible as a
   * typo. `'none'` — nothing falls back: an unmatched path is a broken link in
   * somebody's workspace, and answering it with an unrelated `index.html` would
   * be both a lie and a disclosure.
   */
  fallback: 'always-index' | 'navigation-only' | 'none';
  /**
   * Entry filename inside `root` that `/` and the fallback serve. Defaults to
   * `index.html`. Decided at detection time by the manifest SSOT
   * (`staticEntryFile`) — NEVER derived from request data.
   */
  entryFile?: string;
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
  const entryFile = options.entryFile ?? 'index.html';
  // Fail closed on an entry that could escape `root` or dodge the dotfile
  // guard — such a value is an upstream bug, never a servable configuration.
  if (entryFile !== path.basename(entryFile) || entryFile.startsWith('.')) {
    throw new Error(`Invalid static entry file: ${entryFile}`);
  }
  const app: Express = express();

  // Dotfiles are refused by US, before serve-static gets a say: a preview root
  // is the user's live workspace and may hold a `.env` the preview machinery
  // itself wrote, and whether `dotfiles: 'deny'` answers 403 or falls through to
  // the SPA fallback is an express-version detail we must not depend on.
  //
  // Symlink containment: express.static / `send` reject a lexical `..` but do NO
  // realpath check, so an in-root symlink pointing OUT of root is followed and
  // served. `root` is a live tenant workspace (preview — a code job rewrites it)
  // or a deploy snapshot that preserves symlinks verbatim, and a deploy defaults
  // to public — so a planted link would leak host/other-tenant files. containedIo
  // has no serve-static adapter, so we gate here: resolve the requested path and
  // refuse anything whose realpath (following every symlink component) escapes
  // root. Runs before express.static, on every request.
  app.use((req, res, next) => {
    if (hasDotSegment(req.path)) {
      res.status(403).send('Forbidden');
      return;
    }
    let rel = req.path;
    if (basePath !== '/' && (rel === basePath || rel.startsWith(basePath + '/'))) {
      rel = rel.slice(basePath.length);
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      res.status(400).send('Bad request');
      return;
    }
    const relUnderRoot = decoded.replace(/^\/+/, '');
    // Empty (root itself) is allowed; a non-empty target must realpath inside root.
    if (relUnderRoot && resolveWithinRoot(root, relUnderRoot) === null) {
      res.status(403).send('Forbidden');
      return;
    }
    next();
  });

  app.use(
    basePath,
    express.static(root, {
      dotfiles: 'deny',
      index: entryFile,
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
    if (fallback === 'none') {
      res.status(404).send('Not found');
      return;
    }
    if (fallback === 'navigation-only' && !isHtmlNavigation(req.path, req.headers.accept)) {
      res.status(404).send('Not found');
      return;
    }
    const entryPath = path.join(root, entryFile);
    if (fs.existsSync(entryPath)) {
      if (cache === 'none') res.setHeader('Cache-Control', 'no-store');
      res.sendFile(entryPath);
    } else {
      res.status(404).send(`${entryFile} not found`);
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
