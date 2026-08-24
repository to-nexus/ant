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
