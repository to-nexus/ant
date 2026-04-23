/**
 * buildModifyTargetsSection — path normalization regression tests.
 *
 * Guards against the `lapis-bonding-fruit` bug where plan.modify targets
 * like `src/components/navbar.tsx` were passed to `fileSystem.readFile`
 * without the `codebase/` prefix. The resulting "file not found on disk"
 * injection pushed the LLM into `<file>` (overwrite) instead of
 * `edit_file`. Every modify target in a code job MUST resolve through
 * `normalizeToCodebasePath` before the disk read.
 */

import { describe, it, expect } from 'vitest';
import { buildModifyTargetsSection } from '../../src/agents/architect/graph/code/nodes/execute/buildMessages';
import type { FileSystemPort } from '../../src/core/ports/filesystem';

function fakeFs(files: Record<string, string>, rootPath = '/workspace'): FileSystemPort {
  return {
    readFile: async (p: string) => (files[p] ?? null),
    writeFile: async () => {},
    fileExists: async (p: string) => p in files,
    deleteFile: async () => {},
    readDirectory: async () => [],
    createDirectory: async () => {},
    listFiles: async () => [],
    getRootPath: () => rootPath,
    getBasePath: () => rootPath,
  } as unknown as FileSystemPort;
}

function fakeGit(repoRoot: string) {
  return {
    getRepoRoot: async () => repoRoot,
  } as any;
}

function stateWithPlan(
  planText: string,
  files: Record<string, string>,
  opts?: { rootPath?: string; repoRoot?: string; noGit?: boolean }
): any {
  const rootPath = opts?.rootPath ?? '/ws';
  return {
    planText,
    deps: {
      fileSystem: fakeFs(files, rootPath),
      git: opts?.noGit ? undefined : fakeGit(opts?.repoRoot ?? `${rootPath}/codebase`),
    },
  };
}

describe('buildModifyTargetsSection', () => {
  it('returns null when planText has no modify entries', async () => {
    const state = stateWithPlan(
      JSON.stringify({ implementation: { modify: [] } }),
      {},
    );
    expect(await buildModifyTargetsSection(state)).toBeNull();
  });

  it('prefixes `codebase/` onto bare plan targets and reads them', async () => {
    const planText = JSON.stringify({
      implementation: {
        modify: [{ target: 'src/components/navbar.tsx' }],
      },
    });
    const files = {
      'codebase/src/components/navbar.tsx': 'export const Navbar = () => null;\n',
    };

    const out = await buildModifyTargetsSection(stateWithPlan(planText, files));

    expect(out).not.toBeNull();
    expect(out).toContain('### src/components/navbar.tsx');
    expect(out).toContain('export const Navbar = () => null;');
    expect(out).not.toContain('file not found on disk');
  });

  it('surfaces missing targets with the new wording (no "treat as new creation")', async () => {
    const planText = JSON.stringify({
      implementation: {
        modify: [{ target: 'src/does-not-exist.tsx' }],
      },
    });

    const out = await buildModifyTargetsSection(stateWithPlan(planText, {}));

    expect(out).not.toBeNull();
    expect(out).toContain('file not found on disk');
    // New guidance: must NOT include the wording that historically pushed
    // the LLM into <file> overwrites.
    expect(out).not.toMatch(/treat as new creation/i);
    // New guidance: must direct the LLM to verify via read_file and
    // prefer edit_file on the correct path.
    expect(out).toMatch(/read_file/);
    expect(out).toMatch(/edit_file/);
  });

  it('keeps already-prefixed paths untouched (idempotency)', async () => {
    const planText = JSON.stringify({
      implementation: {
        modify: [{ target: 'codebase/src/app/page.tsx' }],
      },
    });
    const files = {
      'codebase/src/app/page.tsx': '// page\n',
    };

    const out = await buildModifyTargetsSection(stateWithPlan(planText, files));

    expect(out).toContain('### codebase/src/app/page.tsx');
    expect(out).toContain('// page');
    expect(out).not.toContain('file not found on disk');
  });

  it('falls back to `codebase` default when git/fileSystem roots are unavailable', async () => {
    const planText = JSON.stringify({
      implementation: {
        modify: [{ target: 'src/util.ts' }],
      },
    });
    const files = {
      'codebase/src/util.ts': '// util\n',
    };

    // No gitPort → resolveCodebaseRel returns 'codebase' default.
    const state = stateWithPlan(planText, files, { noGit: true });
    const out = await buildModifyTargetsSection(state);

    expect(out).toContain('### src/util.ts');
    expect(out).toContain('// util');
  });
});
