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
});
