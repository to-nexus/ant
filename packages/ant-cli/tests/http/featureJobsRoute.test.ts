/**
 * Feature-wide job list — `GET /projects/:id/features/:feature/jobs`.
 *
 * The endpoint used to filter by `?type=`; the dropdown is now cross-type, so
 * the route returns every board-bearing job of the feature (code/design/learn)
 * in one list, each entry tagged with its own `type`. Locks:
 *   - no `?type=` → mixed-type entries (code + design) merged from Redis (live)
 *     and the per-type session files.
 *   - `?type=code` → still narrows to that type (back-compat).
 *   - plan/visual session files are NOT surfaced (no kanban board).
 *
 * No supertest: a real Express app + node:http server on port 0, called via fetch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';

import { createFeaturesRoutes } from '../../src/periphery/adapters/http/routes/features.routes';
import { getSessionFilePathByJob } from '../../src/core/utils/sessionPaths';
import type { StateStorePort } from '../../src/core/ports/stateStore';

class FakeStateStore implements Partial<StateStorePort> {
  jobs: any[] = [];
  async listJobsByFeature(): Promise<any[]> {
    return this.jobs;
  }
}

async function writeSession(featurePath: string, jobType: string, runs: any[]): Promise<void> {
  const file = getSessionFilePathByJob(featurePath, jobType);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ runs }), 'utf-8');
}

describe('GET /projects/:id/features/:feature/jobs — feature-wide', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let stateStore: FakeStateStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-jobs-route-'));
    stateStore = new FakeStateStore();

    const app = express();
    app.use(express.json());
    app.use(
      createFeaturesRoutes({
        projectService: {} as any,
        stateStore: stateStore as unknown as StateStorePort,
        workspaceResolver: { getFeaturePath: () => tmpDir },
      }),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns mixed-type entries (code + design) when no type is given', async () => {
    await writeSession(tmpDir, 'code', [
      { jobId: 'code-1', timestamp: '2026-06-10T00:00:00.000Z', status: 'completed' },
    ]);
    await writeSession(tmpDir, 'design', [
      { jobId: 'design-1', timestamp: '2026-06-11T00:00:00.000Z', status: 'completed' },
    ]);

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(body.jobs.map((j: any) => [j.jobId, j.type]));
    expect(byId['code-1']).toBe('code');
    expect(byId['design-1']).toBe('design');
  });

  it('includes a LIVE Redis job tagged with its own type', async () => {
    stateStore.jobs = [
      { jobId: 'code-live', type: 'code', status: 'running', timestamp: '2026-06-12T00:00:00.000Z' },
    ];
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    const body = await res.json();
    const live = body.jobs.find((j: any) => j.jobId === 'code-live');
    expect(live).toBeTruthy();
    expect(live.type).toBe('code');
    expect(live.live).toBe(true);
  });

  it('narrows to a single type when ?type= is given (back-compat)', async () => {
    await writeSession(tmpDir, 'code', [
      { jobId: 'code-1', timestamp: '2026-06-10T00:00:00.000Z', status: 'completed' },
    ]);
    await writeSession(tmpDir, 'design', [
      { jobId: 'design-1', timestamp: '2026-06-11T00:00:00.000Z', status: 'completed' },
    ]);

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs?type=code`);
    const body = await res.json();
    const ids = body.jobs.map((j: any) => j.jobId);
    expect(ids).toContain('code-1');
    expect(ids).not.toContain('design-1');
  });

  it('does not surface plan/visual session files (no kanban board)', async () => {
    await writeSession(tmpDir, 'plan', [
      { jobId: 'plan-1', timestamp: '2026-06-10T00:00:00.000Z', status: 'completed' },
    ]);
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    const body = await res.json();
    expect(body.jobs.find((j: any) => j.jobId === 'plan-1')).toBeUndefined();
  });
});
