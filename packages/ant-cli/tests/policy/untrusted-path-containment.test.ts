/**
 * Untrusted-path containment — every sink that joins caller-supplied path
 * material onto a trusted root must reject traversal and symlink escape.
 *
 * One axis, one row per sink. The four sinks share the same failure shape
 * (`path.join(trustedRoot, userInput)` with no containment check) and were
 * reported separately only because they live in different subsystems:
 *
 *   - workspace resolver   — `projectId` URL segment  (report C-002)
 *   - codebase indexer     — symlink inside a cloned repo (report H-002)
 *   - preview connections  — `connection.source` subdir  (report H-003)
 *   - RAC artifact loader  — `actionMetadata.refs/context` (report H-004)
 *
 * Assertions are on the GATE (accept / reject), never on message prose.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertProjectSegment,
  assertWithinRoot,
  resolveWithinRoot,
} from '../../src/core/config/pathContainment.js';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver.js';
import { WorkspaceServiceAdapter } from '../../src/infrastructure/workspace/WorkspaceServiceAdapter.js';
import { resolveConnectionDir } from '../../src/periphery/adapters/http/services/PreviewService/utils/connectionDir.js';
import { executeJobSchema } from '../../src/periphery/adapters/http/middleware/validateBody.js';

const USER = { organizationId: 'acme', userId: 'alice' };

/** projectId values no legitimate client produces (creation enforces `^[a-zA-Z0-9_-]+$`). */
const REJECTED_PROJECT_IDS: Array<[label: string, value: string]> = [
  ['parent traversal', '../victim'],
  ['nested traversal', '../../acme/bob/victim'],
  ['bare dotdot', '..'],
  ['bare dot', '.'],
  ['embedded separator', 'a/b'],
  ['backslash separator', 'a\\b'],
  ['absolute path', '/etc'],
  ['NUL byte', 'proj\0'],
  ['empty', ''],
];

const ACCEPTED_PROJECT_IDS = ['my-project', 'project_1', 'Proj123'];

describe('projectId is a single path segment (C-002)', () => {
  // Both WorkspaceResolver implementations must agree — every feature /
  // codebase / git-anchor / universal path derives from getProjectPath.
  const resolvers: Array<[string, { getProjectPath(u: typeof USER, p: string): string }]> = [
    ['UnifiedWorkspaceResolver', new UnifiedWorkspaceResolver('/workspaces')],
    ['WorkspaceServiceAdapter', new WorkspaceServiceAdapter({} as any, '/workspaces')],
  ];

  for (const [name, resolver] of resolvers) {
    for (const [label, value] of REJECTED_PROJECT_IDS) {
      it(`${name} rejects ${label}`, () => {
        expect(() => resolver.getProjectPath(USER, value)).toThrow();
      });
    }

    for (const value of ACCEPTED_PROJECT_IDS) {
      it(`${name} accepts ${value}`, () => {
        const resolved = resolver.getProjectPath(USER, value);
        expect(resolved.endsWith(path.join('alice', value))).toBe(true);
      });
    }
  }

  it('assertProjectSegment returns the input unchanged when accepted', () => {
    expect(assertProjectSegment('ok-project')).toBe('ok-project');
  });
});

describe('feature-root containment (C-002 / H-004)', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-containment-'));
    root = path.join(base, 'feature');
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, 'plan'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(root, 'plan', 'prd.md'), '# prd');
    fs.writeFileSync(path.join(outside, 'secret.env'), 'TOKEN=1');
    // A link planted INSIDE the root that points OUT of it.
    fs.symlinkSync(outside, path.join(root, 'escape-link'), 'dir');
    // A link inside the root that stays inside it — must remain usable.
    fs.symlinkSync(path.join(root, 'plan'), path.join(root, 'plan-link'), 'dir');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  const CASES: Array<[label: string, relPath: string, contained: boolean]> = [
    ['normal file', 'plan/prd.md', true],
    ['root itself', '.', true],
    ['nested new file (does not exist yet)', 'plan/new/sub.md', true],
    ['inward symlink', 'plan-link/prd.md', true],
    ['parent traversal', '../outside/secret.env', false],
    ['deep traversal', '../../../../etc/passwd', false],
    ['absolute path', '/etc/passwd', false],
    ['symlink escape', 'escape-link/secret.env', false],
  ];

  for (const [label, relPath, contained] of CASES) {
    it(`${contained ? 'allows' : 'rejects'} ${label}`, () => {
      if (contained) {
        expect(() => assertWithinRoot(root, relPath)).not.toThrow();
        expect(resolveWithinRoot(root, relPath)).not.toBeNull();
      } else {
        expect(() => assertWithinRoot(root, relPath)).toThrow();
        expect(resolveWithinRoot(root, relPath)).toBeNull();
      }
    });
  }
});

