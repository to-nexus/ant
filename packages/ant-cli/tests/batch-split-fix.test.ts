/**
 * Tests for code job defect fixes:
 * - detectTestFilesFromDisk scans disk (not stale RAG context)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── detectTestFilesFromDisk ───────────────────────────────────────────────

describe('Fix 3: detectTestFilesFromDisk scans filesystem', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-test-'));
    fs.mkdirSync(path.join(tmpDir, 'codebase'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeFs(files: string[]) {
    for (const f of files) {
      const fullPath = path.join(tmpDir, 'codebase', f);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '// test');
    }
  }

  it('returns false when codebase has no test files', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    makeFs(['src/index.ts', 'src/utils.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(false);
  });

  it('returns true for *.test.ts files', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    makeFs(['src/utils.test.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });

  it('returns true for *.spec.ts files in nested directories', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    makeFs(['features/trading/model/calculations.spec.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });

  it('returns true for *.test.js files', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    makeFs(['src/helper.test.js']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });

  it('skips node_modules', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    makeFs(['node_modules/vitest/index.test.ts', 'src/index.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(false);
  });

  it('returns false when featurePath is undefined', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    expect(detectTestFilesFromDisk(undefined)).toBe(false);
  });

  it('returns false when codebase directory does not exist', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    expect(detectTestFilesFromDisk('/nonexistent/path')).toBe(false);
  });

  it('disk scan picks up test files written during job execution', async () => {
    // Simulate: test files were written to disk DURING the job
    makeFs(['src/utils.test.ts']);

    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/tasks/_shared/verify/env'
    );
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });
});
