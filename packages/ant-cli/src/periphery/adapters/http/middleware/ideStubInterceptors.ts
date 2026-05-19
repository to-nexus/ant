/**
 * IDE Stub Interceptors
 *
 * Short-circuits a small set of cosmetic-noise paths before they reach
 * `createIDEProxyMiddleware` and forward to the upstream openvscode-server pod.
 *
 * Two interceptors:
 *
 *   1. `createIdeFaviconStub()` — `/ide/{key}/favicon.ico` → 204.
 *      openvscode-server doesn't serve favicon under its base path, so
 *      forwarding produces a 404 with `text/plain` body. The FE readiness
 *      probe (`waitForIdeReady`) treats this as success (<500) but the
 *      browser still logs the 404 to console. Returning 204 here eliminates
 *      the noise while keeping the probe's gate intact.
 *
 *   2. `createIdeVsdaStub()` — `vsda.js` / `vsda_bg.wasm` lazy-loads from
 *      the workbench bundle. The `gitpod/openvscode-server` OSS image
 *      intentionally omits vsda (Microsoft's proprietary connection-token
 *      signing module). ANT uses a token-less proxy so vsda is unused, but
 *      the bundle still tries to fetch it — producing 404 + MIME mismatch
 *      warnings. We return minimal valid stubs:
 *        - vsda.js  → `export {};\n` with `application/javascript`
 *        - vsda_bg.wasm → 8-byte WASM magic+version with `application/wasm`
 *
 * Both interceptors must run AFTER `setupIdeProxyAuth` (JWT gate) and BEFORE
 * `setupProxyMiddleware` — see `ServerConfigurator.configure()`.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

const VSDA_JS_BODY = 'export {};\n';
const VSDA_WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export function createIdeFaviconStub(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/ide/')) return next();
    if (!req.path.endsWith('/favicon.ico')) return next();
    res.status(204).end();
  };
}

export function createIdeVsdaStub(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/ide/')) return next();

    if (req.path.endsWith('/vsda/rust/web/vsda.js')) {
      res.status(200);
      res.set('Content-Type', 'application/javascript; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.send(VSDA_JS_BODY);
      return;
    }

    if (req.path.endsWith('/vsda/rust/web/vsda_bg.wasm')) {
      res.status(200);
      res.set('Content-Type', 'application/wasm');
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.send(VSDA_WASM_MAGIC);
      return;
    }

    return next();
  };
}
