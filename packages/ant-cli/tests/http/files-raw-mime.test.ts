/**
 * `files-raw` content types — a design handoff bundle is browsed as a mini
 * static site.
 *
 * `screens/home.html` links `../styles.css`, which `@import`s `tokens/*.css`.
 * The endpoint only knew image extensions, so every stylesheet came back as
 * `application/octet-stream` — refused outright by strict MIME checking, which
 * left each `var(--…)` at `initial` (collapsed layout, invisible text) with no
 * error signal anywhere. HTML additionally needs script-blocking headers: the
 * bytes are LLM-authored and served inline on the app origin.
 *
 * Real Express app on port 0 called via fetch — same shape as
 * tests/http/files-routes-feature-slug.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';

import { createFilesRoutes } from '../../src/periphery/adapters/http/routes/files.routes';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { FileOperationService } from '../../src/periphery/adapters/http/services/ProjectService/FileOperationService';

const PROJECT_ID = 'p1';
const FEATURE = 'main';
const ORG = 'o1';
const USER = 'u1';
const BUNDLE = 'visual/ui/handoff';

describe('files.routes — files-raw content types', () => {
  let tmpWorkspaces: string;
  let server: http.Server;
  let baseUrl: string;

  const rawUrl = (rel: string) =>
    `${baseUrl}/projects/${PROJECT_ID}/features/${FEATURE}/files-raw/${rel}`;

  beforeEach(async () => {
    tmpWorkspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-files-raw-mime-'));

    const resolver = new UnifiedWorkspaceResolver(tmpWorkspaces);
    const fileOps = new FileOperationService(resolver);
    const featureDir = path.join(tmpWorkspaces, ORG, USER, PROJECT_ID, 'features', FEATURE);

    await fs.mkdir(path.join(featureDir, BUNDLE, 'screens'), { recursive: true });
    await fs.mkdir(path.join(featureDir, BUNDLE, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(featureDir, BUNDLE, 'screens', 'home.html'),
      '<!doctype html>\n<html><head><link rel="stylesheet" href="../styles.css"></head><body></body></html>',
    );
    await fs.writeFile(path.join(featureDir, BUNDLE, 'styles.css'), '@import url("tokens/colors.css");');
    await fs.writeFile(path.join(featureDir, BUNDLE, 'assets', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const projectService = {
      readFile: fileOps.readFile.bind(fileOps),
      writeFile: fileOps.writeFile.bind(fileOps),
      workspaceResolver: resolver,
    } as any;

    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(createFilesRoutes({ projectService }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpWorkspaces, { recursive: true, force: true });
  });

  it('serves a stylesheet as text/css so strict MIME checking accepts it', async () => {
    const res = await fetch(rawUrl(`${BUNDLE}/styles.css`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/css/);
  });

  it('serves html as text/html', async () => {
    const res = await fetch(rawUrl(`${BUNDLE}/screens/home.html`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
  });

  it('blocks scripts on html responses without blocking sibling css / inline style / images', async () => {
    const res = await fetch(rawUrl(`${BUNDLE}/screens/home.html`));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toContain('script-src');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('leaves non-html responses without the html-only headers', async () => {
    const res = await fetch(rawUrl(`${BUNDLE}/styles.css`));
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('keeps the existing image behaviour', async () => {
    const res = await fetch(rawUrl(`${BUNDLE}/assets/mark.svg`));
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
  });

  it('still falls back to octet-stream for unknown extensions', async () => {
    await fs.writeFile(
      path.join(tmpWorkspaces, ORG, USER, PROJECT_ID, 'features', FEATURE, BUNDLE, 'notes.xyz'),
      'x',
    );
    const res = await fetch(rawUrl(`${BUNDLE}/notes.xyz`));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });
});
