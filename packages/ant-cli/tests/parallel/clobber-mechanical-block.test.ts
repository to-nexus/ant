/**
 * SharedFileBuffer cross-task clobber-block regression — green-camping-brick RCA guard.
 *
 * Defect 1 (classboard-architect-sonnet-code-json-moonlit-snowflake plan):
 * Sequential cross-task `<file>` overwrite on the SAME worker silently
 * clobbered the prior task's commit. ds-tokens (Worker 0) wrote 9371-char
 * globals.css; batch-zw6xc (same Worker 0) emitted `<file>` for the same
 * path; SharedFileBuffer's `existing.workerId === workerId` check waved it
 * through and the prior content was lost.
 *
 * Fix L1 narrows the conflict check from worker-level to task-level: any
 * `<file>` write (without `overwrite="true"`) onto a path with an existing
 * commit by a DIFFERENT task fires `conflict: true` — regardless of worker.
 *
 * This test locks the contract:
 *   - cross-task same-worker `<file>` → conflict
 *   - cross-task same-worker `<file overwrite="true">` (= `isOverwrite=true`) → also conflict
 *     unless authorized
 *   - same-worker same-task `<file>` (e.g. multi-turn retry) → allowed
 *   - cross-worker `<file>` → still conflicts (legacy behavior preserved)
 *   - new file (no existing) → allowed
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SharedFileBuffer } from '../../src/agents/architect/graph/code/parallel/SharedFileBuffer';
import type { FileSystemPort } from '../../src/core/ports/filesystem';

class FakeFS implements Partial<FileSystemPort> {
  written = new Map<string, string>();
  async writeFile(path: string, content: string): Promise<void> {
    this.written.set(path, content);
  }
}

describe('SharedFileBuffer — cross-task <file> conflict (L1 mechanical guard)', () => {
  let buf: SharedFileBuffer;
  let fs: FakeFS;

  beforeEach(() => {
    buf = new SharedFileBuffer('codebase');
    fs = new FakeFS();
  });

  it('blocks cross-task <file> on the SAME worker (RCA: ds-tokens → batch-zw6xc)', async () => {
    // ds-tokens commits globals.css on Worker 0.
    const first = await buf.write(
      'codebase/src/app/globals.css',
      ':root { --violet-600: #7c3aed; }\n@keyframes spin {...}',
      0,
      fs as any,
      { isNewFile: true, taskName: 'ds-tokens' },
    );
    expect(first.success).toBe(true);

    // batch-zw6xc on the SAME Worker 0 tries `<file>` (overwrite=false).
    // Body is the new components-only content — clobbers ds-tokens silently
    // under the old worker-only check.
    const second = await buf.write(
      'codebase/src/app/globals.css',
      '.button { color: var(--violet-600); }',
      0,
      fs as any,
      { isNewFile: true, taskName: 'batch-zw6xc' },
    );

    expect(second.success).toBe(false);
    expect(second.conflict).toBe(true);
    expect(second.ownerTask).toBe('ds-tokens');
    // Conflict message must guide LLM to three channels with <edit> default.
    expect(second.error).toContain('<edit');
    expect(second.error).toContain('<append');
    expect(second.error).toContain('overwrite="true"');
    expect(second.error).toMatch(/edit.*default/i);
    // Disk content from ds-tokens must remain intact (no silent clobber).
    expect(fs.written.get('codebase/src/app/globals.css')).toContain('--violet-600');
  });

  it('blocks cross-task <file overwrite="true"> (isOverwrite=true) on the SAME worker too — unless authorized', async () => {
    await buf.write(
      'codebase/package.json',
      '{"name":"a","dependencies":{"react":"19"}}',
      0,
      fs as any,
      { isNewFile: true, taskName: 'setup' },
    );

    const second = await buf.write(
      'codebase/package.json',
      '{"name":"a","dependencies":{}}',
      0,
      fs as any,
      { isOverwrite: true, taskName: 'batch-other' },
    );

    expect(second.success).toBe(false);
    expect(second.conflict).toBe(true);
    expect(second.ownerTask).toBe('setup');
  });

  it('allows same-worker SAME-task re-entry (multi-turn retry on same task) via isOverwrite', async () => {
    await buf.write(
      'codebase/a.ts',
      'export const x = 1;',
      0,
      fs as any,
      { isNewFile: true, taskName: 'feature-a' },
    );

    // Same task on same worker re-emits (e.g. multi-turn full replacement).
    const second = await buf.write(
      'codebase/a.ts',
      'export const x = 2;',
      0,
      fs as any,
      { isOverwrite: true, taskName: 'feature-a' },
    );

    expect(second.success).toBe(true);
    expect(fs.written.get('codebase/a.ts')).toContain('= 2');
  });

  it('blocks cross-worker <file> (legacy behavior preserved)', async () => {
    await buf.write(
      'codebase/shared.ts',
      'export const A = 1;',
      0,
      fs as any,
      { isNewFile: true, taskName: 'task-a' },
    );

    const second = await buf.write(
      'codebase/shared.ts',
      'export const A = 2;',
      1, // different worker
      fs as any,
      { isNewFile: true, taskName: 'task-b' },
    );

    expect(second.success).toBe(false);
    expect(second.conflict).toBe(true);
  });

  it('allows authorized overwrite (post-conflict merge takeover)', async () => {
    await buf.write(
      'codebase/x.ts',
      'old',
      0,
      fs as any,
      { isNewFile: true, taskName: 'task-a' },
    );

    // Worker 1 was authorized after a prior conflict was surfaced.
    buf.authorizeWriter('codebase/x.ts', 1);

    const second = await buf.write(
      'codebase/x.ts',
      'merged',
      1,
      fs as any,
      { isNewFile: true, taskName: 'task-b' },
    );

    expect(second.success).toBe(true);
    expect(fs.written.get('codebase/x.ts')).toBe('merged');
  });

  it('allows brand-new file creation (no prior commit)', async () => {
    const result = await buf.write(
      'codebase/fresh.ts',
      'export const x = 1;',
      0,
      fs as any,
      { isNewFile: true, taskName: 'task-a' },
    );

    expect(result.success).toBe(true);
  });
});

describe('SharedFileBuffer conflict message — L2b three-option hint', () => {
  it('presents <edit> as DEFAULT and includes file size + tail preview + M < N hint', async () => {
    const buf = new SharedFileBuffer('codebase');
    const fs = new FakeFS();
    const priorContent = ':root { --x: 1; }\n'.repeat(50);

    await buf.write('codebase/a.css', priorContent, 0, fs as any, {
      isNewFile: true,
      taskName: 'task-a',
    });

    const result = await buf.write(
      'codebase/a.css',
      '.foo { color: red; }', // much smaller body — should trigger M < N hint
      0,
      fs as any,
      { isNewFile: true, taskName: 'task-b' },
    );

    expect(result.success).toBe(false);
    const msg = result.error!;
    expect(msg).toMatch(/size:\s*\d+\s*bytes/i);
    expect(msg).toContain('version:');
    expect(msg).toContain('tail:');
    // Three options shown with <edit> as DEFAULT.
    expect(msg).toMatch(/DEFAULT/);
    expect(msg).toContain('<edit');
    expect(msg).toContain('<append');
    expect(msg).toContain('overwrite="true"');
    // M < N hint fires when emitted body is smaller than prior.
    expect(msg).toMatch(/smaller than the existing content/i);
    expect(msg).toMatch(/use\s+<edit>,\s+not\s+<file overwrite/i);
  });

  it('omits the M < N hint when emitted body is >= prior size', async () => {
    const buf = new SharedFileBuffer('codebase');
    const fs = new FakeFS();
    await buf.write('codebase/b.css', 'short', 0, fs as any, {
      isNewFile: true,
      taskName: 'task-a',
    });

    const result = await buf.write(
      'codebase/b.css',
      'a much longer body that exceeds the prior content',
      0,
      fs as any,
      { isNewFile: true, taskName: 'task-b' },
    );

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/smaller than the existing content/i);
  });
});
