/**
 * L1 — `applyCodeCommandPolicy` install-locality guard invariants.
 *
 * Cross-task guard added in Section B of the test-code-script-wiring +
 * monorepo-install-locality plan. The guard's contract:
 *
 *   - REJECT mutating dependency commands (install / add / remove and
 *     manager-specific equivalents) issued from a member directory when
 *     the codebase root carries a workspace marker.
 *   - PASS THROUGH read-only commands (--version / why / ls / cat) even
 *     from member dirs.
 *   - PASS THROUGH all install commands when the cwd resolves to the
 *     workspace root itself.
 *   - PASS THROUGH per-member installs for `go-workspace` (Go's per-
 *     module dependency-graph design — see partial).
 *   - PASS THROUGH every command in single-package projects (no marker).
 *
 * Marker matrix exercised:
 *   pnpm-workspace.yaml | package.json#workspaces (npm) | Cargo.toml [workspace]
 *   go.work             | pyproject.toml [tool.uv.workspace]
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyCodeCommandPolicy } from '../../src/agents/common/tool/handlers/codeCommandPolicy';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

interface FixtureOpts {
  marker:
    | 'pnpm-workspace.yaml'
    | 'package.json'
    | 'Cargo.toml'
    | 'go.work'
    | 'pyproject.toml'
    | 'none';
  /** Member directory name to create under codebase/ (defaults to 'packages/app'). */
  member?: string;
}

