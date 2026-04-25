/**
 * §16 `ui_render_migration` — adapter-level log readers
 *
 * Covers `loadAllChat` (with sinceTs + jobTypes filters) and
 * `loadAllBreadcrumbs` (skipping collapsed lines). The `/breadcrumbs`
 * HTTP endpoint reads the latter; chat history flows through
 * `ChatService.getMessagesAsync`, which calls `loadAllChat` internally.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../../src/periphery/adapters/session/FileSessionAdapter';
import {
  getFeatureJsonlPath,
  getChatJsonlPath,
} from '../../../src/core/utils/sessionPaths';
import type { ChatLine, FeatureLine } from '@ant/shared';

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
