/**
 * Locks the two serving PROFILES of `createStaticApp` — the single owner shared
 * by the deploy SPA server and the preview static server.
 *
 * The axis is the profile truth table (cache × fallback × basePath), not any
 * particular byte of HTML: a preview serves a live source directory (no cache,
 * honest 404s for missing assets) while a deploy serves an immutable SPA build
 * (cached, every unmatched path is a client-side route).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStaticApp, type StaticAppOptions } from '../../src/infrastructure/static/staticApp';

let root: string;
const servers: Server[] = [];

async function serve(options: Omit<StaticAppOptions, 'root'> & { root?: string }): Promise<string> {
  const app = createStaticApp({ root, ...options } as StaticAppOptions);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

const html = { Accept: 'text/html,application/xhtml+xml' };

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>site</h1>');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
});
afterAll(async () => {
  await Promise.all(servers.map(s => new Promise<void>(r => s.close(() => r()))));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('preview profile (cache: none, fallback: navigation-only)', () => {
  const preview = { basePath: '/t--u--p--f', cache: 'none', fallback: 'navigation-only' } as const;

  it('serves files under the basePath the proxy forwards verbatim', async () => {
    const base = await serve(preview);
    const res = await fetch(`${base}${preview.basePath}/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('never caches — a code job rewrites these files between requests', async () => {
    const base = await serve(preview);
    const res = await fetch(`${base}${preview.basePath}/index.html`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers `/` so the health check sees a live server', async () => {
    const base = await serve(preview);
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(preview.basePath);
  });

  it('an HTML navigation falls back to index.html', async () => {
    const base = await serve(preview);
    const res = await fetch(`${base}${preview.basePath}/about`, { headers: html });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>site</h1>');
  });

  it('a missing ASSET 404s instead of coming back as HTML', async () => {
    const base = await serve(preview);
    expect((await fetch(`${base}${preview.basePath}/typo.css`)).status).toBe(404);
  });

  it('refuses dotfiles — the preview root can hold a written .env', async () => {
    const base = await serve(preview);
    const res = await fetch(`${base}${preview.basePath}/.env`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET');
  });
});

/**
 * audit-8 static-serve regression: express.static / `send` reject a lexical `..`
 * but do NO realpath check, so an in-root symlink pointing OUT of root is
 * followed and served. `root` is a live tenant workspace (preview) or a deploy
 * snapshot that preserves symlinks, and a deploy defaults to public — so a
 * planted link would leak host/other-tenant files. The serve app refuses any
 * request whose realpath escapes root.
 */
