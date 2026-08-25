/**
 * Contained-I/O ADOPTION — the enforcement layer the earlier audits were
 * missing. The `*ContainedBase` primitives (descriptor descent anchored at the
 * service-owned physical base) are only a fix if every in-base sink actually
 * USES them. Three prior audit rounds shipped the primitive but left call sites
 * on the movable-root / raw-fs path, and no test failed — because the tests
 * checked the primitive's behavior, never its adoption.
 *
 * This is that adoption guard: one axis per sink family, asserting the unsafe
 * shape has ZERO occurrences (outside the single owner allowed to keep the
 * legacy fallback). A new caller that reaches for the raw/movable-root form
 * fails here.
 *
 * Assertions are structural (call-site presence), never on message prose.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/** All *.ts under src, minus .d.ts. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const ALL_TS = walk(SRC);
const rel = (p: string) => path.relative(process.cwd(), p);
const read = (p: string) => fs.readFileSync(p, 'utf-8');

describe('verified byte-write adoption (H-017)', () => {
  // writeBufferVerifiedAbs anchors the descent at a caller-supplied *feature
  // name* and so follows a reparented feature root. It survives ONLY as the
  // out-of-base (repoType:'local') fallback inside binaryIntegrity.ts; every
  // other write goes through writeBufferVerifiedContained.
  const OWNER = 'src/core/utils/binaryIntegrity.ts';

  it('writeBufferVerifiedAbs is called only inside binaryIntegrity.ts', () => {
    const offenders = ALL_TS.filter((p) => {
      if (rel(p) === OWNER) return false;
      return /writeBufferVerifiedAbs\s*\(/.test(read(p));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the verified-write SSOT exposes the base-relative (root-reparent-safe) form', () => {
    const src = read(path.join(process.cwd(), OWNER));
    expect(src).toMatch(/writeBufferVerifiedContained/);
    expect(src).toMatch(/writeBufferVerifiedBase/);
  });
});

describe('Ask workspace tools use contained reads (H-018)', () => {
  const ASK_TOOLS = 'src/agents/architect/graph/ask/tools.ts';

  it('read/list workspace tools descend via the contained base primitives', () => {
    const src = read(path.join(process.cwd(), ASK_TOOLS));
    expect(src).toMatch(/toBaseRelative/);
    expect(src).toMatch(/readTextContainedBase/);
    expect(src).toMatch(/readBoundedDirentsContainedBase/);
  });
});

/**
 * Session + JSONL bounded-read ADOPTION (M-NEW-029).
 *
 * audit-8 shipped `readSessionTextBounded*` and audit-9 still found six raw
 * `readFile` + `JSON.parse` callers on the same attacker-writable state — the
 * primitive existed, the adoption did not. Same failure mode this file was
 * created for, so it gets the same kind of guard: the unsafe SHAPE must have
 * zero occurrences outside the one owner that implements it.
 */
describe('session / JSONL bounded-read adoption (M-NEW-029)', () => {
  const OWNER = 'src/core/utils/sessionPaths.ts';

  /** `fs.readFile(x)` / `fs.readFileSync(x)` / `fsPromises.readFile(x)` … */
  const RAW_READ = /\b(?:await\s+)?fs(?:Promises|p)?\.(?:promises\.)?readFile(?:Sync)?\s*\(\s*([A-Za-z_$][\w$]*\s*\(?|)/g;

  it('no caller whole-file-reads a session or JSONL path', () => {
    const offenders: string[] = [];
    for (const p of ALL_TS) {
      if (rel(p) === OWNER) continue;
      const src = read(p);
      for (const m of src.matchAll(RAW_READ)) {
        const arg = (m[1] ?? '').trim();
        const isSessionish =
          /session/i.test(arg) ||
          arg.startsWith('getChatJsonlPath') ||
          arg.startsWith('getFeatureJsonlPath');
        if (isSessionish) offenders.push(`${rel(p)}: readFile(${arg})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The readers audit-9 named individually. Pinned by name so a revert is loud.
  const CONVERGED: Array<[string, RegExp]> = [
    ['src/core/utils/debugRetention.ts', /readSessionTextBoundedAsync\(/],
    ['src/core/session/archive.ts', /readSessionTextBoundedAsync\(/],
    ['src/core/refine/refineImpactAlert.ts', /readSessionTextBoundedAsync\(/],
    ['src/core/refine/loadStaleTasks.ts', /readJsonlTailBounded\(/],
    ['src/agents/planner/graph/plan/nodes/sessionWriter.ts', /readSessionTextBounded\(/],
    ['src/agents/planner/graph/plan/nodes/resolve.ts', /readSessionTextBounded\(/],
    ['src/agents/creator/graph/visual/nodes/resolve.ts', /readSessionTextBounded\(/],
    ['src/periphery/adapters/session/FileSessionAdapter.ts', /readJsonlTailBounded\(/],
  ];
  for (const [file, expected] of CONVERGED) {
    it(`${file} reads through the bounded seam`, () => {
      expect(read(path.join(process.cwd(), file))).toMatch(expected);
    });
  }

  // The collapse rewriters are read-modify-write, so the bounded READ window
  // would be silent record loss. They must stream instead.
  it('FileSessionAdapter collapse paths stream rather than buffer the whole log', () => {
    const src = read(path.join(process.cwd(), 'src/periphery/adapters/session/FileSessionAdapter.ts'));
    expect(src).toMatch(/rewriteJsonlStreaming/);
    // No whole-file read/write pair left on a JSONL path.
    expect(src).not.toMatch(/fs\.writeFile\(\s*filePath\s*,\s*newLines/);
  });

  // The reserved-namespace verdict has one owner and runs on the normalized
  // path — a raw first-segment split re-introduces the `..%2f` bypass.
  it('the file-API mutation guards use the shared reserved-path predicate', () => {
    for (const file of [
      'src/periphery/adapters/http/routes/files.routes.ts',
      'src/periphery/adapters/http/routes/customAgents.routes.ts',
    ]) {
      expect(read(path.join(process.cwd(), file))).toMatch(/isReservedSessionRelativePath\(/);
    }
  });

  // The directive ceiling has one owner; a route that re-declares its own
  // number is how `/execute` and `/inline-ask` ended up with none.
  it('every directive ingress uses the shared cap helper', () => {
    const jobRoutes = read(path.join(process.cwd(), 'src/periphery/adapters/http/routes/job.routes.ts'));
    expect(jobRoutes.match(/directiveTooLarge\(/g) ?? []).toHaveLength(3); // execute / continue / inline-ask
    expect(jobRoutes).not.toMatch(/const\s+\w*DIRECTIVE_MAX\w*\s*=\s*\d/);
  });
});
