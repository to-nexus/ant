/**
 * FileSessionAdapter SSOT — three orthogonal write/read concerns:
 *
 *   1. Read-side log adapters (§16 ui_render_migration)
 *      `loadAllChat` (with sinceTs + jobTypes filters) and
 *      `loadAllBreadcrumbs` (skipping collapsed lines). The /breadcrumbs
 *      HTTP endpoint reads the latter; chat history flows through
 *      `ChatService.loadEventsAsync`, which calls `loadAllChat` internally
 *      (chat-SSOT §5).
 *
 *   2. Chapter-2 write paths (§2 atomic_user_turn_write)
 *      Covers paths that previously had no unit tests:
 *        - appendUserTurn with/without skipFeature
 *        - appendUserTurn trace-failure policy (feature SSOT preserved)
 *        - appendUserTurnMeta → loadSinceBoundary merge
 *        - appendBoundary collapses prior user_turn / user_turn_meta
 *        - FileMutex serialisation under concurrent appends
 *      Note: Hard Reset used to go through collapseAll/collapseTurn here,
 *      but it now physically unlinks the session files from the HTTP
 *      handler via clearCanonicalDirectory. Integration coverage lives
 *      in the feature-log route test instead.
 *
 *   3. SessionPersistence chat.jsonl write-side helpers (§16.2 Step 3)
 *      - findTurnIdForJob: latest user_turn for a given jobId
 *      - emitAssistantMessageLine: appends chat log line when turnId
 *        resolvable, no-op when no matching turnId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import { SessionPersistence } from '../../../src/periphery/adapters/http/services/ChatService/SessionPersistence';
import {
  getFeatureJsonlPath,
  getChatJsonlPath,
} from '../../../src/core/utils/sessionPaths';
import type {
  ChatLine,
  FeatureLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBoundaryLine,
  FeatureBreadcrumbLine,
} from '@ant/shared';
import type { UserContext } from '../../../src/core/types/user';

async function readJsonl<T = any>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Read-side log adapters (loadAllChat, loadAllBreadcrumbs)
// ════════════════════════════════════════════════════════════════════════════

describe('FileSessionAdapter — feature-log readers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fsa-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeJsonl(filePath: string, lines: (ChatLine | FeatureLine)[]) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
    await fs.writeFile(filePath, content, 'utf-8');
  }

  it('loadAllChat returns every non-collapsed line (no filters)', async () => {
    const chatLines: ChatLine[] = [
      { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hi', sourceRef: 'feature.jsonl#t-1' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hello' },
      { type: 'chat_status', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', cardId: 'c-1', statusType: 'read', metadata: { filePath: 'src/a.ts' }, collapsed: true },
      { type: 'chat_status', ts: '2026-04-20T00:00:04Z', jobId: 'j1', turnId: 't-1', jobType: 'code', cardId: 'c-2', statusType: 'file_create', metadata: { filePath: 'src/x.ts' } },
    ];
    await writeJsonl(getChatJsonlPath(tmpDir), chatLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllChat();

    expect(out.length).toBe(3);
    expect(out.map(l => l.type)).toEqual(['user_turn', 'assistant_message', 'chat_status']);
  });

  it('loadAllChat filters by sinceTs (strictly greater)', async () => {
    const chatLines: ChatLine[] = [
      { type: 'assistant_message', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'a' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'b' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'c' },
    ];
    await writeJsonl(getChatJsonlPath(tmpDir), chatLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllChat({ sinceTs: '2026-04-20T00:00:02Z' });

    expect(out.length).toBe(1);
    expect((out[0] as any).text).toBe('c');
  });

  it('loadAllChat filters by jobTypes set', async () => {
    const chatLines: ChatLine[] = [
      { type: 'assistant_message', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'a' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:02Z', jobId: 'j2', turnId: 't-2', jobType: 'design', text: 'b' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:03Z', jobId: 'j3', turnId: 't-3', jobType: 'plan', text: 'c' },
    ];
    await writeJsonl(getChatJsonlPath(tmpDir), chatLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllChat({ jobTypes: ['code', 'design'] });

    expect(out.length).toBe(2);
    expect(out.map(l => l.jobType).sort()).toEqual(['code', 'design']);
  });

  it('loadAllChat returns empty array when file missing', async () => {
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllChat();
    expect(out).toEqual([]);
  });

  it('loadAllBreadcrumbs returns only non-collapsed breadcrumb lines in append order', async () => {
    const featureLines: FeatureLine[] = [
      { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hi' },
      {
        type: 'breadcrumb',
        ts: '2026-04-20T00:00:02Z',
        jobId: 'j1',
        turnId: 't-1',
        jobType: 'code',
        scope: 'modification',
        summary: 'First breadcrumb',
        anchors: { files: ['a.ts'] },
        stats: { modified: 1 },
      },
      {
        type: 'breadcrumb',
        ts: '2026-04-20T00:00:03Z',
        jobId: 'j2',
        turnId: 't-2',
        jobType: 'code',
        scope: 'initial_creation',
        summary: 'Collapsed breadcrumb',
        anchors: {},
        stats: {},
        collapsed: true,
      },
      {
        type: 'breadcrumb',
        ts: '2026-04-20T00:00:04Z',
        jobId: 'j3',
        turnId: 't-3',
        jobType: 'code',
        scope: 'refactor',
        summary: 'Third breadcrumb',
        anchors: { paths: ['src/a'] },
        stats: { touched: 4 },
      },
      { type: 'boundary', ts: '2026-04-20T00:00:05Z', jobId: 'j3', turnId: 't-3', jobType: 'code', reason: 'auto_job_complete_todo' },
    ];
    await writeJsonl(getFeatureJsonlPath(tmpDir), featureLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllBreadcrumbs();

    expect(out.length).toBe(2);
    expect(out.map(b => b.summary)).toEqual(['First breadcrumb', 'Third breadcrumb']);
    expect(out.every(b => b.type === 'breadcrumb')).toBe(true);
  });

  it('loadAllBreadcrumbs returns empty array when file missing', async () => {
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllBreadcrumbs();
    expect(out).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Chapter 2 write paths (atomic_user_turn_write)
// ════════════════════════════════════════════════════════════════════════════

describe('FileSessionAdapter — chapter 2 write paths', () => {
  let tmpDir: string;
  let adapter: FileSessionAdapter;
  let featurePath: string;
  let tracePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fsa-writes-'));
    adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    featurePath = getFeatureJsonlPath(tmpDir);
    tracePath = getChatJsonlPath(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  it('appendUserTurn writes to both feature.jsonl and chat.jsonl by default', async () => {
    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:01Z',
      jobId: 'j1',
      turnId: 't-001',
      jobType: 'code',
      text: 'hello',
      mode: 'generate',
    };
    await adapter.appendUserTurn(line);

    const featureLines = await readJsonl<FeatureLine>(featurePath);
    const chatLines = await readJsonl<ChatLine>(tracePath);

    expect(featureLines).toHaveLength(1);
    expect(featureLines[0]).toMatchObject({ type: 'user_turn', turnId: 't-001', text: 'hello' });

    expect(chatLines).toHaveLength(1);
    expect(chatLines[0]).toMatchObject({
      type: 'user_turn',
      turnId: 't-001',
      text: 'hello',
      sourceRef: 'feature.jsonl#t-001',
    });
  });

  it('appendUserTurn with skipFeature=true writes only chat.jsonl and uses ask-only sourceRef', async () => {
    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:02Z',
      jobId: 'j2',
      turnId: 't-ask',
      jobType: 'inline-ask',
      text: 'what is this?',
    };
    await adapter.appendUserTurn(line, { skipFeature: true });

    const featureLines = await readJsonl<FeatureLine>(featurePath);
    const chatLines = await readJsonl<ChatLine>(tracePath);

    expect(featureLines).toHaveLength(0);
    expect(chatLines).toHaveLength(1);
    expect(chatLines[0]).toMatchObject({ sourceRef: 'ask-only', turnId: 't-ask' });
  });

  it('appendUserTurn does NOT collapse feature.jsonl when chat.jsonl append fails (non-ask)', async () => {
    // Force chat.jsonl append to fail at the filesystem level by pre-creating
    // the path as a DIRECTORY — fs.appendFile then raises EISDIR. This
    // avoids spying on ESM fs/promises exports (vitest limitation).
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await fs.mkdir(tracePath, { recursive: true });

    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:03Z',
      jobId: 'j3',
      turnId: 't-trace-fail',
      jobType: 'code',
      text: 'directive',
    };

    await expect(adapter.appendUserTurn(line)).resolves.toBeUndefined();

    const featureLines = await readJsonl<FeatureLine>(featurePath);
    expect(featureLines).toHaveLength(1);
    expect(featureLines[0]).toMatchObject({ turnId: 't-trace-fail' });
    expect((featureLines[0] as any).collapsed).toBeUndefined();
  });

  it('appendUserTurn with skipFeature=true surfaces trace errors (ask path has no SSOT fallback)', async () => {
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await fs.mkdir(tracePath, { recursive: true });

    const line: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:04Z',
      jobId: 'j4',
      turnId: 't-ask-fail',
      jobType: 'ask',
      text: 'q',
    };

    await expect(adapter.appendUserTurn(line, { skipFeature: true })).rejects.toThrow();
    expect(await readJsonl<FeatureLine>(featurePath)).toHaveLength(0);
  });

  it('loadSinceBoundary ignores legacy auto_job_complete_todo boundaries (job-context-bridge T2)', async () => {
    const t1: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'one' };
    const m1: FeatureUserTurnMetaLine = { type: 'user_turn_meta', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', executionTier: 1 };
    const bc1: FeatureBreadcrumbLine = { type: 'breadcrumb', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', scope: 'modification', summary: 'bc1', anchors: { files: ['a.ts'] }, stats: { modified: 1 } };
    const b1: FeatureBoundaryLine = { type: 'boundary', ts: '2026-04-20T00:00:04Z', jobId: 'j1', turnId: 't-1', jobType: 'code', reason: 'auto_job_complete_todo' };
    const t2: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:05Z', jobId: 'j2', turnId: 't-2', jobType: 'code', text: 'two' };
    const bc2: FeatureBreadcrumbLine = { type: 'breadcrumb', ts: '2026-04-20T00:00:06Z', jobId: 'j2', turnId: 't-2', jobType: 'code', scope: 'refactor', summary: 'bc2', anchors: {}, stats: {} };

    await adapter.appendLine('feature', t1);
    await adapter.appendLine('feature', m1);
    await adapter.appendLine('feature', bc1);
    await adapter.appendLine('feature', b1);
    await adapter.appendLine('feature', t2);
    await adapter.appendLine('feature', bc2);

    const result = await adapter.loadSinceBoundary();

    expect(result.userTurns.map((t) => t.turnId)).toEqual(['t-1', 't-2']);
    expect(result.userTurnMetas.map((m) => m.turnId)).toEqual(['t-1']);
    expect(result.breadcrumbs).toHaveLength(2);
    expect(result.breadcrumbs.map((b) => b.summary)).toEqual(['bc1', 'bc2']);
  });

  it('loadSinceBoundary still cuts at user_reset boundary (Hard Reset path preserved)', async () => {
    const t1: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'one' };
    const reset: FeatureBoundaryLine = { type: 'boundary', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'reset', reason: 'user_reset' };
    const t2: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:03Z', jobId: 'j2', turnId: 't-2', jobType: 'code', text: 'two' };

    await adapter.appendLine('feature', t1);
    await adapter.appendLine('feature', reset);
    await adapter.appendLine('feature', t2);

    const result = await adapter.loadSinceBoundary();
    expect(result.userTurns.map((t) => t.turnId)).toEqual(['t-2']);
  });

  it('appendBoundary collapses prior user_turn / user_turn_meta but preserves breadcrumbs', async () => {
    const t: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hi' };
    const m: FeatureUserTurnMetaLine = { type: 'user_turn_meta', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', executionTier: 3 };
    const bc: FeatureBreadcrumbLine = { type: 'breadcrumb', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', scope: 'modification', summary: 'kept', anchors: {}, stats: {} };

    await adapter.appendLine('feature', t);
    await adapter.appendLine('feature', m);
    await adapter.appendLine('feature', bc);

    const b: FeatureBoundaryLine = { type: 'boundary', ts: '2026-04-20T00:00:04Z', jobId: 'j1', turnId: 't-1', jobType: 'code', reason: 'auto_job_complete_todo' };
    await adapter.appendBoundary(b);

    const lines = await readJsonl<any>(featurePath);
    const byType = Object.fromEntries(
      ['user_turn', 'user_turn_meta', 'breadcrumb', 'boundary'].map((k) => [k, lines.find((l) => l.type === k)]),
    );

    expect(byType.user_turn.collapsed).toBe(true);
    expect(byType.user_turn_meta.collapsed).toBe(true);
    expect(byType.breadcrumb.collapsed).toBeUndefined();
    expect(byType.boundary.collapsed).toBeUndefined();
  });

  it('concurrent appendLine calls serialise cleanly (no partial/interleaved JSON lines)', async () => {
    const N = 50;
    const writes: Promise<void>[] = [];
    for (let i = 0; i < N; i++) {
      const line: FeatureUserTurnLine = {
        type: 'user_turn',
        ts: new Date(Date.UTC(2026, 3, 20, 0, 0, i)).toISOString(),
        jobId: `j${i}`,
        turnId: `t-${i}`,
        jobType: 'code',
        text: `msg ${i}`,
      };
      writes.push(adapter.appendLine('feature', line));
    }
    await Promise.all(writes);

    const raw = await fs.readFile(featurePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(N);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. SessionPersistence chat.jsonl write-side helpers (§16.2 Step 3)
// ════════════════════════════════════════════════════════════════════════════

function makeResolverStub(featurePath: string) {
  return {
    getFeaturePath: () => featurePath,
    getProjectPath: () => path.dirname(featurePath),
  } as any;
}

const USER_CTX: UserContext = {
  userId: 'local',
  organizationId: 'local',
  email: 'local@local',
} as any;

describe('SessionPersistence — chat.jsonl write-side helpers', () => {
  let tmpRoot: string;
  let featurePath: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-sp-trace-'));
    featurePath = path.join(tmpRoot, 'features', 'feat-a');
    await fs.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('findTurnIdForJob returns the latest user_turn for a jobId', async () => {
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    const ts = (offset: number) => new Date(Date.parse('2026-04-20T00:00:00Z') + offset).toISOString();
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: ts(1000),
        jobId: 'job-1',
        turnId: 't-old',
        jobType: 'code',
        text: 'first',
      } as any,
      { skipFeature: false },
    );
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: ts(2000),
        jobId: 'job-2',
        turnId: 't-new',
        jobType: 'code',
        text: 'second',
      } as any,
      { skipFeature: false },
    );

    const persistence = new SessionPersistence(makeResolverStub(featurePath));
    const turnId = await persistence.findTurnIdForJob('proj', 'feat-a', 'job-2', USER_CTX);
    expect(turnId).toBe('t-new');

    const missing = await persistence.findTurnIdForJob('proj', 'feat-a', 'nope', USER_CTX);
    expect(missing).toBeNull();
  });

  it('emitAssistantMessageLine appends a line when a matching turnId exists', async () => {
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-42',
        turnId: 't-42',
        jobType: 'code',
        text: 'go',
      } as any,
      { skipFeature: false },
    );

    const persistence = new SessionPersistence(makeResolverStub(featurePath));
    await persistence.emitAssistantMessageLine({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-42',
      jobType: 'code',
      text: '❌ Job failed: boom',
    });

    const chatLines = await adapter.loadAllChat();
    const assistantMsg = chatLines.find((l) => l.type === 'assistant_message');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.text).toBe('❌ Job failed: boom');
    expect(assistantMsg?.turnId).toBe('t-42');
  });

  it('emitAssistantMessageLine is a no-op when no matching turnId', async () => {
    const persistence = new SessionPersistence(makeResolverStub(featurePath));
    await persistence.emitAssistantMessageLine({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'missing-job',
      text: 'orphaned error',
    });

    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    const chatLines = await adapter.loadAllChat();
    expect(chatLines).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. addRun upsert-by-jobId (plain-dimming-flock convergence)
//    A jobId-carrying run upserts the matching entry (one run per jobId) and
//    respects the shared monotonicity guard; jobId-less callers still append.
// ════════════════════════════════════════════════════════════════════════════
describe('FileSessionAdapter.addRun — upsert by jobId', () => {
  let dir: string;
  const newAdapter = () => new FileSessionAdapter(dir, 'architect', 'proj', 'feat');
  const ioRun = (jobId?: string): any => ({
    runId: 0, job: 'code', timestamp: '',
    input: { type: 'design', source: 'directive', summary: '', size: 0 },
    output: { branch: 'main', filesWritten: 0, files: [], modifications: [] },
    ...(jobId ? { jobId } : {}),
  });
  const completed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, status: 'completed', completed: true }));
  const snap = (jobId: string, done: number) => ({ jobId, todo: [], inProgress: [], completed: completed(done), isEstimating: false, dataSource: 'session' });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-addrun-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('upserts the same jobId run instead of appending a duplicate', async () => {
    const adapter = newAdapter();
    await adapter.addRun('proj', 'feat', 'code', { ...ioRun('job-x'), status: 'paused', kanbanSnapshot: snap('job-x', 6) });
    await adapter.addRun('proj', 'feat', 'code', { ...ioRun('job-x'), status: 'completed', kanbanSnapshot: snap('job-x', 63) });

    const session = await adapter.load('proj', 'feat', 'code');
    const xs = session.runs.filter((r) => r.jobId === 'job-x');
    expect(xs).toHaveLength(1);
    expect(xs[0].status).toBe('completed');
    expect(xs[0].kanbanSnapshot!.completed).toHaveLength(63);
  });

  it('does not regress a completed run via upsert (monotonicity)', async () => {
    const adapter = newAdapter();
    await adapter.addRun('proj', 'feat', 'code', { ...ioRun('job-x'), status: 'completed', kanbanSnapshot: snap('job-x', 63) });
    await adapter.addRun('proj', 'feat', 'code', { ...ioRun('job-x'), status: 'paused', kanbanSnapshot: snap('job-x', 6) });

    const session = await adapter.load('proj', 'feat', 'code');
    const x = session.runs.find((r) => r.jobId === 'job-x')!;
    expect(x.status).toBe('completed');
    expect(x.kanbanSnapshot!.completed).toHaveLength(63);
  });

  it('appends (never merges) runs that omit jobId', async () => {
    const adapter = newAdapter();
    await adapter.addRun('proj', 'feat', 'code', ioRun());
    await adapter.addRun('proj', 'feat', 'code', ioRun());

    const session = await adapter.load('proj', 'feat', 'code');
    expect(session.runs).toHaveLength(2);
    expect(session.runs.every((r) => !r.jobId)).toBe(true);
  });
});
