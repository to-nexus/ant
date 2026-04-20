/**
 * §16 `ui_render_migration` — adapter-level log readers
 *
 * Covers the additive helpers used by the new `/trace` + `/breadcrumbs`
 * HTTP endpoints: `loadAllTrace` (with sinceTs + jobTypes filters) and
 * `loadAllBreadcrumbs` (skipping collapsed lines).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import {
  getFeatureJsonlPath,
  getTraceJsonlPath,
} from '../../../src/core/utils/sessionPaths';
import type { TraceLine, FeatureLine } from '@ant/shared';

describe('FileSessionAdapter — feature-log readers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-fsa-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeJsonl(filePath: string, lines: (TraceLine | FeatureLine)[]) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
    await fs.writeFile(filePath, content, 'utf-8');
  }

  it('loadAllTrace returns every non-collapsed line (no filters)', async () => {
    const traceLines: TraceLine[] = [
      { type: 'user_turn', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hi', sourceRef: 'feature.jsonl#t-1' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'hello' },
      { type: 'tool_call', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', tool: 'read_file', collapsed: true },
      { type: 'file_write', ts: '2026-04-20T00:00:04Z', jobId: 'j1', turnId: 't-1', jobType: 'code', path: 'src/x.ts', operation: 'create' },
    ];
    await writeJsonl(getTraceJsonlPath(tmpDir), traceLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllTrace();

    expect(out.length).toBe(3);
    expect(out.map(l => l.type)).toEqual(['user_turn', 'assistant_message', 'file_write']);
  });

  it('loadAllTrace filters by sinceTs (strictly greater)', async () => {
    const traceLines: TraceLine[] = [
      { type: 'assistant_message', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'a' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:02Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'b' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:03Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'c' },
    ];
    await writeJsonl(getTraceJsonlPath(tmpDir), traceLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllTrace({ sinceTs: '2026-04-20T00:00:02Z' });

    expect(out.length).toBe(1);
    expect((out[0] as any).text).toBe('c');
  });

  it('loadAllTrace filters by jobTypes set', async () => {
    const traceLines: TraceLine[] = [
      { type: 'assistant_message', ts: '2026-04-20T00:00:01Z', jobId: 'j1', turnId: 't-1', jobType: 'code', text: 'a' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:02Z', jobId: 'j2', turnId: 't-2', jobType: 'design', text: 'b' },
      { type: 'assistant_message', ts: '2026-04-20T00:00:03Z', jobId: 'j3', turnId: 't-3', jobType: 'plan', text: 'c' },
    ];
    await writeJsonl(getTraceJsonlPath(tmpDir), traceLines);

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllTrace({ jobTypes: ['code', 'design'] });

    expect(out.length).toBe(2);
    expect(out.map(l => l.jobType).sort()).toEqual(['code', 'design']);
  });

  it('loadAllTrace returns empty array when file missing', async () => {
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const out = await adapter.loadAllTrace();
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
