/**
 * Unit tests for `TraceAppender.appendFileWrite` — the single emission
 * point for trace.jsonl `file_write` lines (chat SSE + durable trace
 * share this call site via `FileOperationHandler.addFileOperation`).
 *
 * The assertions verify that the payload matches the ChatAPI signature
 * 1:1: create carries `content`, update carries `diffBefore / diffAfter`,
 * delete optionally carries the last-known content, and failures carry
 * `error` with operation preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../src/periphery/adapters/session/FileSessionAdapter';
import { TraceAppender } from '../src/core/llm-response/TraceAppender';
import { getTraceJsonlPath } from '../src/core/utils/sessionPaths';
import type { TraceFileWriteLine } from '@ant/shared';

async function readLines(tmpDir: string): Promise<TraceFileWriteLine[]> {
  const tracePath = getTraceJsonlPath(tmpDir);
  const raw = await fs.readFile(tracePath, 'utf-8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l: any) => l.type === 'file_write') as TraceFileWriteLine[];
}

describe('TraceAppender.appendFileWrite', () => {
  let tmpDir: string;
  let session: FileSessionAdapter;
  let appender: TraceAppender;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-trace-fw-'));
    session = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    appender = new TraceAppender(
      {
        featurePath: tmpDir,
        jobId: 'job-1',
        jobType: 'code',
        agent: 'architect',
        projectId: 'proj',
        featureName: 'feat',
      },
      session,
    );
    appender.setTurnId('t-abc');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('skips emission when turnId is unset (safety no-op)', async () => {
    const noTurn = new TraceAppender(
      {
        featurePath: tmpDir,
        jobId: 'job-1',
        jobType: 'code',
        agent: 'architect',
        projectId: 'proj',
        featureName: 'feat',
      },
      session,
    );
    noTurn.appendFileWrite('create', 'src/a.ts', { content: 'x' });
    // Give the fire-and-forget a tick to flush if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    const lines = await readLines(tmpDir);
    expect(lines).toEqual([]);
  });

  it('emits create with full content', async () => {
    appender.appendFileWrite('create', 'src/new.ts', { content: 'hello\n' });
    await new Promise((r) => setTimeout(r, 20));
    const lines = await readLines(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: 'file_write',
      operation: 'create',
      path: 'src/new.ts',
      content: 'hello\n',
      jobId: 'job-1',
      turnId: 't-abc',
      jobType: 'code',
    });
    expect(lines[0].diffBefore).toBeUndefined();
    expect(lines[0].diffAfter).toBeUndefined();
    expect(lines[0].error).toBeUndefined();
  });

  it('emits update with diffBefore / diffAfter', async () => {
    appender.appendFileWrite('update', 'src/x.ts', {
      diffBefore: 'const a = 1;',
      diffAfter: 'const a = 2;',
    });
    await new Promise((r) => setTimeout(r, 20));
    const lines = await readLines(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      operation: 'update',
      path: 'src/x.ts',
      diffBefore: 'const a = 1;',
      diffAfter: 'const a = 2;',
    });
    expect(lines[0].content).toBeUndefined();
  });

  it('emits delete with optional content snapshot', async () => {
    appender.appendFileWrite('delete', 'src/gone.ts', { content: 'bye\n' });
    await new Promise((r) => setTimeout(r, 20));
    const lines = await readLines(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      operation: 'delete',
      path: 'src/gone.ts',
      content: 'bye\n',
    });
  });

  it('emits failure payload with error field (create)', async () => {
    appender.appendFileWrite('create', 'src/bad.ts', { error: 'disk full' });
    await new Promise((r) => setTimeout(r, 20));
    const lines = await readLines(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      operation: 'create',
      path: 'src/bad.ts',
      error: 'disk full',
    });
    expect(lines[0].content).toBeUndefined();
  });

  it('emits failure payload with error field (update)', async () => {
    appender.appendFileWrite('update', 'src/bad.ts', { error: 'old_str not found' });
    await new Promise((r) => setTimeout(r, 20));
    const lines = await readLines(tmpDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      operation: 'update',
      path: 'src/bad.ts',
      error: 'old_str not found',
    });
    expect(lines[0].diffBefore).toBeUndefined();
  });
});
