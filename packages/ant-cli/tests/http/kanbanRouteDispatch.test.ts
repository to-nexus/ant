/**
 * Kanban GET single-owner dispatch — `GET /projects/:id/features/:feature/kanban`.
 *
 * Regression locks for the route-shadowing defect: the features router's
 * per-jobId handler used to shadow the separate `?job=` board route (mounted
 * later on the same path), so every jobType board fetch 400'd and the FE
 * silently swallowed it into an empty board. The two contracts now live in
 * ONE handler that dispatches on query shape:
 *   - no `jobId` → Branch A: jobType board via KanbanService.getKanbanData
 *   - `jobId=`   → Branch B: per-jobId restore (live → session snapshot → empty)
 *
 * Also locks the user-stop restore contract: a sealed (Redis-absent) job stays
 * restorable from `runs[].kanbanSnapshot`, including `interruption.canResume`.
 *
 * No supertest: a real Express app + node:http server on port 0, called via fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  jobStatus: any = null;
  async listJobsByFeature(): Promise<any[]> {
    return this.jobs;
  }
  async getJobStatus(): Promise<any> {
    return this.jobStatus;
  }
}

async function writeSession(featurePath: string, jobType: string, runs: any[]): Promise<void> {
  const file = getSessionFilePathByJob(featurePath, jobType);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ runs }), 'utf-8');
}

describe('GET /projects/:id/features/:feature/kanban — single-owner dispatch', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let stateStore: FakeStateStore;
  let getKanbanData: ReturnType<typeof vi.fn>;

  const stubBoard = {
    jobId: 'live-1',
    todo: [{ id: 't1' }],
    inProgress: [],
    completed: [],
    isEstimating: false,
    dataSource: 'session',
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-kanban-route-'));
    stateStore = new FakeStateStore();
    getKanbanData = vi.fn(async () => stubBoard);

    const app = express();
    app.use(express.json());
    app.use(
      createFeaturesRoutes({
        projectService: {} as any,
        kanbanService: { getKanbanData } as any,
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

  describe('Branch A — jobType board (?job=)', () => {
    it('serves the jobType board with 200 (route-shadowing regression)', async () => {
      const res = await fetch(`${baseUrl}/projects/p1/features/f1/kanban?job=design`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobId).toBe('live-1');
      expect(getKanbanData).toHaveBeenCalledTimes(1);
      const args = getKanbanData.mock.calls[0];
      expect(args[0]).toBe('p1');
      expect(args[1]).toBe('f1');
      expect(args[2]).toBe('design');
      expect(args[3]).toBeUndefined();
      expect(args[4]).toBeUndefined();
      expect(args[5]).toBeUndefined();
    });

    it('defaults to code when no params are given', async () => {
      const res = await fetch(`${baseUrl}/projects/p1/features/f1/kanban`);
      expect(res.status).toBe(200);
      expect(getKanbanData.mock.calls[0][2]).toBe('code');
    });

    it('400s on an invalid job type', async () => {
      const res = await fetch(`${baseUrl}/projects/p1/features/f1/kanban?job=bogus`);
      expect(res.status).toBe(400);
      expect(getKanbanData).not.toHaveBeenCalled();
    });
  });

  describe('Branch B — per-jobId restore (?jobId=)', () => {
    it('serves runs[].kanbanSnapshot from the session file', async () => {
      await writeSession(tmpDir, 'design', [
        {
          jobId: 'design-old',
          status: 'canceled',
          kanbanSnapshot: {
            jobId: 'design-old',
            todo: [{ id: 'a' }],
            inProgress: [],
            completed: [],
            isEstimating: false,
            dataSource: 'session',
            jobType: 'design',
            interruption: { reason: 'user_stopped', canResume: true },
          },
        },
      ]);

      const res = await fetch(
        `${baseUrl}/projects/p1/features/f1/kanban?jobId=design-old&type=design`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobId).toBe('design-old');
      expect(body.todo).toHaveLength(1);
      // user-stop restore contract: canResume survives the seal via the snapshot
      expect(body.interruption?.reason).toBe('user_stopped');
      expect(body.interruption?.canResume).toBe(true);
    });

    it('falls back to an empty board when no snapshot exists', async () => {
      const res = await fetch(
        `${baseUrl}/projects/p1/features/f1/kanban?jobId=ghost&type=design`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobId).toBe('ghost');
      expect(body.todo).toHaveLength(0);
      expect(body.jobType).toBe('design');
    });

    it('400s on an invalid type', async () => {
      const res = await fetch(
        `${baseUrl}/projects/p1/features/f1/kanban?jobId=x&type=bogus`,
      );
      expect(res.status).toBe(400);
    });
  });
});