function makeFixture(opts: FixtureOpts): { featurePath: string; codebaseAbs: string; memberAbs: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ant-installlocality-'));
  const featurePath = root;
  const codebaseAbs = path.join(featurePath, 'codebase');
  const member = opts.member ?? 'packages/app';
  const memberAbs = path.join(codebaseAbs, member);
  mkdirSync(memberAbs, { recursive: true });

  switch (opts.marker) {
    case 'pnpm-workspace.yaml':
      writeFileSync(path.join(codebaseAbs, 'pnpm-workspace.yaml'), `packages:\n  - "packages/*"\n`);
      writeFileSync(path.join(memberAbs, 'package.json'), '{}');
      break;
    case 'package.json':
      writeFileSync(path.join(codebaseAbs, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      writeFileSync(path.join(memberAbs, 'package.json'), '{}');
      break;
    case 'Cargo.toml':
      writeFileSync(
        path.join(codebaseAbs, 'Cargo.toml'),
        `[workspace]\nmembers = ["packages/app"]\n`,
      );
      writeFileSync(path.join(memberAbs, 'Cargo.toml'), '[package]\nname = "app"\n');
      break;
    case 'go.work':
      writeFileSync(path.join(codebaseAbs, 'go.work'), `go 1.21\n\nuse (\n  ./packages/app\n)\n`);
      writeFileSync(path.join(memberAbs, 'go.mod'), 'module app\n');
      break;
    case 'pyproject.toml':
      writeFileSync(
        path.join(codebaseAbs, 'pyproject.toml'),
        `[tool.uv.workspace]\nmembers = ["packages/app"]\n`,
      );
      writeFileSync(path.join(memberAbs, 'pyproject.toml'), '[project]\nname = "app"\n');
      break;
    case 'none':
      // Single-package codebase — only the member dir, no marker.
      writeFileSync(path.join(memberAbs, 'package.json'), '{}');
      break;
  }

  return {
    featurePath,
    codebaseAbs,
    memberAbs,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeCtx(opts: { featurePath?: string; taskType?: string } = {}): ToolExecutionContext {
  return {
    activePhase: 'plan',
    currentTaskType: opts.taskType ?? 'feature',
    verifyModeActive: false,
    fileSystem: undefined as any,
    chatStatus: undefined as any,
    workingDir: '/tmp',
    featurePath: opts.featurePath,
  } as unknown as ToolExecutionContext;
}

describe('codeCommandPolicy — install-locality guard (B5)', () => {
  let fixtures: Array<{ cleanup: () => void }> = [];
  afterEach(() => {
    for (const f of fixtures) f.cleanup();
    fixtures = [];
  });
  function track<T extends { cleanup: () => void }>(f: T): T {
    fixtures.push(f);
    return f;
  }

  describe('marker matrix — REJECT install from member dir', () => {
    it('rejects `pnpm add` from a member dir when pnpm-workspace.yaml marks the root', () => {
      const fx = track(makeFixture({ marker: 'pnpm-workspace.yaml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      const result = applyCodeCommandPolicy(ctx, {
        command: 'pnpm add lodash',
        working_directory: 'codebase/packages/app',
      });
      expect(result).not.toBeNull();
      expect(result!.content).toMatch(/\[Policy\]/);
      expect(result!.content).toMatch(/BLOCKED/);
      expect(result!.content).toMatch(/pnpm-workspace/);
      expect(result!.content).toMatch(/workspace root/i);
    });

    it('rejects `npm install <pkg>` from a member dir when package.json#workspaces marks the root', () => {
      const fx = track(makeFixture({ marker: 'package.json' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      const result = applyCodeCommandPolicy(ctx, {
        command: 'npm install lodash',
        working_directory: 'codebase/packages/app',
      });
      expect(result?.content).toMatch(/BLOCKED/);
      expect(result?.content).toMatch(/npm-workspaces/);
    });

    it('rejects `cargo add` from a member dir when Cargo.toml [workspace] marks the root', () => {
      const fx = track(makeFixture({ marker: 'Cargo.toml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      const result = applyCodeCommandPolicy(ctx, {
        command: 'cargo add serde',
        working_directory: 'codebase/packages/app',
      });
      expect(result?.content).toMatch(/BLOCKED/);
      expect(result?.content).toMatch(/cargo-workspace/);
    });

    it('rejects `uv add` from a member dir when [tool.uv.workspace] marks the root', () => {
      const fx = track(makeFixture({ marker: 'pyproject.toml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      const result = applyCodeCommandPolicy(ctx, {
        command: 'uv add httpx',
        working_directory: 'codebase/packages/app',
      });
      expect(result?.content).toMatch(/BLOCKED/);
      expect(result?.content).toMatch(/uv-workspace/);
    });

    it('rejects `pnpm remove` and `pnpm install` (bare) — both are mutating', () => {
      const fx = track(makeFixture({ marker: 'pnpm-workspace.yaml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      for (const cmd of ['pnpm remove lodash', 'pnpm install', 'pnpm i', 'yarn add react']) {
        const result = applyCodeCommandPolicy(ctx, {
          command: cmd,
          working_directory: 'codebase/packages/app',
        });
        expect(result?.content, `${cmd} should be rejected`).toMatch(/BLOCKED/);
      }
    });
  });

  describe('marker matrix — PASS THROUGH when cwd is the workspace root', () => {
    it('allows `pnpm add` from codebase root', () => {
      const fx = track(makeFixture({ marker: 'pnpm-workspace.yaml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      // working_directory undefined defaults to codebase root.
      const r1 = applyCodeCommandPolicy(ctx, { command: 'pnpm add -Dw vitest' });
      expect(r1).toBeNull();
      // Explicit `codebase` cwd resolves to the same root.
      const r2 = applyCodeCommandPolicy(ctx, {
        command: 'pnpm add -Dw vitest',
        working_directory: 'codebase',
      });
      expect(r2).toBeNull();
    });

    it('allows `cargo add --workspace` from root', () => {
      const fx = track(makeFixture({ marker: 'Cargo.toml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      const result = applyCodeCommandPolicy(ctx, { command: 'cargo add --workspace serde' });
      expect(result).toBeNull();
    });
  });

  describe('go-workspace — per-member install is the canonical flow', () => {
    it('PASSES THROUGH `go get` from a member dir when go.work marks the root', () => {
      const fx = track(makeFixture({ marker: 'go.work' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      // `go get` is intentionally NOT in LOCALITY_INSTALL_PATTERNS, so the
      // guard never fires — even if cwd is a member dir.
      const result = applyCodeCommandPolicy(ctx, {
        command: 'go get github.com/foo/bar',
        working_directory: 'codebase/packages/app',
      });
      expect(result).toBeNull();
    });
  });

  describe('single-package — guard does not fire', () => {
    it('PASSES THROUGH `pnpm add` even from a member-shaped dir when no marker exists', () => {
      const fx = track(makeFixture({ marker: 'none' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      const result = applyCodeCommandPolicy(ctx, {
        command: 'pnpm add lodash',
        working_directory: 'codebase/packages/app',
      });
      expect(result).toBeNull();
    });
  });

  describe('read-only commands — PASS THROUGH from any cwd', () => {
    it('allows `pnpm why` and `vitest --version` from a member dir even with marker', () => {
      const fx = track(makeFixture({ marker: 'pnpm-workspace.yaml' }));
      const ctx = makeCtx({ featurePath: fx.featurePath });
      for (const cmd of ['pnpm why vitest', 'npx vitest --version', 'cat package.json', 'ls']) {
        const result = applyCodeCommandPolicy(ctx, {
          command: cmd,
          working_directory: 'codebase/packages/app',
        });
        expect(result, `${cmd} should not be rejected by locality guard`).toBeNull();
      }
    });
  });

  describe('feature path absent — guard fails open', () => {
    it('does not crash when ctx.featurePath is undefined', () => {
      const ctx = makeCtx({ featurePath: undefined });
      const result = applyCodeCommandPolicy(ctx, {
        command: 'pnpm add lodash',
        working_directory: 'packages/app',
      });
      expect(result).toBeNull();
    });
  });
});
