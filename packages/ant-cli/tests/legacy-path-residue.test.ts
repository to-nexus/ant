/**
 * Legacy path residue guard — Phase C exit gate.
 *
 * Once the workspace-dir overhaul lands, no committed source/template/doc
 * tree may re-introduce the legacy I/O-axis paths. This file is the
 * single-direction guard that catches re-introductions in any subsequent
 * PR. The matching SSOT is `packages/ant-shared/src/canonical.ts`.
 *
 * Five invariants:
 *   1. `CANONICAL_FEATURE_DIRS` contains zero `inputs/` or `outputs/` entries.
 *   2. Every entry of `CANONICAL_FEATURE_DIRS` starts with one of the
 *      domain roots (plan / architecture / visual / assets / meta /
 *      sessions / codebase).
 *   3. Every `ARTIFACT_PREFIX` value sits under a domain root.
 *   4. `FIGMA_CONFIG_PATH` resolves to `visual/ui/figma/figma.json`.
 *   5. ripgrep over the source/template/docs trees finds zero legacy
 *      path literals (with a small allowlist for the migration script,
 *      the boot-time guard test, this test, and changelog history).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import {
  CANONICAL_FEATURE_DIRS,
  ARTIFACT_PREFIX,
  FIGMA_CONFIG_PATH,
} from '@ant/shared';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const DOMAIN_ROOTS = [
  'plan',
  'architecture',
  'visual',
  'assets',
  'meta',
  'sessions',
  'codebase',
] as const;

describe('Legacy path residue guard', () => {
  it('CANONICAL_FEATURE_DIRS contains no legacy I/O prefixes', () => {
    for (const p of CANONICAL_FEATURE_DIRS) {
      expect(p.startsWith('inputs/'), `legacy inputs/ prefix: ${p}`).toBe(false);
      expect(p.startsWith('outputs/'), `legacy outputs/ prefix: ${p}`).toBe(false);
    }
  });

  it('every CANONICAL_FEATURE_DIRS entry starts with a domain root', () => {
    for (const p of CANONICAL_FEATURE_DIRS) {
      const firstSegment = p.split('/')[0];
      expect(
        DOMAIN_ROOTS as ReadonlyArray<string>,
        `not under a domain root: ${p}`,
      ).toContain(firstSegment);
    }
  });

  it('ARTIFACT_PREFIX values start with a domain root', () => {
    for (const v of Object.values(ARTIFACT_PREFIX)) {
      const ok = DOMAIN_ROOTS.some(root => v === root || v.startsWith(`${root}/`));
      expect(ok, `ARTIFACT_PREFIX value not under a domain root: ${v}`).toBe(true);
    }
  });

  it('FIGMA_CONFIG_PATH is the new visual/ui path', () => {
    expect(FIGMA_CONFIG_PATH).toBe('visual/ui/figma/figma.json');
  });

  it('repo source/template/docs trees contain no legacy path literals', () => {
    // ripgrep one-shot — fast and deterministic.
    const pattern = 'outputs/design|inputs/sources|inputs/assets|inputs/references|inputs/directives|outputs/evals';
    const targets = [
      'packages/ant-cli/src',
      'packages/ant-shared/src',
      'packages/ant-ui/src',
      'docs',
    ];
    // Allowlist entries are matched as `!**/${entry}*` globs by ripgrep.
    // Each entry is justified — see comment per entry. Adding a new
    // entry requires the same kind of structural reason; do not paper
    // over a bug by widening the allowlist.
    const allowlist = [
      // Phase D migration script — only place that intentionally names
      // legacy paths, used to lift them off disk into the new tree.
      'scripts/migrate-workspace-layout.mjs',
      // Existing `inputs/references` removal guard — keeps the OLD
      // literal as evidence of historical removal.
      'packages/ant-cli/tests/no-legacy-references.test.ts',
      // Self — this very test names every legacy literal in the regex.
      'packages/ant-cli/tests/legacy-path-residue.test.ts',
      // Phase handoff scratchpad (mapping tables include the legacy
      // literals as documentation). Phase D gitignores `docs/tmp/`,
      // after which this entry is redundant but harmless.
      'docs/tmp/',
    ];
    let stdout: string;
    try {
      stdout = execFileSync(
        'rg',
        [
          '--no-config',
          '--no-ignore-vcs',
          // ripgrep's `ts` filetype already matches both .ts and .tsx.
          '--type', 'ts',
          '--type', 'md',
          ...allowlist.flatMap(g => ['--glob', `!**/${g}*`]),
          pattern,
          ...targets,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
    } catch (err) {
      // rg exits 1 when no match — desired outcome.
      const status = (err as { status?: number }).status;
      if (status === 1) return;
      throw err;
    }
    const lines = stdout.split('\n').filter(Boolean);
    expect(
      lines,
      `Legacy path residue detected:\n${lines.slice(0, 20).join('\n')}${lines.length > 20 ? `\n…+${lines.length - 20} more` : ''}`,
    ).toEqual([]);
  });
});
