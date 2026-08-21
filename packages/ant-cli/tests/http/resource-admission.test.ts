/**
 * Resource admission — one axis, one row per case.
 *
 * Four findings, one shape: an endpoint that proves WHOSE data it is but never how
 * much work it is. Ownership and path containment passed on every request while a
 * single authenticated account held megabytes of multipart buffers, recursive tree
 * scans and ZIP streams open in parallel on the shared pod
 * (M-007, H-008, M-009, M-NEW-004).
 *
 * Each row asserts a budget, and each budget's counterpart row asserts that a
 * normal-sized request is untouched — a limit that breaks ordinary use is not a fix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import http from 'node:http';

import { boundedMultipart, __testing as multipartTesting } from '../../src/periphery/adapters/http/middleware/boundedMultipart';
import { measureArchiveInput } from '../../src/periphery/adapters/http/routes/helpers/featureFiles';
import {
  buildUniversalMergedTreeResult,
  UNIVERSAL_TREE_MAX_ENTRIES,
} from '../../src/core/customAgents/universalContainer';
import { UPLOAD_LIMITS } from '../../src/core/config/uploadLimits';
import multer from 'multer';

// ────────────────────────────────────────────────────────────────────────────
// M-007 — multipart request budget
// ────────────────────────────────────────────────────────────────────────────

/** Atomic slot set, matching the Redis Lua contract. */
class SlotStore {
  private slots = new Map<string, Map<string, number>>();
  async reserveSlot(key: string, member: string, limit: number, ttl: number) {
    const now = Date.now();
    const set = this.slots.get(key) ?? new Map<string, number>();
    this.slots.set(key, set);
    for (const [m, exp] of set) if (exp <= now) set.delete(m);
    if (!set.has(member) && set.size >= limit) return false;
    set.set(member, now + ttl * 1000);
    return true;
  }
  async releaseSlot(key: string, member: string) { this.slots.get(key)?.delete(member); }
  async refreshSlot() {}
  async countSlots(key: string) { return this.slots.get(key)?.size ?? 0; }
}

