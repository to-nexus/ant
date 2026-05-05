/**
 * Phase 5 F1 — IndexService dead-stub removal lock.
 *
 * The four legacy stub methods (`autoIndexNewBranch`, `performFullIndexing`,
 * `performFastCopy`, `updateBaseBranch`) were never wired (caller count = 0
 * across the repo). They are deleted; this guard prevents reintroduction.
 *
 * `autoIndexCodebase` is the only public surface and stays.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import * as path from 'path';

const INDEX_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'src/periphery/adapters/http/services/GitService/indexing/index.ts',
);

describe('IndexService dead-stub removal', () => {
  it('removed methods do not exist anywhere in IndexService', async () => {
    const src = await readFile(INDEX_FILE, 'utf-8');
    expect(src).not.toMatch(/autoIndexNewBranch/);
    expect(src).not.toMatch(/performFullIndexing/);
    expect(src).not.toMatch(/performFastCopy/);
    expect(src).not.toMatch(/updateBaseBranch/);
  });

  it('autoIndexCodebase remains the only public method', async () => {
    const src = await readFile(INDEX_FILE, 'utf-8');
    expect(src).toMatch(/async\s+autoIndexCodebase\(/);
    // Stub fingerprint should be gone
    expect(src).not.toMatch(/Not implemented yet - to be migrated/);
  });
});
