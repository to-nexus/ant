/**
 * R1-carve-out regression guard.
 *
 * NODE_GRAPH_LAYOUT §3 R1-carve-out allows phase layer files to directly
 * import `tasks/{type}/model/is.ts` predicates (`isDocTask`, `isErrorTask`,
 * `isVerificationTask`, ...) only when all three conditions hold:
 *   1. predicate is pure (no state/context dependency)
 *   2. the literal `task.type === '...'` comparison is contained inside the
 *      predicate file
 *   3. a hook would add no value (static per-type fact)
 *
 * The risk is drift: new predicates slip into phase nodes one at a time and
 * the carve-out silently widens. We pin the current usage count so any
 * increase triggers a review of the three conditions before merging.
 *
 * If this test fails after a legitimate addition, update MEASURED_COUNT in
 * the same PR that adds the usage, and include justification in the PR
 * description referencing the three conditions above.
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../../src/agents/architect/graph/code');
const PREDICATES = [
  'isDocTask',
  'isErrorTask',
  'isVerificationTask',
  'isSetupTask',
  'isUiTask',
  'isFeatureTask',
  'isDesignSystemTask',
  'isTestCodeTask',
  'isExplainTask',
];

/**
 * Measured once at plan execution time. Increase requires justification per
 * the R1-carve-out conditions. Do NOT lower silently — a drop usually means
 * a predicate usage was converted to a hook, which is always welcome and
 * should be captured as a new, lower pin in the same PR.
 */
const MEASURED_COUNT = 89;

async function walkSourceFiles(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tasks') continue;
      await walkSourceFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
}

function countMatches(source: string): number {
  let total = 0;
  for (const name of PREDICATES) {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    const matches = source.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

describe('R1-carve-out regression guard', () => {
  it('static type predicate usage in phase layer stays within budget', async () => {
    const files: string[] = [];
    await walkSourceFiles(ROOT, files);
    let count = 0;
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      count += countMatches(source);
    }
    expect(count).toBeLessThanOrEqual(MEASURED_COUNT);
  });
});
