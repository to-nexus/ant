/**
 * Unit tests for the trace.jsonl write-side helpers on SessionPersistence
 * introduced in session redesign §16.2 Step 3.
 *
 * Covers:
 * - findTurnIdForJob: latest user_turn for a given jobId
 * - emitAssistantMessageTrace: appends trace line when turnId resolvable
 * - emitAssistantMessageTrace: no-op when no matching turnId
 * - collapseSessionLogs: marks prior user_turn as collapsed + appends
 *   user_reset boundary
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionPersistence } from '../../../src/periphery/adapters/http/services/ChatService/SessionPersistence';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import type { UserContext } from '../../../src/core/types/user';

// Minimal WorkspaceResolver stub — enough to satisfy getFeaturePath.
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

describe('SessionPersistence — trace.jsonl write-side helpers', () => {
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

  it('emitAssistantMessageTrace appends a line when a matching turnId exists', async () => {
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
    await persistence.emitAssistantMessageTrace({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'job-42',
      jobType: 'code',
      text: '❌ Job failed: boom',
    });

    const traceLines = await adapter.loadAllTrace();
    const assistantMsg = traceLines.find((l) => l.type === 'assistant_message');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.text).toBe('❌ Job failed: boom');
    expect(assistantMsg?.turnId).toBe('t-42');
  });

  it('emitAssistantMessageTrace is a no-op when no matching turnId', async () => {
    const persistence = new SessionPersistence(makeResolverStub(featurePath));
    // No user_turn recorded yet — nothing to join on.
    await persistence.emitAssistantMessageTrace({
      projectId: 'proj',
      featureName: 'feat-a',
      userContext: USER_CTX,
      jobId: 'missing-job',
      text: 'orphaned error',
    });

    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    const traceLines = await adapter.loadAllTrace();
    expect(traceLines).toHaveLength(0);
  });

  it('collapseSessionLogs marks prior user_turn as collapsed and appends user_reset boundary', async () => {
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-1',
        jobType: 'code',
        text: 'before reset',
      } as any,
      { skipFeature: false },
    );

    const persistence = new SessionPersistence(makeResolverStub(featurePath));
    await persistence.collapseSessionLogs('proj', 'feat-a', USER_CTX);

    const { userTurns } = await adapter.loadSinceBoundary();
    // After user_reset boundary, loadSinceBoundary should return empty.
    expect(userTurns).toHaveLength(0);

    const traceLines = await adapter.loadAllTrace();
    // Trace user_turn line also collapses → excluded from loadAllTrace.
    expect(traceLines).toHaveLength(0);
  });
});
