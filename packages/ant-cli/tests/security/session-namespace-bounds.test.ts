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
import {
  serializeSessionBounded,
  writeSessionBounded,
  shedToFit,
  trimConversationToByteBudget,
  sessionWriteGuardOf,
  SessionWriteTooLargeError,
  SessionWriteConflictError,
  TRIM_BRIDGE_TEXT,
} from '../../src/core/session/stateBudget';

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

/**
 * WRITE half of the same budget (audit-10).
 *
 * `SESSION_MAX_BYTES` was a read-only refusal, so nothing stopped a writer from
 * producing a file no reader could open again — and since `updateArtifacts`
 * loads before it saves, such a session became permanently unreadable AND
 * unwritable. These rows pin the write contract and the trim that keeps the
 * refusal unreachable in normal operation.
 */
describe('session write budget (M-NEW-029)', () => {
  const msg = (role: 'user' | 'assistant', content: any) => ({ role, content });

  it('serializeSessionBounded refuses exactly what the readers refuse', () => {
    const small = serializeSessionBounded({ a: 1 });
    expect(small.ok).toBe(true);
    const huge = serializeSessionBounded({ blob: 'x'.repeat(SESSION_MAX_BYTES + 1) });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.limit).toBe(SESSION_MAX_BYTES);
  });

  it('writeSessionBounded refuses an oversized write and leaves the previous file intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-write-budget-'));
    const target = path.join(dir, 'code.json');
    fs.writeFileSync(target, JSON.stringify({ keep: 'previous-valid' }), 'utf-8');

    await expect(
      writeSessionBounded(target, { blob: 'x'.repeat(SESSION_MAX_BYTES + 1) }),
    ).rejects.toBeInstanceOf(SessionWriteTooLargeError);

    // The point of refusing: the last good snapshot survives untouched.
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ keep: 'previous-valid' });
  });

  it('shedToFit drops recoverable bulk before refusing, and never the resume core', () => {
    const big = 'x'.repeat(Math.floor(SESSION_MAX_BYTES / 3));
    const session: any = {
      runs: [
        { jobId: 'a', kanbanSnapshot: { blob: big } },
        { jobId: 'b', kanbanSnapshot: { blob: big } },
        { jobId: 'c', kanbanSnapshot: { blob: big } },
        { jobId: 'd', kanbanSnapshot: { blob: big } },
      ],
      state: { taskQueue: [{ id: 't1' }], currentTask: { id: 't1' }, interruption: { reason: 'user_stopped' } },
    };
    const out = shedToFit(session, { keepSnapshots: 1 });
    expect(out.ok).toBe(true);
    expect(out.shed.join(',')).toMatch(/kanbanSnapshot/);
    // Resume core is never shed — dropping it would turn an availability
    // finding into data loss.
    expect(session.state.taskQueue).toEqual([{ id: 't1' }]);
    expect(session.state.currentTask).toEqual({ id: 't1' });
    expect(session.state.interruption).toEqual({ reason: 'user_stopped' });
  });

  it('a CAS guard turns a concurrent overwrite into a typed conflict, not a clobber', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-write-cas-'));
    const target = path.join(dir, 'code.json');
    fs.writeFileSync(target, JSON.stringify({ v: 1 }), 'utf-8');
    const guard = sessionWriteGuardOf(fs.readFileSync(target, 'utf-8'));

    // Someone else (a worker seal) lands between our read and our write.
    fs.writeFileSync(target, JSON.stringify({ v: 2 }), 'utf-8');

    await expect(writeSessionBounded(target, { v: 99 }, { expect: guard }))
      .rejects.toBeInstanceOf(SessionWriteConflictError);
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ v: 2 });
  });
});

/**
 * The trim's guarantees ARE its proof — each row is one post-condition.
 * Group-granular dropping is what keeps a tool_use with its tool_result, and
 * tail identity is what keeps clarify resume working.
 */
describe('conversation trim post-conditions (M-NEW-029)', () => {
  const filler = (n: number) => 'y'.repeat(n);

  function longHistory(turns: number, bytesPerTurn: number) {
    const h: any[] = [{ role: 'user', content: 'the original directive' }];
    for (let i = 0; i < turns; i++) {
      h.push({ role: 'assistant', content: [{ type: 'tool_use', id: `tu-${i}`, name: 'read_file', input: {} }] });
      h.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu-${i}`, content: filler(bytesPerTurn) }] });
    }
    return h;
  }

  it('leaves a history under budget completely untouched', () => {
    const h = longHistory(3, 10);
    const out = trimConversationToByteBudget(h, { budgetBytes: 10 * 1024 * 1024 });
    expect(out.trimmed).toBe(false);
    expect(out.messages).toBe(h);
  });

  it('post-condition 1+2: starts with a user message and keeps the tail by IDENTITY', () => {
    const h = longHistory(40, 5000);
    const out = trimConversationToByteBudget(h, { budgetBytes: 20_000 });
    expect(out.trimmed).toBe(true);
    expect(out.messages[0].role).toBe('user');
    // Identity, not equality: clarify resume reads ONLY the last message, so
    // nothing may ever be appended after the tail.
    expect(out.messages[out.messages.length - 1]).toBe(h[h.length - 1]);
  });

  it('post-condition 3: every surviving tool_result still has its tool_use', () => {
    const h = longHistory(40, 5000);
    const out = trimConversationToByteBudget(h, { budgetBytes: 20_000 });
    const useIds = new Set<string>();
    for (const m of out.messages) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const b of m.content as any[]) if (b.type === 'tool_use') useIds.add(b.id);
      }
    }
    for (const m of out.messages) {
      if (m.role === 'user' && Array.isArray(m.content)) {
        for (const b of m.content as any[]) {
          if (b.type === 'tool_result') expect(useIds.has(b.tool_use_id)).toBe(true);
        }
      }
    }
  });

  it('post-condition 4: the newest turns survive regardless of budget', () => {
    const h = longHistory(40, 5000);
    const out = trimConversationToByteBudget(h, { budgetBytes: 1, minKeepTurns: 3 });
    expect(out.messages).toContain(h[h.length - 1]);
    expect(out.messages).toContain(h[h.length - 2]);
  });

  it('the bridge text is constant — a varying one would break prompt caching', () => {
    const a = trimConversationToByteBudget(longHistory(40, 5000), { budgetBytes: 20_000 });
    const b = trimConversationToByteBudget(longHistory(60, 5000), { budgetBytes: 20_000 });
    const bridgeOf = (r: any) => r.messages.find((m: any) => m.content === TRIM_BRIDGE_TEXT);
    expect(bridgeOf(a)).toBeDefined();
    expect(bridgeOf(b)?.content).toBe(bridgeOf(a)?.content);
  });
});
