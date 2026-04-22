/**
 * Hard Reset — physical disk wipe coverage.
 *
 * The `POST /context/reset` handler in feature-log.routes.ts delegates the
 * actual file removal to `clearCanonicalDirectory(sessions/, 'sessions')`.
 * This test locks in the expected behaviour:
 *
 *  - feature.jsonl, chat.jsonl (sessions root files) → unlink
 *  - sessions/architect/*.json (code / design / learn) → unlink
 *  - sessions/planner/*.json (plan) → unlink
 *  - Deep canonical content (e.g. architect/debug/prompts/foo.txt) → unlink
 *  - Canonical subdirectory structure (architect/, architect/debug/,
 *    architect/debug/prompts/, planner/, …) → preserved as empty dirs
 *  - After wipe, FileSessionAdapter read paths return empty (ENOENT
 *    recovery path), and a subsequent append re-creates the file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  clearCanonicalDirectory,
  getFeatureJsonlPath,
  getChatJsonlPath,
  getSessionFilePath,
} from '../../../src/core/utils/sessionPaths';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

describe('Hard Reset — clearCanonicalDirectory on sessions/', () => {
  let featurePath: string;

  beforeEach(async () => {
    featurePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-hard-reset-'));
    // Lay out a realistic feature tree with content across every
    // canonical session path a real job would touch.
    const sessionsDir = path.join(featurePath, 'sessions');
    await fs.mkdir(path.join(sessionsDir, 'architect', 'debug', 'prompts'), { recursive: true });
    await fs.mkdir(path.join(sessionsDir, 'architect', 'runtime', 'code'), { recursive: true });
    await fs.mkdir(path.join(sessionsDir, 'planner', 'debug', 'prompts'), { recursive: true });

    await fs.writeFile(path.join(sessionsDir, 'feature.jsonl'),
      '{"type":"user_turn","ts":"2026-04-20T00:00:00Z","jobId":"j1","turnId":"t-1","jobType":"code","text":"hi"}\n');
    await fs.writeFile(path.join(sessionsDir, 'chat.jsonl'),
      '{"type":"user_turn","ts":"2026-04-20T00:00:00Z","jobId":"j1","turnId":"t-1","jobType":"code","text":"hi","sourceRef":"feature.jsonl#t-1"}\n');
    await fs.writeFile(path.join(sessionsDir, 'architect', 'code.json'), '{"sessionId":"s-code","runs":[]}');
    await fs.writeFile(path.join(sessionsDir, 'architect', 'design.json'), '{"sessionId":"s-design","runs":[]}');
    await fs.writeFile(path.join(sessionsDir, 'architect', 'learn.json'), '{"sessionId":"s-learn","runs":[]}');
    await fs.writeFile(path.join(sessionsDir, 'planner', 'plan.json'), '{"sessionId":"s-plan","runs":[]}');
    await fs.writeFile(path.join(sessionsDir, 'architect', 'debug', 'prompts', 'p1.txt'), 'prompt content');
    await fs.writeFile(path.join(sessionsDir, 'architect', 'runtime', 'code', 'cache.json'), '{}');
  });

  afterEach(async () => {
    await fs.rm(featurePath, { recursive: true, force: true }).catch(() => {});
  });

  it('removes every session file across feature root, architect, planner, and deep canonical subtrees', async () => {
    const sessionsDir = path.join(featurePath, 'sessions');
    await clearCanonicalDirectory(sessionsDir, 'sessions');

    // Root jsonls gone
    expect(await fileExists(getFeatureJsonlPath(featurePath))).toBe(false);
    expect(await fileExists(getChatJsonlPath(featurePath))).toBe(false);
    // architect checkpoints gone
    expect(await fileExists(getSessionFilePath(featurePath, 'architect', 'code'))).toBe(false);
    expect(await fileExists(getSessionFilePath(featurePath, 'architect', 'design'))).toBe(false);
    expect(await fileExists(getSessionFilePath(featurePath, 'architect', 'learn'))).toBe(false);
    // planner checkpoint gone
    expect(await fileExists(getSessionFilePath(featurePath, 'planner', 'plan'))).toBe(false);
    // Deep canonical content gone
    expect(await fileExists(path.join(sessionsDir, 'architect', 'debug', 'prompts', 'p1.txt'))).toBe(false);
    expect(await fileExists(path.join(sessionsDir, 'architect', 'runtime', 'code', 'cache.json'))).toBe(false);
  });

  it('preserves the canonical subdirectory skeleton after wipe', async () => {
    const sessionsDir = path.join(featurePath, 'sessions');
    await clearCanonicalDirectory(sessionsDir, 'sessions');

    expect(await dirExists(sessionsDir)).toBe(true);
    expect(await dirExists(path.join(sessionsDir, 'architect'))).toBe(true);
    expect(await dirExists(path.join(sessionsDir, 'architect', 'debug'))).toBe(true);
    expect(await dirExists(path.join(sessionsDir, 'architect', 'debug', 'prompts'))).toBe(true);
    expect(await dirExists(path.join(sessionsDir, 'architect', 'runtime', 'code'))).toBe(true);
    expect(await dirExists(path.join(sessionsDir, 'planner'))).toBe(true);
  });

  it('FileSessionAdapter read paths gracefully recover (empty results) after wipe', async () => {
    await clearCanonicalDirectory(path.join(featurePath, 'sessions'), 'sessions');

    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat');
    expect(await adapter.loadAllChat()).toEqual([]);
    expect(await adapter.loadAllBreadcrumbs()).toEqual([]);
    const { userTurns, userTurnMetas } = await adapter.loadFeatureTurnMeta();
    expect(userTurns).toEqual([]);
    expect(userTurnMetas).toEqual([]);
  });

  it('re-appending a user_turn after wipe re-creates feature.jsonl + chat.jsonl', async () => {
    await clearCanonicalDirectory(path.join(featurePath, 'sessions'), 'sessions');

    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat');
    await adapter.appendUserTurn({
      type: 'user_turn',
      ts: '2026-04-21T00:00:00Z',
      jobId: 'j-new',
      turnId: 't-new',
      jobType: 'code',
      text: 'after reset',
    } as any);

    expect(await fileExists(getFeatureJsonlPath(featurePath))).toBe(true);
    expect(await fileExists(getChatJsonlPath(featurePath))).toBe(true);
    const trace = await adapter.loadAllChat();
    expect(trace).toHaveLength(1);
    expect((trace[0] as any).text).toBe('after reset');
  });
});
