/**
 * `handleReadFile` — startLine/endLine slicing + oversized-file refusal.
 *
 * Locks the truncate-prohibited contract introduced with the
 * Compact ↔ Decompact cycle: full reads of files larger than
 * `READ_FILE_FULL_READ_LIMIT` (100K bytes) MUST return an error directing
 * the LLM to re-issue with a `startLine` / `endLine` range, NEVER a
 * silently truncated payload. Range reads of the same file return only
 * the requested slice with a `[Lines X-Y of N]` header — these are the
 * line numbers the compacted outline (`L{N}: <heading>`) emits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  handleReadFile,
  createClarifyContext,
  type DiscoveryToolContext,
} from '../src/agents/architect/graph/code/nodes/decompose/discoveryTools';

let featurePath: string;

beforeAll(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-readfile-'));
  // Small markdown for line-range slicing.
  fs.mkdirSync(path.join(featurePath, 'plan'), { recursive: true });
  const small = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join('\n');
  fs.writeFileSync(path.join(featurePath, 'plan/small.md'), small);

  // Oversized markdown — 110K bytes (above 100K limit).
  const oversized = Array.from({ length: 1_200 }, (_, i) =>
    `## Section ${i + 1}\n` + 'x'.repeat(80),
  ).join('\n');
  fs.writeFileSync(path.join(featurePath, 'plan/large.md'), oversized);
});

afterAll(() => {
  if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
});

function ctx(): DiscoveryToolContext {
  return { featurePath, clarify: createClarifyContext() };
}

describe('handleReadFile — small files (<= 100K)', () => {
  it('full read returns the entire file', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md' },
      ctx(),
    );
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 50');
    expect(result.startsWith('Error:')).toBe(false);
  });

  it('startLine/endLine returns just the requested range with header', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md', startLine: 10, endLine: 12 },
      ctx(),
    );
    expect(result).toContain('[Lines 10-12 of 50]');
    expect(result).toContain('Line 10');
    expect(result).toContain('Line 11');
    expect(result).toContain('Line 12');
    expect(result).not.toContain('Line 9');
    expect(result).not.toContain('Line 13');
  });

  it('endLine beyond totalLines is clamped to file length', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md', startLine: 48, endLine: 9999 },
      ctx(),
    );
    expect(result).toContain('[Lines 48-50 of 50]');
    expect(result).toContain('Line 48');
    expect(result).toContain('Line 50');
  });

  it('startLine 0 / negative is clamped to 1', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md', startLine: 0, endLine: 2 },
      ctx(),
    );
    expect(result).toContain('[Lines 1-2 of 50]');
    expect(result).toContain('Line 1');
  });

  it('startLine > endLine returns explicit error', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md', startLine: 30, endLine: 5 },
      ctx(),
    );
    expect(result).toMatch(/Error: startLine.*> endLine/);
  });

  it('only startLine → reads from there to EOF', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md', startLine: 49 },
      ctx(),
    );
    expect(result).toContain('[Lines 49-50 of 50]');
    expect(result).toContain('Line 49');
  });

  it('only endLine → reads from line 1 to endLine', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/small.md', endLine: 3 },
      ctx(),
    );
    expect(result).toContain('[Lines 1-3 of 50]');
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 3');
    expect(result).not.toContain('Line 4');
  });
});

describe('handleReadFile — oversized files (> 100K)', () => {
  it('full read is rejected with a range-instruction error (truncate-prohibited contract)', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/large.md' },
      ctx(),
    );
    // Must NOT silently truncate.
    expect(result).toMatch(/Error: File too large/);
    expect(result).toMatch(/startLine, endLine/);
    expect(result).toMatch(/L\{N\}/);
    // Must NOT contain any TRUNCATED marker that the previous
    // implementation emitted.
    expect(result).not.toContain('TRUNCATED');
  });

  it('range read on the same file succeeds — Decompact cycle smoke', () => {
    // Stat the file to grab a known section. The fixture writes
    // `## Section N` headings every other line so line 21 is the 11th
    // section (sections are 2 lines each).
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/large.md', startLine: 21, endLine: 22 },
      ctx(),
    );
    expect(result.startsWith('Error:')).toBe(false);
    expect(result).toMatch(/^\[Lines 21-22 of \d+\]/);
    expect(result).toContain('## Section 11');
  });

  it('range read with startLine taken from a compacted outline returns the matching section verbatim', () => {
    // Decompact-cycle invariant: the line number the compacted outline
    // emits (`L{N}: <heading>`) maps directly to the source file. The
    // outline of `large.md` would surface `## Section 11` at line 21.
    // We assert the LLM-style call returns that exact heading at that
    // exact line.
    const result = handleReadFile(
      { scope: 'artifact', path: 'plan/large.md', startLine: 21, endLine: 21 },
      ctx(),
    );
    const body = result.split('\n\n')[1] ?? '';
    expect(body).toBe('## Section 11');
  });
});
