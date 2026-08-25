/**
 * Origin separation for ant-preview — one axis, one row per case.
 *
 * H-NEW-001: this process serves USER CONTENT (a public deploy's built output, a
 * user's own dev server) and also exposes a cookie-authenticated CONTROL PLANE
 * (`/projects/*`) that can write a feature's `.env`. On one origin, script in a
 * deployed SVG or HTML page runs same-origin with that API and drives it with the
 * viewer's session — a browser-origin sink no CSP or SVG filter closes. The two
 * jobs are therefore on two listeners.
 *
 * M-010: on the control listener the 50 MB JSON parser used to run BEFORE
 * authentication, so an unauthenticated client could make the process buffer and
 * parse 50 MB per request before being told 401.
 *
 * The mount-target and ordering rows are asserted against the source: standing up
 * the real server needs Redis, and what must not drift is which app each route is
 * mounted on — a structural property of the file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  assertPreviewOriginSeparation,
  getPreviewContentPort,
  getPreviewControlPort,
} from '../../src/core/config/previewRouting';
import { PreviewServer } from '../../src/infrastructure/preview/PreviewServer';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../src/infrastructure/preview/PreviewServer.ts'),
  'utf8',
);

const contentSection = SRC.slice(
  SRC.indexOf('private setupContentRoutes()'),
  SRC.indexOf('private setupControlRoutes()'),
);
const controlSection = SRC.slice(SRC.indexOf('private setupControlRoutes()'));

describe('PreviewServer listener split (H-NEW-001)', () => {
  it('the content listener mounts the preview and deploy proxies', () => {
    expect(contentSection).toContain('this.contentApp.use(createPreviewProxyMiddleware(');
    expect(contentSection).toContain('this.contentApp.use(deployProxy)');
    expect(contentSection).toContain("this.contentApp.use('/deploy/', deployProxy)");
  });

  it('the content listener mounts NO control-plane route', () => {
    // The whole point: a document served here has no same-origin API to drive.
    expect(contentSection).not.toMatch(/this\.contentApp\.(get|post|put|delete)\(\s*'\/projects/);
    expect(contentSection).not.toMatch(/this\.contentApp\.(get|post|put|delete)\(\s*'\/admin/);
    expect(contentSection).not.toContain('createJwtAuthMiddleware');
    expect(contentSection).not.toContain('cookieParser');
  });

  it('the control listener mounts no content proxy', () => {
    expect(controlSection).not.toContain('createPreviewProxyMiddleware');
    expect(controlSection).not.toContain('deployProxy');
  });

  it('every /projects and /admin route is on the control listener', () => {
    const routeMounts = [...SRC.matchAll(/this\.(app|contentApp)\.(get|post|put|delete)\('(\/[^']*)'/g)];
    const managed = routeMounts.filter(m => m[3].startsWith('/projects') || m[3].startsWith('/admin'));
    expect(managed.length).toBeGreaterThan(10); // sanity: the API is actually here
    for (const m of managed) expect(m[1]).toBe('app');
  });

  it('the WebSocket upgrade handler is on the content listener', () => {
    expect(SRC).toContain("this.contentServer.on('upgrade'");
    expect(SRC).not.toContain("this.server.on('upgrade'");
  });

  it('both listeners are started and both are closed', () => {
    expect(SRC).toContain('this.contentServer = this.contentApp.listen(');
    expect(SRC).toContain('this.server = this.app.listen(');
    expect(SRC).toContain("[['content', this.contentServer], ['control', this.server]]");
  });

  it('the control listener carries the same-origin guard', () => {
    expect(controlSection).toContain('createSameOriginGuard()');
  });
});

describe('PreviewServer control middleware order (M-010)', () => {
  it('authentication is mounted before the 50 MB JSON parser', () => {
    const jwtAt = controlSection.indexOf('createJwtAuthMiddleware');
    const jsonAt = controlSection.indexOf("express.json({ limit: '50mb' })");
    expect(jwtAt).toBeGreaterThan(-1);
    expect(jsonAt).toBeGreaterThan(-1);
    expect(jwtAt).toBeLessThan(jsonAt);
  });

  it('cookie-parser precedes authentication (the cookie is the credential)', () => {
    expect(controlSection.indexOf('cookieParser()')).toBeLessThan(
      controlSection.indexOf('createJwtAuthMiddleware'),
    );
  });

  it('no second, public body parser was added to work around the ordering', () => {
    expect(controlSection.match(/express\.json\(/g)).toHaveLength(1);
    expect(contentSection).not.toContain('express.json(');
  });
});

/**
 * The split's INFRA half must be self-diagnosing: when the wildcard content
 * hosts are still ingress-routed at the control port, every preview/deploy
 * page silently 404'd with the generic catch-all. The control catch-all now
 * answers 421 with the diagnosis for content hosts — WITHOUT re-mounting any
 * content proxy there (that would regress H-NEW-001).
 */
