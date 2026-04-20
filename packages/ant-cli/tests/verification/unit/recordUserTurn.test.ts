/**
 * Chapter 2 (§2 `atomic_user_turn_write`) — `recordUserTurn` helper.
 *
 * Regression tests for the two resume-path defects fixed in this session:
 *
 *  - P1: resume must reuse the ORIGINAL turnId already in feature.jsonl. The
 *        previous implementation generated a fresh random id, which silently
 *        unlinked all resumed-turn trace events from their originating
 *        user_turn in feature.jsonl.
 *
 *  - P0 consequence: on resume, `recordUserTurn` must be a no-op for
 *        feature.jsonl (no duplicate user_turn). Covered by observing the
 *        file contents before and after the helper call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import { recordUserTurn, generateTurnId } from '../../../src/composition/recordUserTurn';
import {
  getFeatureJsonlPath,
  getTraceJsonlPath,
} from '../../../src/core/utils/sessionPaths';
import type { FeatureUserTurnLine } from '@ant/shared';

// The helper dynamically imports ChatAPIClient to propagate turnId into the
// worker's LLMResponseService. In the test environment that module may not
// have initialised, so we stub it to observe the propagated id.
vi.mock('../../../src/core/adapters/ChatAPIClient', () => {
  const state: { turnId: string | null } = { turnId: null };
  return {
    __propagated: state,
    getLLMResponseServiceOrNull: async () => ({
      setTurnId: (t: string | null) => {
        state.turnId = t;
      },
    }),
  };
});

async function readJsonl<T = any>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

describe('recordUserTurn — resume-path turnId preservation', () => {
  let tmpDir: string;
  let featurePath: string;
  let tracePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-rut-'));
    featurePath = getFeatureJsonlPath(tmpDir);
    tracePath = getTraceJsonlPath(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    vi.clearAllMocks();
  });

  it('fresh call (isResume=false) appends user_turn to both files', async () => {
    const turnId = await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'code',
      jobId: 'job-1',
      directive: 'build the thing',
      mode: 'generate',
      isResume: false,
    });

    expect(turnId).toMatch(/^t-[0-9a-f]{8}$/);
    expect(await readJsonl<FeatureUserTurnLine>(featurePath)).toHaveLength(1);
    expect(await readJsonl(tracePath)).toHaveLength(1);
  });

  it('resume call reuses the existing turnId from feature.jsonl instead of generating a new one', async () => {
    // Simulate a prior user_turn already persisted by the initial job run.
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const originalLine: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-20T00:00:01Z',
      jobId: 'job-1',
      turnId: 't-original',
      jobType: 'code',
      text: 'first directive',
      mode: 'generate',
    };
    await adapter.appendUserTurn(originalLine);

    // Resume path: helper must NOT append a new line, and MUST return the
    // ORIGINAL turnId so trace lines written during the resume still group
    // under 't-original'.
    const returnedTurnId = await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'code',
      jobId: 'job-1',
      directive: 'first directive',
      mode: 'generate',
      isResume: true,
    });

    expect(returnedTurnId).toBe('t-original');

    const featureLines = await readJsonl<FeatureUserTurnLine>(featurePath);
    expect(featureLines).toHaveLength(1);
    expect(featureLines[0].turnId).toBe('t-original');
  });

  it('resume call prefers an exact jobId match when multiple user_turns exist', async () => {
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const a: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'job-A', turnId: 't-A', jobType: 'code', text: 'A' };
    const b: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:02Z', jobId: 'job-B', turnId: 't-B', jobType: 'code', text: 'B' };
    await adapter.appendUserTurn(a);
    await adapter.appendUserTurn(b);

    const turnId = await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'code',
      jobId: 'job-A',
      directive: 'A',
      isResume: true,
    });

    expect(turnId).toBe('t-A');
  });

  it('resume call falls back to most recent user_turn when no jobId matches', async () => {
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const a: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'job-A', turnId: 't-A', jobType: 'code', text: 'A' };
    const b: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:02Z', jobId: 'job-B', turnId: 't-B', jobType: 'code', text: 'B' };
    await adapter.appendUserTurn(a);
    await adapter.appendUserTurn(b);

    const turnId = await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'code',
      jobId: 'job-unknown',
      directive: 'X',
      isResume: true,
    });

    expect(turnId).toBe('t-B');
  });

  it('resume call with providedTurnId honours the explicit id (highest priority)', async () => {
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const existing: FeatureUserTurnLine = { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'job-X', turnId: 't-existing', jobType: 'code', text: 'X' };
    await adapter.appendUserTurn(existing);

    const explicit = generateTurnId();
    const turnId = await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'code',
      jobId: 'job-X',
      directive: 'X',
      isResume: true,
      turnId: explicit,
    });

    expect(turnId).toBe(explicit);
    // No new line appended.
    expect(await readJsonl(featurePath)).toHaveLength(1);
  });

  it('resume call with empty feature.jsonl degenerates to a fresh turnId (no crash)', async () => {
    const turnId = await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'code',
      jobId: 'job-empty',
      directive: 'anything',
      isResume: true,
    });

    expect(turnId).toMatch(/^t-[0-9a-f]{8}$/);
    // Still no append on resume path.
    expect(await readJsonl(featurePath)).toHaveLength(0);
  });

  it('inline-ask fresh call skips feature.jsonl but writes trace.jsonl with ask-only sourceRef', async () => {
    await recordUserTurn({
      featurePath: tmpDir,
      jobType: 'inline-ask',
      jobId: 'job-ask',
      directive: 'what?',
      isResume: false,
    });

    expect(await readJsonl(featurePath)).toHaveLength(0);
    const traceLines = await readJsonl<any>(tracePath);
    expect(traceLines).toHaveLength(1);
    expect(traceLines[0].sourceRef).toBe('ask-only');
  });
});
