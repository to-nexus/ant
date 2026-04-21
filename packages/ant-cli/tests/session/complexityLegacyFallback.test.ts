/**
 * FileSessionAdapter — legacy complexity literal fallback.
 *
 * Pre-5-tier-rename `feature.jsonl` lines carry `complexity: 'todo'`. The
 * adapter must normalize the legacy literal to `'task'` on read so older
 * workspaces resume correctly. Writes continue to emit `'task'` only; the
 * file itself is never rewritten (append-only invariant).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../src/periphery/adapters/session/FileSessionAdapter';
import { getFeatureJsonlPath } from '../../src/core/utils/sessionPaths';

describe('FileSessionAdapter — legacy complexity fallback', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-legacy-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeLegacyFeature(): Promise<void> {
    const fp = getFeatureJsonlPath(tmpDir);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    // Legacy line: complexity='todo' (pre-rename), along with a modern line
    // using complexity='task' to prove mixed files work end-to-end.
    const lines = [
      JSON.stringify({
        type: 'user_turn',
        ts: '2026-04-20T00:00:01Z',
        jobId: 'j1',
        turnId: 't-legacy',
        jobType: 'code',
        text: 'legacy request',
        mode: 'generate',
      }),
      JSON.stringify({
        type: 'user_turn_meta',
        ts: '2026-04-20T00:00:02Z',
        jobId: 'j1',
        turnId: 't-legacy',
        jobType: 'code',
        complexity: 'todo',
        decidedBy: 'llm',
        reason: 'multi-file feature',
      }),
      JSON.stringify({
        type: 'user_turn',
        ts: '2026-04-21T00:00:01Z',
        jobId: 'j2',
        turnId: 't-modern',
        jobType: 'code',
        text: 'modern request',
        mode: 'generate',
      }),
      JSON.stringify({
        type: 'user_turn_meta',
        ts: '2026-04-21T00:00:02Z',
        jobId: 'j2',
        turnId: 't-modern',
        jobType: 'code',
        complexity: 'task',
        decidedBy: 'llm',
        reason: 'post-rename',
      }),
    ];
    await fs.writeFile(fp, lines.join('\n') + '\n', 'utf-8');
  }

  it('loadSinceBoundary upgrades legacy complexity=\'todo\' to \'task\'', async () => {
    await writeLegacyFeature();
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const { userTurnMetas } = await adapter.loadSinceBoundary();

    const legacy = userTurnMetas.find((m) => m.turnId === 't-legacy');
    const modern = userTurnMetas.find((m) => m.turnId === 't-modern');

    expect(legacy).toBeDefined();
    expect(legacy!.complexity).toBe('task');
    expect(modern).toBeDefined();
    expect(modern!.complexity).toBe('task');
  });

  it('loadFeatureTurnMeta upgrades legacy complexity=\'todo\' to \'task\'', async () => {
    await writeLegacyFeature();
    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    const { userTurnMetas } = await adapter.loadFeatureTurnMeta();

    for (const meta of userTurnMetas) {
      expect(meta.complexity).toBe('task');
    }
  });

  it('does not rewrite the on-disk file (append-only invariant)', async () => {
    await writeLegacyFeature();
    const fp = getFeatureJsonlPath(tmpDir);
    const before = await fs.readFile(fp, 'utf-8');

    const adapter = new FileSessionAdapter(tmpDir, 'architect', 'proj', 'feat');
    await adapter.loadSinceBoundary();
    await adapter.loadFeatureTurnMeta();

    const after = await fs.readFile(fp, 'utf-8');
    expect(after).toBe(before);
    // Sanity: legacy literal still present on disk (not migrated).
    expect(after).toContain('"complexity":"todo"');
  });
});
