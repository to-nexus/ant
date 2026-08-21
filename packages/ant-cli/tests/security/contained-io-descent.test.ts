/**
 * Path-resolution atomicity — one axis, one file, one row per case.
 *
 * `pathContainment` validates a *name*; the name can be repointed before the
 * operation runs. Five findings (H-003, H-010, H-011, M-NEW-003, M-NEW-005) were
 * the same defect at five sinks: a validated path re-resolved by name, with a
 * user-authored preview child sharing the workspace and able to swap a directory
 * entry in between.
 *
 * `core/config/containedIo` closes that by descending from the root one
 * component at a time, each hop opened `O_NOFOLLOW` relative to the previous
 * hop's descriptor. The descent needs `/proc/self/fd` + `O_NOFOLLOW`, so the
 * enforcing branch is Linux — the threat model (multi-tenant pod) and CI
 * (`ubuntu-latest`) are both Linux. Rows that can only be proven where the
 * descent runs are gated on `DESCENT_AVAILABLE`; everything else is asserted on
 * every platform.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DESCENT_AVAILABLE,
  mkdirpContained,
  openCanonical,
  readTextContained,
  writeTextContained,
  writeBufferContained,
  readTextContainedBase,
  writeTextContainedBase,
  mkdirpContainedBase,
  renameContainedBase,
  unlinkContainedBase,
  toBaseRelative,
  readdirContainedBase,
  walkContainedBase,
  createReadStreamContainedBase,
  createExclusiveContainedBase,
  clearContainedBase,
  sniffContainedBase,
} from '../../src/core/config/containedIo';
import { assertCanonicalWithinRoot } from '../../src/core/config/pathContainment';

const onLinuxDescent = DESCENT_AVAILABLE ? it : it.skip;

describe('containedIo — containment bound to the file object', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ant-descent-'));
    root = path.join(base, 'feature');
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, 'plan'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(root, 'plan', 'spec.md'), 'inside', 'utf-8');
    fs.writeFileSync(path.join(outside, 'spec.md'), 'SERVICE-SECRET', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('read', () => {
    it('reads a normal file under the root', () => {
      const result = readTextContained(root, 'plan/spec.md');
      expect(result).toMatchObject({ ok: true, text: 'inside' });
    });

    it('refuses a lexical escape', () => {
      expect(readTextContained(root, '../outside/spec.md')).toMatchObject({ ok: false, reason: 'escaped' });
    });

    it('refuses a leaf that is a static symlink out of the root', () => {
      fs.symlinkSync(path.join(outside, 'spec.md'), path.join(root, 'plan', 'linked.md'));
      expect(readTextContained(root, 'plan/linked.md')).toMatchObject({ ok: false, reason: 'escaped' });
    });

    it('refuses an intermediate directory that is a static symlink out of the root', () => {
      fs.symlinkSync(outside, path.join(root, 'jump'));
      expect(readTextContained(root, 'jump/spec.md')).toMatchObject({ ok: false, reason: 'escaped' });
    });

    it('follows a symlink that stays inside the root', () => {
      fs.symlinkSync(path.join(root, 'plan'), path.join(root, 'plan-link'));
      expect(readTextContained(root, 'plan-link/spec.md')).toMatchObject({ ok: true, text: 'inside' });
    });

    // The TOCTOU itself: canonicalise (what every caller does), then swap an
    // intermediate directory, then run the open the caller would have run. This
    // is the exact window H-011 / H-010 / M-NEW-005 exploited.
    onLinuxDescent('refuses an intermediate directory swapped AFTER canonicalisation', () => {
      const canonical = assertCanonicalWithinRoot(root, 'plan/spec.md');

      fs.renameSync(path.join(root, 'plan'), path.join(root, 'plan.real'));
      fs.symlinkSync(outside, path.join(root, 'plan'));

      expect(openCanonical(canonical, root)).toMatchObject({ ok: false, reason: 'swapped' });
    });

    onLinuxDescent('refuses a leaf swapped for a symlink AFTER canonicalisation', () => {
      const canonical = assertCanonicalWithinRoot(root, 'plan/spec.md');

      fs.rmSync(canonical);
      fs.symlinkSync(path.join(outside, 'spec.md'), canonical);

      expect(openCanonical(canonical, root)).toMatchObject({ ok: false, reason: 'swapped' });
    });
  });

  describe('write', () => {
    it('creates nested parents and writes under the root', () => {
      const result = writeTextContained(root, 'stage/deep/payload.txt', 'body');
      expect(result).toMatchObject({ ok: true });
      expect(fs.readFileSync(path.join(root, 'stage', 'deep', 'payload.txt'), 'utf-8')).toBe('body');
    });

    it('refuses a lexical escape', () => {
      expect(writeTextContained(root, '../outside/payload.txt', 'body')).toMatchObject({
        ok: false,
        reason: 'escaped',
      });
      expect(fs.existsSync(path.join(outside, 'payload.txt'))).toBe(false);
    });

    it('refuses an intermediate directory pointing out of the root, creating nothing outside', () => {
      fs.symlinkSync(outside, path.join(root, 'stage'));

      expect(writeBufferContained(root, 'stage/payload.txt', Buffer.from('body'))).toMatchObject({
        ok: false,
        reason: 'escaped',
      });
      expect(fs.existsSync(path.join(outside, 'payload.txt'))).toBe(false);
    });

    it('refuses a leaf that is a symlink out of the root, leaving the target untouched', () => {
      fs.symlinkSync(path.join(outside, 'spec.md'), path.join(root, 'plan', 'linked.md'));

      const result = writeBufferContained(root, 'plan/linked.md', Buffer.from('overwritten'));
      expect(result.ok).toBe(false);
      expect(fs.readFileSync(path.join(outside, 'spec.md'), 'utf-8')).toBe('SERVICE-SECRET');
    });

    it('mkdir -p refuses to descend through a symlinked component', () => {
      fs.symlinkSync(outside, path.join(root, 'stage'));

      expect(mkdirpContained(root, 'stage/deep')).toMatchObject({ ok: false, reason: 'escaped' });
      expect(fs.existsSync(path.join(outside, 'deep'))).toBe(false);
    });

    it('mkdir -p is idempotent for an existing directory', () => {
      expect(mkdirpContained(root, 'plan')).toMatchObject({ ok: true });
      expect(mkdirpContained(root, 'plan')).toMatchObject({ ok: true });
    });
  });

  // Base-relative descent: the feature NAME itself is a descended component, so a
  // reparented root (the residual gap in the name-anchored helpers above) fails
  // closed. H-011, H-003, M-NEW-005, M-NEW-018, M-NEW-019.
  describe('base-relative descent (root reparent)', () => {
    it('toBaseRelative maps an in-base target and rejects out-of-base', () => {
      expect(toBaseRelative(base, path.join(root, 'plan/spec.md'))).toEqual({ base, relative: 'feature/plan/spec.md' });
      expect(toBaseRelative(base, '/etc/passwd')).toBeUndefined();
      expect(toBaseRelative(base, base)).toBeUndefined();
    });

    it('reads a normal file with the feature name as a descent component', () => {
      expect(readTextContainedBase({ base, relative: 'feature/plan/spec.md' })).toMatchObject({ ok: true, text: 'inside' });
    });

    onLinuxDescent('refuses a read when the feature root is swapped for a symlink out of base', () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(outside, root, 'dir'); // feature -> outside (holds SERVICE-SECRET)
      const res = readTextContainedBase({ base, relative: 'feature/spec.md' });
      expect(res.ok).toBe(false);
      expect((res as any).reason).toBe('swapped');
    });

    onLinuxDescent('refuses a write through a reparented feature root', () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(outside, root, 'dir');
      const res = writeTextContainedBase({ base, relative: 'feature/spec.md' }, 'overwritten');
      expect(res.ok).toBe(false);
      expect(fs.readFileSync(path.join(outside, 'spec.md'), 'utf-8')).toBe('SERVICE-SECRET');
    });

    onLinuxDescent('refuses mkdir -p through a reparented feature root', () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(outside, root, 'dir');
      expect(mkdirpContainedBase({ base, relative: 'feature/deep/dir' }).ok).toBe(false);
      expect(fs.existsSync(path.join(outside, 'deep'))).toBe(false);
    });

    it('renameContainedBase moves a leaf within the base', () => {
      const r = renameContainedBase(base, 'feature/plan/spec.md', 'feature/plan/renamed.md');
      expect(r.ok).toBe(true);
      expect(fs.existsSync(path.join(root, 'plan', 'renamed.md'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'plan', 'spec.md'))).toBe(false);
    });

    onLinuxDescent('renameContainedBase refuses a source under a reparented root', () => {
      fs.writeFileSync(path.join(outside, 'victim.md'), 'VICTIM');
      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(outside, root, 'dir');
      const r = renameContainedBase(base, 'feature/victim.md', 'feature/moved.md');
      expect(r.ok).toBe(false);
      // The external file was neither moved nor removed.
      expect(fs.readFileSync(path.join(outside, 'victim.md'), 'utf-8')).toBe('VICTIM');
    });

    it('unlinkContainedBase removes an in-base leaf', () => {
      expect(unlinkContainedBase({ base, relative: 'feature/plan/spec.md' }).ok).toBe(true);
      expect(fs.existsSync(path.join(root, 'plan', 'spec.md'))).toBe(false);
    });
  });

  describe('enumeration / streaming / metadata (H-017, M-NEW-004/024)', () => {
    it('readdirContainedBase lists in-base directory entries with kinds', () => {
      const r = readdirContainedBase({ base, relative: 'feature/plan' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.entries.map((e) => e.name).sort()).toEqual(['spec.md']);
    });

    onLinuxDescent('readdirContainedBase refuses a reparented directory root', () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(outside, root, 'dir');
      const r = readdirContainedBase({ base, relative: 'feature' });
      expect(r.ok).toBe(false);
    });

    it('walkContainedBase enumerates files and charges the entry budget', () => {
      fs.mkdirSync(path.join(root, 'plan', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(root, 'plan', 'sub', 'a.md'), 'aa');
      const full = walkContainedBase({ base, relative: 'feature' }, { maxEntries: 100, maxDepth: 10 });
      expect(full.ok).toBe(true);
      if (full.ok) {
        expect(full.files.some((f) => f.relative.endsWith('plan/spec.md'))).toBe(true);
        expect(full.files.some((f) => f.relative.endsWith('plan/sub/a.md'))).toBe(true);
      }
      const capped = walkContainedBase({ base, relative: 'feature' }, { maxEntries: 1, maxDepth: 10 });
      expect(capped.ok).toBe(true);
      if (capped.ok) expect(capped.truncated).toBe(true);
    });

    it('walkContainedBase stops once the byte budget is exceeded', () => {
      fs.writeFileSync(path.join(root, 'plan', 'big.md'), 'x'.repeat(1000));
      const r = walkContainedBase({ base, relative: 'feature' }, { maxEntries: 100, maxDepth: 10, maxBytes: 10 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.truncated).toBe(true);
    });

    it('createReadStreamContainedBase streams an in-base file', async () => {
      const r = createReadStreamContainedBase({ base, relative: 'feature/plan/spec.md' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const chunks: Buffer[] = [];
        for await (const c of r.stream) chunks.push(c as Buffer);
        expect(Buffer.concat(chunks).toString('utf-8')).toBe('inside');
      }
    });

    onLinuxDescent('createReadStreamContainedBase refuses a reparented root', () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(outside, root, 'dir');
      const r = createReadStreamContainedBase({ base, relative: 'feature/spec.md' });
      expect(r.ok).toBe(false);
    });

    it('createExclusiveContainedBase creates a new file and refuses an existing one', () => {
      expect(createExclusiveContainedBase({ base, relative: 'feature/plan/new.md' }).ok).toBe(true);
      expect(fs.existsSync(path.join(root, 'plan', 'new.md'))).toBe(true);
      expect(createExclusiveContainedBase({ base, relative: 'feature/plan/spec.md' }).ok).toBe(false);
    });

    it('clearContainedBase empties a directory but keeps the directory', () => {
      expect(clearContainedBase({ base, relative: 'feature/plan' }).ok).toBe(true);
      expect(fs.existsSync(path.join(root, 'plan'))).toBe(true);
      expect(fs.readdirSync(path.join(root, 'plan'))).toEqual([]);
    });

    it('sniffContainedBase reports a text file as non-binary with a size', () => {
      const r = sniffContainedBase({ base, relative: 'feature/plan/spec.md' });
      expect(r.ok).toBe(true);
      if (r.ok) { expect(r.binary).toBe(false); expect(r.size).toBe(6); }
    });
  });
});
