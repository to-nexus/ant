/**
 * Regression: downloading a DIRECTORY from a workspace (universal) project.
 *
 * The universal artifacts panel used to call its own
 * `GET /projects/:id/universal/artifacts/file`, which 404'd every directory
 * (`{"error":"Artifact not found: sessions"}`) — the grafted `sessions` row
 * advertises `download: true`, so the menu item existed and never worked.
 *
 * The fix points the panel at the download route that already handles this:
 * `GET /projects/:id/features/:feature/download` resolves the universal
 * pseudo-feature through `resolveFeatureScopedFilePath` → the container's
 * merged view, and zip-streams directories. This test pins that seam.
 *
 * No supertest: a real Express app + node:http on port 0, called via fetch
 * (mirrors tests/http/files-routes-feature-slug.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';
import { UNIVERSAL_FEATURE } from '@ant/shared';

import { createFilesRoutes } from '../../src/periphery/adapters/http/routes/files.routes';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { ensureUniversalContainer } from '../../src/core/customAgents/universalContainer';

const PROJECT_ID = 'ws1';
const ORG = 'o1';
const USER = 'u1';
const AGENT_ID = 'researcher';
const JOB_ID = 'deep-dive';
const SESSION_BODY = '{"messages":[]}';

/** Entry names of a zip, read straight from the local file headers. */
function zipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue; // local file header
    const nameLen = buf.readUInt16LE(i + 26);
    names.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf-8'));
  }
  return names;
}

describe('features/:feature/download — universal (workspace) project', () => {
  let tmpWorkspaces: string;
  let projectPath: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpWorkspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-universal-dl-'));
    projectPath = path.join(tmpWorkspaces, ORG, USER, PROJECT_ID);

    // config.json is what flips the universal seam on (isUniversalProject).
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectType: 'universal' }),
      'utf-8',
    );
    ensureUniversalContainer(projectPath);

    const sessionsDir = path.join(projectPath, 'universal', 'sessions');
    await fs.mkdir(path.join(sessionsDir, AGENT_ID), { recursive: true });
    await fs.writeFile(path.join(sessionsDir, AGENT_ID, `${JOB_ID}.json`), SESSION_BODY, 'utf-8');
    await fs.writeFile(path.join(sessionsDir, 'chat.jsonl'), '{"role":"user"}\n', 'utf-8');

    const resolver = new UnifiedWorkspaceResolver(tmpWorkspaces);
    const projectService = { workspaceResolver: resolver } as any;

    const app = express();
    app.use(express.json());
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
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpWorkspaces, { recursive: true, force: true });
  });

  const download = (relPath: string) =>
    fetch(
      `${baseUrl}/projects/${PROJECT_ID}/features/${UNIVERSAL_FEATURE}/download?path=${encodeURIComponent(relPath)}`,
    );

  it('sessions (directory) streams a zip carrying the session files', async () => {
    const res = await download('sessions');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('sessions.zip');

    // The archiver filter drops nested `sessions/` entries; here the target IS
    // sessions, so entries are agent-keyed and must survive.
    const names = zipEntryNames(Buffer.from(await res.arrayBuffer()));
    expect(names).toContain(`${AGENT_ID}/${JOB_ID}.json`);
    expect(names).toContain('chat.jsonl');
  });

  it('plan (canonical artifacts directory) streams a zip', async () => {
    const res = await download('plan');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });

  it('a single session file streams its bytes', async () => {
    const res = await download(`sessions/${AGENT_ID}/${JOB_ID}.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(`${JOB_ID}.json`);
    expect(await res.text()).toBe(SESSION_BODY);
  });

  it('a missing path is 404', async () => {
    const res = await download('nope.md');
    expect(res.status).toBe(404);
  });
});
