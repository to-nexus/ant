/**
 * Locks the decompose Parallel Execution "shared structural namespace" rule.
 *
 * RCA `lucky-jumping-apple`: two parallel feature tasks (app-boards,
 * app-sessions) wrote into the same dynamic route subtree (`boards/[boardId]`
 * vs `boards/[board_id]`) with DIFFERENT files, so the old "same group only for
 * same source file" trigger let them run concurrently → slug-name collision →
 * the whole app failed to build/boot. The fix extends the same-`parallelGroup`
 * trigger to a shared structural namespace and adds owner-first priority within
 * the group. Wording stays platform-neutral (decompose rules are always-on).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TPL = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'core',
  'prompt',
  'templates',
  'jobs',
  'code',
  'nodes',
  'decompose',
  'variants',
  'default',
);

const rules = fs.readFileSync(path.join(TPL, 'rules.md'), 'utf8');
const unitSplit = fs.readFileSync(path.join(TPL, 'output-unit-splitting.md'), 'utf8');

describe('decompose shared-structural-namespace parallelGroup rule', () => {
  it('extends the same-group trigger beyond same-file to shared structural namespace', () => {
    expect(rules).toMatch(/shared structural namespace/i);
    // the old absolute "Only ... SAME source files" must be relaxed to include namespace
    expect(rules).toMatch(/SAME source files, OR when they co-locate outputs under a shared structural namespace/i);
  });

  it('adds owner-first ordering WITHIN the band (priority is the intra-group sequencer)', () => {
    expect(rules).toMatch(/EARLIER priority \*\*within the same band\*\*/i);
    expect(rules).toMatch(/establishes the shared structure/i);
  });

  it('scopes the trigger narrowly (no arbitrary common ancestor → parallelism not collapsed)', () => {
    expect(rules).toMatch(/arbitrary common ancestor directory is NOT a shared structural namespace/i);
  });

  it('flags the dynamic path segment naming collision as a blind spot', () => {
    expect(rules).toMatch(/dynamic path segment'?s? parameter name MUST be identical/i);
  });

  it('output-unit-splitting drops the buggy "distinct group because files do not overlap" assumption', () => {
    expect(unitSplit).toMatch(/UNLESS two units co-locate outputs under a shared structural namespace/i);
    expect(unitSplit).toMatch(/Distinct output files alone do NOT guarantee independence/i);
  });

  it('stays platform-neutral (no framework name in the new rule vocabulary)', () => {
    // generic terms, not "Next.js"/"route"
    expect(rules).toMatch(/parameterized path position/i);
    expect(rules).not.toMatch(/Next\.js/);
  });
});
