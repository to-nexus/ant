/**
 * M-NEW-029 — session state is an internal namespace, not a user file surface.
 *
 * Two contracts:
 *  (a) the bounded session reader refuses an oversized session on its own
 *      descriptor (SESSION_TOO_LARGE) instead of materialising + parsing it, and
 *  (b) the generic file API refuses any mutation aimed at `sessions/**` so the
 *      state cannot be grown into the readers in the first place — decided on
 *      the NORMALIZED path, so a traversal-normalized target is refused too,
 *  (c) the append-only JSONL logs are read through a descriptor-bound newest
 *      window rather than whole-file, and
 *  (d) the collapse rewriters STREAM, so that bounded view never becomes data
 *      loss on a read-modify-write.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  readSessionTextBounded,
  readSessionTextBoundedAsync,
  SessionTooLargeError,
  SESSION_MAX_BYTES,
  isReservedSessionRelativePath,
  readJsonlTailBounded,
  JSONL_READ_MAX_BYTES,
  JSONL_MAX_LINES,
} from '../../src/core/utils/sessionPaths';
import { FileSessionAdapter } from '../../src/periphery/adapters/session/FileSessionAdapter';

describe('bounded session readers (M-NEW-029)', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sess-'));
  const ok = path.join(dir, 'code.json');
  const huge = path.join(dir, 'huge.json');
  fs.writeFileSync(ok, JSON.stringify({ state: { jobId: 'j1' } }), 'utf-8');
  fs.writeFileSync(huge, 'x'.repeat(SESSION_MAX_BYTES + 1), 'utf-8');

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sync: returns content within budget', () => {
    expect(readSessionTextBounded(ok)).toContain('j1');
  });
  it('sync: returns null for a missing file', () => {
    expect(readSessionTextBounded(path.join(dir, 'nope.json'))).toBeNull();
  });
  it('sync: throws SessionTooLargeError past the budget (no full read)', () => {
    expect(() => readSessionTextBounded(huge)).toThrow(SessionTooLargeError);
  });
  it('async: throws SessionTooLargeError past the budget', async () => {
    await expect(readSessionTextBoundedAsync(huge)).rejects.toBeInstanceOf(SessionTooLargeError);
  });
  it('async: returns null for a missing file', async () => {
    expect(await readSessionTextBoundedAsync(path.join(dir, 'nope.json'))).toBeNull();
  });
});

// ── (c) the reserved-namespace verdict runs on the NORMALIZED path ──────────
// A raw first-segment test waved `plan/../sessions/...` through while the
// containment helper normalized and wrote it (audit-9 M-NEW-029 residual).
describe('isReservedSessionRelativePath (M-NEW-029)', () => {
  const cases: Array<[string, boolean]> = [
    ['sessions/architect/code.json', true],
    ['sessions', true],
    ['/sessions/architect/code.json', true],
    ['sessions\\architect\\code.json', true],
    ['plan/../sessions/architect/code.json', true],   // traversal-normalized
    ['a/b/../../sessions/x.json', true],
    ['./sessions/x.json', true],
    ['plan/prd.md', false],
    ['sessionsfoo/x.json', false],
    ['SESSIONS/x.json', false],                        // case-sensitive on disk
    ['visual/ui/ant/sessions/x.json', false],          // nested, not the root
    ['', false],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(isReservedSessionRelativePath(input)).toBe(expected);
    });
  }
});

// ── (d) JSONL logs are read through a descriptor-bound newest-window ────────
describe('readJsonlTailBounded (M-NEW-029)', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'jsonl-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, lines: string[]): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.map(l => `${l}\n`).join(''), 'utf-8');
    return p;
  };

  it('returns null for a missing file (callers keep their empty-log contract)', async () => {
    expect(await readJsonlTailBounded(path.join(dir, 'nope.jsonl'))).toBeNull();
  });

  it('returns every line when the file is within budget', async () => {
    const p = write('small.jsonl', ['{"i":1}', '{"i":2}', '{"i":3}']);
    const out = await readJsonlTailBounded(p);
    expect(out?.truncated).toBe(false);
    expect(out?.lines).toEqual(['{"i":1}', '{"i":2}', '{"i":3}']);
  });

  it('serves the NEWEST window past budget and drops the partial first line', async () => {
    // One line comfortably larger than the byte budget, then two small ones:
    // the window starts mid-giant-line, so that partial record must be dropped.
    const giant = JSON.stringify({ pad: 'x'.repeat(JSONL_READ_MAX_BYTES) });
    const p = write('big.jsonl', [giant, '{"i":"second-last"}', '{"i":"last"}']);
    const out = await readJsonlTailBounded(p);
    expect(out?.truncated).toBe(true);
    expect(out?.lines).toEqual(['{"i":"second-last"}', '{"i":"last"}']);
    // Every returned line is whole JSON — no partial record reaches the parser.
    for (const l of out!.lines) expect(() => JSON.parse(l)).not.toThrow();
    // Nothing near the file size was materialised.
    expect(out!.lines.join('').length).toBeLessThan(JSONL_READ_MAX_BYTES);
  });

  it('caps the parsed line count at JSONL_MAX_LINES (tail kept)', async () => {
    const p = path.join(dir, 'many.jsonl');
    const total = JSONL_MAX_LINES + 5;
    const out = fs.openSync(p, 'w');
    for (let i = 0; i < total; i++) fs.writeSync(out, `{"i":${i}}\n`);
    fs.closeSync(out);
    const win = await readJsonlTailBounded(p);
    expect(win?.lines.length).toBe(JSONL_MAX_LINES);
    expect(win?.truncated).toBe(true);
    expect(win?.lines.at(-1)).toBe(`{"i":${total - 1}}`);
  });

  it('the file on disk is never truncated by a read', async () => {
    const p = write('intact.jsonl', ['{"i":1}', '{"i":2}']);
    const before = fs.statSync(p).size;
    await readJsonlTailBounded(p);
    expect(fs.statSync(p).size).toBe(before);
  });
});

// ── (e) collapse rewrites stream — the bounded VIEW must not become data loss ─
describe('FileSessionAdapter collapse preserves every record (M-NEW-029)', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'collapse-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const makeAdapter = (featurePath: string) =>
    new FileSessionAdapter(featurePath, 'architect', 'p', 'f');

  it('collapseChatLog marks every line and loses none, past the read budget', async () => {
    const featurePath = path.join(root, 'over-budget');
    fs.mkdirSync(path.join(featurePath, 'sessions'), { recursive: true });
    const chatPath = path.join(featurePath, 'sessions', 'chat.jsonl');

    // A log whose head sits OUTSIDE the reader's window. A truncating rewrite
    // would silently drop it; a streaming rewrite must keep it.
    const fd = fs.openSync(chatPath, 'w');
    fs.writeSync(fd, `${JSON.stringify({ type: 'user_turn', turnId: 'oldest', pad: 'x'.repeat(JSONL_READ_MAX_BYTES) })}\n`);
    fs.writeSync(fd, `${JSON.stringify({ type: 'user_turn', turnId: 'newest' })}\n`);
    fs.closeSync(fd);
    const sizeBefore = fs.statSync(chatPath).size;

    await makeAdapter(featurePath).collapseChatLog();

    const rewritten = fs.readFileSync(chatPath, 'utf-8').split('\n').filter(l => l.trim() !== '');
    expect(rewritten).toHaveLength(2);
    const parsed = rewritten.map(l => JSON.parse(l));
    expect(parsed.map(o => o.turnId)).toEqual(['oldest', 'newest']);
    expect(parsed.every(o => o.collapsed === true)).toBe(true);
    // The head record survived at full fidelity.
    expect(fs.statSync(chatPath).size).toBeGreaterThan(sizeBefore - 200);
  });

  it('collapseByJobId leaves other jobs, boundaries and malformed lines untouched', async () => {
    const featurePath = path.join(root, 'by-job');
    fs.mkdirSync(path.join(featurePath, 'sessions'), { recursive: true });
    const featureJsonl = path.join(featurePath, 'sessions', 'feature.jsonl');
    fs.writeFileSync(featureJsonl, [
      JSON.stringify({ type: 'user_turn', jobId: 'j1', turnId: 't1' }),
      JSON.stringify({ type: 'boundary', jobId: 'j1', reason: 'user_reset' }),
      JSON.stringify({ type: 'user_turn', jobId: 'j2', turnId: 't2' }),
      'not json at all',
      '',
    ].join('\n') + '\n', 'utf-8');

    await makeAdapter(featurePath).collapseByJobId('j1');

    const lines = fs.readFileSync(featureJsonl, 'utf-8').split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]).collapsed).toBe(true);
    expect(JSON.parse(lines[1]).collapsed).toBeUndefined(); // boundary is structural
    expect(JSON.parse(lines[2]).collapsed).toBeUndefined(); // other job
    expect(lines[3]).toBe('not json at all');               // passed through verbatim
  });
});