describe('preview connection source stays in the workspace (H-003)', () => {
  let workspace: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-conn-'));
    fs.mkdirSync(path.join(workspace, 'apps', 'web'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const CASES: Array<[label: string, source: string | undefined, allowed: boolean]> = [
    ['workspace-global "*"', '*', true],
    ['undefined source', undefined, true],
    ['monorepo subdir', 'apps/web', true],
    ['not-yet-created subdir', 'apps/api', true],
    ['parent traversal', '../other-user/project/codebase', false],
    ['deep traversal', '../../../../etc', false],
    ['absolute path', '/etc', false],
  ];

  for (const [label, source, allowed] of CASES) {
    it(`${allowed ? 'allows' : 'rejects'} ${label}`, () => {
      if (allowed) expect(() => resolveConnectionDir(workspace, source)).not.toThrow();
      else expect(() => resolveConnectionDir(workspace, source)).toThrow();
    });
  }

  it('resolves "*" to the workspace root itself', () => {
    expect(resolveConnectionDir(workspace, '*')).toBe(path.resolve(workspace));
  });
});

describe('codebase indexer does not follow links out of the clone root (H-002)', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-indexer-'));
    root = path.join(base, 'clone');
    outside = path.join(base, 'service');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(outside, 'credentials.json'), '{"pat":"secret"}');
    fs.symlinkSync(outside, path.join(root, 'stolen'), 'dir');
    fs.symlinkSync(path.join(root, 'src'), path.join(root, 'src-link'), 'dir');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it('a link pointing outside the clone root is refused', async () => {
    const { CodebaseIndexer } = await import('../../src/core/codebase/CodebaseIndexer.js');
    const files: string[] = await (CodebaseIndexer.prototype as any)['getSourceFiles'].call(
      Object.create(CodebaseIndexer.prototype),
      root,
      [],
    );
    expect(files.some(f => f.includes('credentials.json'))).toBe(false);
    expect(files.some(f => f.includes('stolen'))).toBe(false);
  });

  it('ordinary files and inward links are still indexed', async () => {
    const { CodebaseIndexer } = await import('../../src/core/codebase/CodebaseIndexer.js');
    const files: string[] = await (CodebaseIndexer.prototype as any)['getSourceFiles'].call(
      Object.create(CodebaseIndexer.prototype),
      root,
      [],
    );
    expect(files.some(f => f.endsWith(path.join('src', 'app.ts')))).toBe(true);
    expect(files.some(f => f.includes('src-link'))).toBe(true);
  });
});

describe('env keys written to a project .env are bare names (H-003)', () => {
  const write = async (key: string) => {
    const { setEnvValue } = await import(
      '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter.js'
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envkey-'));
    try { setEnvValue(path.join(dir, '.env'), key, 'true'); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  const CASES: Array<[label: string, key: string, ok: boolean]> = [
    ['plain toggle var', 'USE_MOCK_AUTH', true],
    ['framework-prefixed', 'NEXT_PUBLIC_USE_MOCK_AUTH', true],
    ['leading underscore', '_INTERNAL', true],
    ['newline injection', 'USE_MOCK_AUTH=true\nADMIN', false],
    ['carriage-return injection', 'A\rB', false],
    ['embedded equals', 'A=B', false],
    ['space', 'A B', false],
    ['leading digit', '1BAD', false],
    ['empty', '', false],
  ];

  for (const [label, key, ok] of CASES) {
    it(`${ok ? 'accepts' : 'rejects'} ${label}`, async () => {
      if (ok) await expect(write(key)).resolves.toBeUndefined();
      else await expect(write(key)).rejects.toThrow();
    });
  }
});

describe('actionMetadata RAC paths are relative and traversal-free (H-004)', () => {
  const parse = (metadata: unknown) =>
    executeJobSchema.safeParse({ task: 'code', actionMetadata: metadata });

  const CASES: Array<[label: string, metadata: unknown, ok: boolean]> = [
    ['normal ref + context', { refs: ['plan/prd.md'], context: ['architecture/spec/'] }, true],
    ['empty arrays', { refs: [], context: [] }, true],
    ['no path fields at all', { intent: 'build-feature' }, true],
    ['traversal in refs', { refs: ['../../../../victim/features/main/.env'] }, false],
    ['traversal in context', { context: ['../victim/plan/prd.md'] }, false],
    ['absolute posix path', { refs: ['/etc/passwd'] }, false],
    ['absolute windows path', { refs: ['C:\\secrets\\a.txt'] }, false],
    ['backslash traversal', { refs: ['..\\..\\victim'] }, false],
    ['NUL byte', { refs: ['plan/prd.md\0'] }, false],
  ];

  for (const [label, metadata, ok] of CASES) {
    it(`${ok ? 'accepts' : 'rejects'} ${label}`, () => {
      expect(parse(metadata).success).toBe(ok);
    });
  }

  it('a dotdot-looking filename is not a traversal', () => {
    // Only a whole `..` SEGMENT escapes; `..foo` is an ordinary name.
    expect(parse({ refs: ['plan/..prd.md'] }).success).toBe(true);
  });
});