describe('boundedMultipart — whole-request byte budget (M-007)', () => {
  const MAX = 4096;
  let server: http.Server;
  let baseUrl: string;
  let store: SlotStore;

  beforeEach(async () => {
    multipartTesting.resetStateStoreCache();
    store = new SlotStore();
    const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: 'u1' };
      (req as any).organization = { id: 'o1' };
      next();
    });
    app.post(
      '/upload',
      ...boundedMultipart({ stateStore: store as any, maxBytes: MAX, maxInFlight: 1 }),
      upload.array('files'),
      (req, res) => { res.json({ count: (req.files as unknown[])?.length ?? 0 }); },
    );
    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const form = (sizes: number[]) => {
    const f = new FormData();
    sizes.forEach((size, i) => f.append('files', new Blob([new Uint8Array(size)]), `f${i}.bin`));
    return f;
  };

  it('accepts a request under the budget', async () => {
    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form([512, 512]) });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(2);
  });

  it('refuses on declared Content-Length before reading a byte', async () => {
    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form([MAX * 2]) });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('UPLOAD_REQUEST_TOO_LARGE');
  });

  it('refuses many small files whose SUM exceeds the budget', async () => {
    // The per-file cap would pass every one of these; only the aggregate catches it.
    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form(Array(12).fill(500)) });
    expect(res.status).toBe(413);
  });

  it('refuses a chunked body with no declared length, on the stream itself', async () => {
    // `Content-Length` is absent, so only the streaming counter can catch this.
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 8; i++) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });
    const res = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----x' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(res.status).toBe(413);
  });

  it('bounds simultaneous uploads per account', async () => {
    // Occupy the single slot with a body that never completes.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = new ReadableStream({
      async start(controller) {
        controller.enqueue(new Uint8Array(16));
        await gate;
        controller.close();
      },
    });
    const first = fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----x' },
      body: slow,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await new Promise(r => setTimeout(r, 50));
    const second = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form([16]) });
    expect(second.status).toBe(429);
    expect((await second.json()).code).toBe('UPLOAD_CONCURRENCY_LIMIT');

    release();
    await first.catch(() => {});
  });

  it('frees the slot once a request completes', async () => {
    expect((await fetch(`${baseUrl}/upload`, { method: 'POST', body: form([16]) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/upload`, { method: 'POST', body: form([16]) })).status).toBe(200);
  });
});

describe('boundedMultipart — pod-wide in-flight byte ceiling across accounts (M-007)', () => {
  const MAX = 4096;      // per-request budget
  const POD_MAX = 6000;  // pod-wide ceiling — smaller than 2× per-request
  let server: http.Server;
  let baseUrl: string;
  let account = 'a';

  beforeEach(async () => {
    multipartTesting.resetStateStoreCache();
    multipartTesting.resetPodInflight();
    const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });
    const app = express();
    app.use((req, _res, next) => {
      // Each request presents a DIFFERENT account — the per-account slot never
      // fires; only the pod-wide ceiling can bound the convergence.
      (req as any).user = { id: `u-${account}` };
      (req as any).organization = { id: `o-${account}` };
      next();
    });
    app.post(
      '/upload',
      // No stateStore → per-account slot is skipped; isolate the pod ceiling.
      ...boundedMultipart({ maxBytes: MAX, podMaxBytes: POD_MAX }),
      upload.array('files'),
      (req, res) => { res.json({ count: (req.files as unknown[])?.length ?? 0 }); },
    );
    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    multipartTesting.resetPodInflight();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const slowForm = () => {
    // A body that pauses mid-flight so its reservation is still held when the
    // next request's admission runs.
    return new ReadableStream({
      async start(controller) {
        controller.enqueue(new Uint8Array(16));
        await new Promise(r => setTimeout(r, 200));
        controller.close();
      },
    });
  };

  it('refuses a second account once the pod ceiling is reserved, and frees it after', async () => {
    account = 'a';
    const first = fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----x', 'Content-Length': String(MAX) },
      body: slowForm(),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await new Promise(r => setTimeout(r, 50));
    // A different account: per-account slot cannot bound it — only the pod cap.
    // First reserved MAX(4096); a second MAX(4096) would exceed POD_MAX(6000).
    account = 'b';
    const second = new FormData();
    second.append('files', new Blob([new Uint8Array(2048)]), 'f.bin');
    const secondRes = await fetch(`${baseUrl}/upload`, { method: 'POST', body: second });
    expect(secondRes.status).toBe(429);
    expect((await secondRes.json()).code).toBe('UPLOAD_POD_BUSY');

    await first.catch(() => {});
    // After the first completes its reservation is released; a new one is admitted.
    account = 'c';
    const third = new FormData();
    third.append('files', new Blob([new Uint8Array(512)]), 'f.bin');
    expect((await fetch(`${baseUrl}/upload`, { method: 'POST', body: third })).status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// H-008 — artifact tree enumeration budget
// ────────────────────────────────────────────────────────────────────────────

describe('universal artifact tree enumeration budget (H-008)', () => {
  let container: string;
  let artifacts: string;

  beforeEach(() => {
    container = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-tree-budget-'));
    artifacts = path.join(container, 'artifacts');
    fs.mkdirSync(artifacts, { recursive: true });
    fs.mkdirSync(path.join(container, 'sessions'), { recursive: true });
  });

  afterEach(() => fs.rmSync(container, { recursive: true, force: true }));

  const write = (dir: string, count: number, prefix: string) => {
    for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `${prefix}${i}.txt`), '');
  };

  it('returns a normal small tree untruncated', () => {
    write(artifacts, 5, 'f');
    const result = buildUniversalMergedTreeResult(container);
    expect(result.truncated).toBe(false);
    expect(result.nodes.some(n => n.name === 'f0.txt')).toBe(true);
  });

  it('marks the RESPONSE root truncated when the artifacts root alone exhausts the budget', () => {
    // The failure mode being closed: with everything in one wide directory there is
    // no parent node to carry a `truncated` flag, so the response looked complete.
    write(artifacts, UNIVERSAL_TREE_MAX_ENTRIES + 10, 'w');
    const result = buildUniversalMergedTreeResult(container);
    expect(result.truncated).toBe(true);
  });

  it('caps the number of returned nodes at the budget', () => {
    write(artifacts, UNIVERSAL_TREE_MAX_ENTRIES + 10, 'w');
    const files = buildUniversalMergedTreeResult(container).nodes.filter(n => n.type === 'file');
    expect(files.length).toBeLessThanOrEqual(UNIVERSAL_TREE_MAX_ENTRIES);
  });

  it('charges hidden entries against the budget so a dotfile flood cannot bypass it', () => {
    // Hidden files are excluded from the RESULT, so a per-result budget would let an
    // account enumerate unlimited entries by hiding them. They are charged as they
    // are read instead: the budget is exhausted and the response says so, even
    // though almost nothing is returned.
    write(artifacts, UNIVERSAL_TREE_MAX_ENTRIES + 50, '.hidden');
    write(artifacts, 20, 'visible');
    const result = buildUniversalMergedTreeResult(container);
    expect(result.truncated).toBe(true);
    // Everything returned came out of the same exhausted budget.
    expect(result.nodes.length).toBeLessThanOrEqual(UNIVERSAL_TREE_MAX_ENTRIES);
  });

  it('control: the same visible files all come back without the flood', () => {
    write(artifacts, 20, 'visible');
    const result = buildUniversalMergedTreeResult(container);
    expect(result.truncated).toBe(false);
    expect(result.nodes.filter(n => n.name.startsWith('visible'))).toHaveLength(20);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M-NEW-004 — directory download preflight
// ────────────────────────────────────────────────────────────────────────────

describe('measureArchiveInput — directory download preflight (M-NEW-004)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-zip-preflight-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('passes a normal directory', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'x'.repeat(100));
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'y'.repeat(100));
    const result = await measureArchiveInput(root, { maxEntries: 100, maxBytes: 10_000 });
    expect(result.exceeded).toBe(false);
    expect(result.entries).toBe(3); // a.txt, sub, sub/b.txt
    expect(result.bytes).toBe(200);
  });

  it('refuses on entry count', async () => {
    for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(root, `f${i}`), '');
    expect((await measureArchiveInput(root, { maxEntries: 10, maxBytes: 1e9 })).exceeded).toBe(true);
  });

  it('refuses on raw bytes', async () => {
    fs.writeFileSync(path.join(root, 'big'), 'x'.repeat(5000));
    expect((await measureArchiveInput(root, { maxEntries: 1000, maxBytes: 1000 })).exceeded).toBe(true);
  });

  it('stops early rather than measuring the whole tree', async () => {
    for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(root, `f${i}`), '');
    const result = await measureArchiveInput(root, { maxEntries: 5, maxBytes: 1e9 });
    expect(result.exceeded).toBe(true);
    // Measuring a huge tree must not itself be the expensive operation.
    expect(result.entries).toBeLessThanOrEqual(6);
  });

  it('skips top-level sessions/, matching the archive filter', async () => {
    fs.mkdirSync(path.join(root, 'sessions'));
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(root, 'sessions', `s${i}`), 'x'.repeat(1000));
    fs.writeFileSync(path.join(root, 'keep.txt'), 'x');
    const result = await measureArchiveInput(root, { maxEntries: 10, maxBytes: 2000 });
    expect(result.exceeded).toBe(false);
    expect(result.entries).toBe(1);
  });

  it('does not follow symlinks out of the tree', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-zip-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'huge'), 'x'.repeat(5000));
      fs.symlinkSync(outside, path.join(root, 'link'));
      const result = await measureArchiveInput(root, { maxEntries: 100, maxBytes: 1000 });
      expect(result.exceeded).toBe(false);
      expect(result.bytes).toBe(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M-009 — forced tree refresh single-flight
// ────────────────────────────────────────────────────────────────────────────

describe('force=true tree refresh is single-flight (M-009)', () => {
  let server: http.Server;
  let baseUrl: string;
  let scans: number;
  let store: any;

  beforeEach(async () => {
    scans = 0;
    const locks = new Map<string, string>();
    const cache = new Map<string, unknown>();
    store = {
      async getFileTreeCache(userId: string, projectId: string, feature: string) {
        return cache.get(`${userId}:${projectId}:${feature}`) ?? null;
      },
      async setFileTreeCache(userId: string, projectId: string, feature: string, tree: unknown) {
        cache.set(`${userId}:${projectId}:${feature}`, tree);
      },
      async tryAcquireLock(key: string, value: string) {
        if (locks.has(key)) return false;
        locks.set(key, value);
        return true;
      },
      async releaseLockIfOwner(key: string, value: string) {
        if (locks.get(key) === value) locks.delete(key);
      },
    };

    const projectService = {
      // A scan slow enough that a concurrent request must decide what to do.
      async getFileTree() {
        scans += 1;
        await new Promise(r => setTimeout(r, 120));
        return [{ name: 'plan', path: 'plan', type: 'directory', children: [] }];
      },
      resolveExistingFeatureForMutation: async () => '/tmp/nope',
      workspaceResolver: { getFeaturePath: () => '/tmp/nope' },
    } as any;

    const { createFilesRoutes } = await import('../../src/periphery/adapters/http/routes/files.routes');
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: 'u1' };
      (req as any).organization = { id: 'o1', kind: 'team' };
      next();
    });
    app.use(createFilesRoutes({ projectService, stateStore: store }));
    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const get = (query = '') => fetch(`${baseUrl}/projects/p1/features/main/files${query}`);

  it('a single forced refresh scans once and returns the tree', async () => {
    const res = await get('?force=true');
    expect(res.status).toBe(200);
    expect(scans).toBe(1);
  });

  it('concurrent forced refreshes of the same scope run ONE scan', async () => {
    const results = await Promise.all([get('?force=true'), get('?force=true'), get('?force=true')]);
    expect(scans).toBe(1);
    // The losers waited for the owner's cache rather than starting their own scan.
    for (const r of results) expect(r.status).toBe(200);
  });

  it('a normal read is served from the cache the forced scan wrote', async () => {
    await get('?force=true');
    const before = scans;
    expect((await get()).status).toBe(200);
    expect(scans).toBe(before);
  });

  it('a cold normal read still scans (the limiter must not break first load)', async () => {
    expect((await get()).status).toBe(200);
    expect(scans).toBe(1);
  });
});