describe('catch-all misroute diagnosis (origin split, infra half)', () => {
  const ENV = ['ANT_PREVIEW_BASE_DOMAIN', 'ANT_DEPLOY_BASE_DOMAIN'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.ANT_PREVIEW_BASE_DOMAIN = 'ant-preview.example.test';
    process.env.ANT_DEPLOY_BASE_DOMAIN = 'ant-deploy.example.test';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  const proto: any = PreviewServer.prototype;
  function harness() {
    const self: any = {
      contentHostKind: proto.contentHostKind,
      lastMisrouteWarnAt: new Map(),
      warnThrottled: vi.fn(),
    };
    return {
      self,
      run(listener: 'content' | 'control', host: string, xfh?: string) {
        const req: any = { url: '/', headers: { host, ...(xfh ? { 'x-forwarded-host': xfh } : {}) } };
        const captured: any = { status: undefined, body: undefined };
        const res: any = {
          status(code: number) { captured.status = code; return this; },
          json(body: any) { captured.body = body; return this; },
        };
        proto.notFoundHandler.call(self, listener)(req, res);
        return captured;
      },
    };
  }

  it('a content host on the CONTROL listener → 421 with the ingress diagnosis, logged', () => {
    const h = harness();
    const out = h.run('control', 'my-app.ant-preview.example.test');
    expect(out.status).toBe(421);
    expect(out.body.message).toContain('content port');
    expect(h.self.warnThrottled).toHaveBeenCalledTimes(1);
  });

  it('a deploy host on the CONTROL listener → 421 too', () => {
    const h = harness();
    expect(h.run('control', 'my-app.ant-deploy.example.test').status).toBe(421);
  });

  it('the BARE control host keeps the plain 404 (it is not a content host)', () => {
    const h = harness();
    const out = h.run('control', 'ant-preview.example.test');
    expect(out.status).toBe(404);
    expect(out.body.message).toBe('Preview endpoint not found');
  });

  it('an unrelated host on the control listener keeps the plain 404, unlogged', () => {
    const h = harness();
    expect(h.run('control', 'scanner.example.org').status).toBe(404);
    expect(h.self.warnThrottled).not.toHaveBeenCalled();
  });

  it('a content host missing every proxy on the CONTENT listener 404s but logs the miss', () => {
    const h = harness();
    const out = h.run('content', 'my-app.ant-deploy.example.test');
    expect(out.status).toBe(404);
    expect(h.self.warnThrottled).toHaveBeenCalledTimes(1);
  });

  it('X-Forwarded-Host wins over Host for the host judgement', () => {
    const h = harness();
    const out = h.run('control', '10.0.0.5:4102', 'my-app.ant-preview.example.test');
    expect(out.status).toBe(421);
  });

  it('path routing mode never answers 421', () => {
    delete process.env.ANT_PREVIEW_BASE_DOMAIN;
    delete process.env.ANT_DEPLOY_BASE_DOMAIN;
    const h = harness();
    expect(h.run('control', 'my-app.ant-preview.example.test').status).toBe(404);
  });
});

describe('listener port SSOT', () => {
  const KEYS = ['PORT', 'ANT_PREVIEW_CONTENT_PORT'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it('content defaults to control + 1', () => {
    process.env.PORT = '4102';
    expect(getPreviewControlPort()).toBe(4102);
    expect(getPreviewContentPort()).toBe(4103);
  });

  it('an explicit content port wins', () => {
    process.env.PORT = '4102';
    process.env.ANT_PREVIEW_CONTENT_PORT = '9010';
    expect(getPreviewContentPort()).toBe(9010);
  });

  it('a non-numeric override falls back to the derived port rather than 0', () => {
    process.env.PORT = '4102';
    process.env.ANT_PREVIEW_CONTENT_PORT = 'not-a-port';
    expect(getPreviewContentPort()).toBe(4103);
  });

  it('refuses to boot when the two listeners would share a port', () => {
    process.env.PORT = '4102';
    process.env.ANT_PREVIEW_CONTENT_PORT = '4102';
    expect(() => assertPreviewOriginSeparation()).toThrow(/must differ from PORT/);
  });

  it('passes when they differ', () => {
    process.env.PORT = '4102';
    expect(() => assertPreviewOriginSeparation()).not.toThrow();
  });
});