describe('symlink containment (audit-8 static-serve regression)', () => {
  let linkRoot: string;
  let outside: string;

  beforeAll(() => {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ant-static-link-'));
    linkRoot = path.join(parent, 'docroot');
    outside = path.join(parent, 'outside');
    fs.mkdirSync(linkRoot, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(linkRoot, 'index.html'), '<h1>site</h1>');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'HOST-SECRET');
    // A file symlink and a directory symlink, both escaping the doc root.
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(linkRoot, 'leak.txt'));
    fs.symlinkSync(outside, path.join(linkRoot, 'jump'));
  });

  it('refuses a leaf symlink that resolves outside root', async () => {
    const base = await serve({ root: linkRoot, basePath: '/', cache: 'none', fallback: 'navigation-only' });
    const res = await fetch(`${base}/leak.txt`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('HOST-SECRET');
  });

  it('refuses a path through a directory symlink that escapes root', async () => {
    const base = await serve({ root: linkRoot, basePath: '/', cache: 'none', fallback: 'navigation-only' });
    const res = await fetch(`${base}/jump/secret.txt`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('HOST-SECRET');
  });

  it('still serves a normal in-root file', async () => {
    const base = await serve({ root: linkRoot, basePath: '/', cache: 'none', fallback: 'navigation-only' });
    const res = await fetch(`${base}/index.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>site</h1>');
  });
});

describe('deploy profile (cache: short, fallback: always-index)', () => {
  it('caches the immutable build artifact', async () => {
    const base = await serve({ basePath: '/deploy/k', cache: 'short', fallback: 'always-index' });
    const res = await fetch(`${base}/deploy/k/style.css`);
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
  });

  it('every unmatched path is a client-side route, asset extensions included', async () => {
    const base = await serve({ basePath: '/deploy/k', cache: 'short', fallback: 'always-index' });
    const res = await fetch(`${base}/deploy/k/deep/link.json`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>site</h1>');
  });

  it('refuses dotfiles too — the SPA fallback must not swallow them', async () => {
    const base = await serve({ basePath: '/deploy/k', cache: 'short', fallback: 'always-index' });
    const res = await fetch(`${base}/deploy/k/.env`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET');
  });

  it('at the host root (subdomain routing) the SPA fallback still fires', async () => {
    const base = await serve({ basePath: '/', cache: 'short', fallback: 'always-index' });
    expect((await fetch(`${base}/`)).status).toBe(200);
    const deep = await fetch(`${base}/deep/link`, { headers: html });
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<h1>site</h1>');
  });
});

describe('entryFile option (non-index static entry)', () => {
  let namedRoot: string;
  beforeAll(() => {
    namedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-static-named-'));
    fs.writeFileSync(path.join(namedRoot, 'ax-tf-weekly-report.html'), '<h1>report</h1>');
    fs.writeFileSync(path.join(namedRoot, '.env'), 'SECRET=1');
  });
  afterAll(() => {
    fs.rmSync(namedRoot, { recursive: true, force: true });
  });
  const opts = {
    basePath: '/',
    cache: 'none',
    fallback: 'navigation-only',
    entryFile: 'ax-tf-weekly-report.html',
  } as const;

  it('`/` serves the entry via the static index', async () => {
    const base = await serve({ ...opts, root: namedRoot });
    const res = await fetch(`${base}/`, { headers: html });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>report</h1>');
  });

  it('an HTML navigation falls back to the entry, and the file stays reachable at its own URL', async () => {
    const base = await serve({ ...opts, root: namedRoot });
    const nav = await fetch(`${base}/about`, { headers: html });
    expect(nav.status).toBe(200);
    expect(await nav.text()).toContain('<h1>report</h1>');
    const direct = await fetch(`${base}/ax-tf-weekly-report.html`);
    expect(direct.status).toBe(200);
  });

  it('dotfile refusal is unaffected by the entry choice', async () => {
    const base = await serve({ ...opts, root: namedRoot });
    expect((await fetch(`${base}/.env`)).status).toBe(403);
  });

  it('omitting entryFile keeps the index.html default', async () => {
    const base = await serve({ basePath: '/', cache: 'none', fallback: 'navigation-only' });
    const res = await fetch(`${base}/`, { headers: html });
    expect(await res.text()).toContain('<h1>site</h1>');
  });

  it.each([['../x.html'], ['.x.html'], ['sub/x.html']])(
    'fails closed on an entry that could escape the root or dodge the dotfile guard (%s)',
    (entryFile) => {
      expect(() =>
        createStaticApp({ root: namedRoot, basePath: '/', cache: 'none', fallback: 'navigation-only', entryFile }),
      ).toThrow(/Invalid static entry file/);
    },
  );

  it('the manifest SSOT feeds the app: staticEntryFile(dir) → served entry', async () => {
    const { staticEntryFile } = await import(
      '../../src/periphery/adapters/http/services/PreviewService/detectors/manifest'
    );
    const entry = staticEntryFile(namedRoot);
    expect(entry).toBe('ax-tf-weekly-report.html');
    const base = await serve({ basePath: '/', cache: 'none', fallback: 'navigation-only', entryFile: entry, root: namedRoot });
    const res = await fetch(`${base}/`, { headers: html });
    expect(await res.text()).toContain('<h1>report</h1>');
  });
});
