/**
 * Design graph axis ⑤ SSOT guard.
 *
 * Per [NODE_GRAPH_LAYOUT.md §2 축 ⑤]:
 *   - `session.updateArtifacts` direct calls MUST live only in
 *     `design/session/checkpoint.ts` (the SSOT). The single allowed exception
 *     is `design/nodes/learn/sessionWriter.ts`'s `addRun(...)` site, which
 *     uses a different port method but happens to live in the design graph.
 *   - `design/**` MUST NOT cross-import `code/session/*` (or any other job's
 *     session module) — each job graph owns its own SSOT.
 *
 * This test pins the allowed caller set. Adding a new axis ⑤ writer requires
 * extending ALLOWED below with a justification in the PR description.
 */
import { promises as fs } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

const DESIGN_ROOT = join(__dirname, '../../src/agents/architect/graph/design');

// Files allowed to reference `session.updateArtifacts` directly.
const ALLOWED_UPDATE_CALLERS = new Set<string>([
  'session/checkpoint.ts',
]);

async function walkTsFiles(dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      await walkTsFiles(full, out);
      continue;
    }
    if (entry.isFile && entry.name.endsWith('.ts')) out.push(full);
  }
}

function rel(file: string): string {
  return relative(DESIGN_ROOT, file).replace(/\\/g, '/');
}

describe('design graph axis ⑤ SSOT guard', () => {
  it('only design/session/checkpoint.ts writes sessions via updateArtifacts', async () => {
    const files: string[] = [];
    await walkTsFiles(DESIGN_ROOT, files);

    const offenders: string[] = [];
    for (const file of files) {
      const r = rel(file);
      if (ALLOWED_UPDATE_CALLERS.has(r)) continue;
      const source = await fs.readFile(file, 'utf8');
      if (/session\.updateArtifacts\s*\(/.test(source)) {
        offenders.push(r);
      }
    }
    expect(offenders, 'design graph must route session writes through design/session/checkpoint.ts').toEqual([]);
  });

  it('design graph does not cross-import another job\'s session module', async () => {
    const files: string[] = [];
    await walkTsFiles(DESIGN_ROOT, files);

    // Match only real import/require/dynamic-import statements, not doc-comment prose.
    //   from '.../code/session/...'
    //   import('.../code/session/...')
    //   require('.../code/session/...')
    const IMPORT_RE = /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*code\/session\/[^'"]*['"]/;

    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      if (IMPORT_RE.test(source)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders, 'design files must not cross-import code/session/*').toEqual([]);
  });
});
