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

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertProjectSegment,
  assertWithinRoot,
  resolveWithinRoot,
} from '../../src/core/config/pathContainment.js';
import {
  activationFilePath,
  activationRunsDir,
  activationRunIndexPath,
  activationRunLogPath,
  deriveActivationsRoot,
} from '../../src/core/pipelines/paths.js';
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

describe('pipeline activation paths are single-segment (H-016 / M-025)', () => {
  // The activation helpers are the final boundary shared by the HTTP routes,
  // the reconciler, the run coordinator and the delete/rename cascade. A
  // traversal projectId/runId/userId must be rejected at the helper before it
  // reaches readFileSync / rmSync — no matter which caller reaches disk.
  const ACT_ROOT = '/workspaces/acme/alice/.ant/pipeline-activations';
  const CTX = {
    workspacesPath: '/workspaces',
    organizationId: 'acme',
    userId: 'alice',
    organizationKind: 'team' as const,
  };

  for (const [label, value] of REJECTED_PROJECT_IDS) {
    it(`activationFilePath rejects projectId: ${label}`, () => {
      expect(() => activationFilePath(ACT_ROOT, value)).toThrow();
    });
    it(`activationRunsDir rejects projectId: ${label}`, () => {
      expect(() => activationRunsDir(ACT_ROOT, value)).toThrow();
    });
    it(`activationRunIndexPath rejects projectId: ${label}`, () => {
      expect(() => activationRunIndexPath(ACT_ROOT, value)).toThrow();
    });
  }

  for (const [label, value] of REJECTED_PROJECT_IDS) {
    it(`activationRunLogPath rejects runId: ${label}`, () => {
      expect(() => activationRunLogPath(ACT_ROOT, 'ok-project', value)).toThrow();
    });
  }

  for (const [label, value] of REJECTED_PROJECT_IDS) {
    // M-025: a forged target userId must not re-anchor the activations root.
    it(`deriveActivationsRoot rejects userId: ${label}`, () => {
      expect(() => deriveActivationsRoot({ ...CTX, userId: value })).toThrow();
    });
  }

  it('accepts legitimate ids (incl. email userId)', () => {
    expect(() => activationFilePath(ACT_ROOT, 'my-project')).not.toThrow();
    expect(() => activationRunLogPath(ACT_ROOT, 'my-project', 'happy-brave-otter')).not.toThrow();
    expect(() => deriveActivationsRoot({ ...CTX, userId: 'probe@to.nexus' })).not.toThrow();
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
    // A bare `startsWith(root)` accepts this one: the sibling shares the root's
    // string prefix with no separator between them (report L-030).
    ['sibling prefix escape', '../feature-escaped', false],
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

describe('file routes anchor caller `dirPath` to the feature root (H-007 / L-030)', () => {
  let base: string;
  let featurePath: string;
  let router: any;

  const handlerFor = (method: 'post', routePath: string) =>
    router.stack.find(
      (l: any) => l.route?.path === routePath && l.route?.methods?.[method],
    ).route.stack.at(-1).handle;

  const call = async (handler: any, req: Record<string, unknown>) => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; },
    };
    await handler({ headers: {}, user: { id: 'alice' }, organization: { id: 'acme' }, ...req } as any, res);
    return res;
  };

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-files-route-'));
    featurePath = path.join(base, 'features', 'main');
    fs.mkdirSync(featurePath, { recursive: true });
    fs.symlinkSync(base, path.join(featurePath, 'escape-link'), 'dir');

    const { createFilesRoutes } = await import('../../src/periphery/adapters/http/routes/files.routes.js');
    router = createFilesRoutes({
      projectService: {
        workspaceResolver: { getFeaturePath: () => featurePath },
        resolveExistingFeatureForMutation: async () => featurePath,
      } as any,
    });
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const ESCAPES: Array<[label: string, dirPath: string]> = [
    ['parent traversal', '../../outside'],
    ['sibling prefix', '../main-escaped'],
    ['symlink escape', 'escape-link/planted'],
  ];

  for (const [label, dirPath] of ESCAPES) {
    it(`upload rejects ${label}`, async () => {
      const handler = handlerFor('post', '/projects/:id/features/:feature/upload');
      const res = await call(handler, {
        params: { id: 'p', feature: 'main' },
        body: { dirPath, relativePaths: ['x.txt'] },
        files: [{ originalname: 'x.txt', buffer: Buffer.from('x') }],
      });
      expect(res.statusCode).toBe(400);
      // pin the gate that answered, not just the status — 400 has other producers
      expect((res.body as any)?.error).toBe('Invalid directory path');
    });

    it(`directory create rejects ${label}`, async () => {
      const handler = handlerFor('post', '/projects/:id/features/:feature/directory');
      const res = await call(handler, {
        params: { id: 'p', feature: 'main' },
        body: { path: dirPath },
      });
      expect(res.statusCode).toBe(400);
      // pin the gate that answered, not just the status — 400 has other producers
      expect((res.body as any)?.error).toBe('Invalid directory path');
    });
  }

  it('directory create still makes a nested directory inside the feature', async () => {
    const handler = handlerFor('post', '/projects/:id/features/:feature/directory');
    const res = await call(handler, {
      params: { id: 'p', feature: 'main' },
      body: { path: 'docs/nested' },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(featurePath, 'docs', 'nested'))).toBe(true);
  });

  // The per-file destination axis: `dirPath` was checked, but each
  // `relativePaths[i]` was only string-prefix tested against it, so a symlink
  // already inside the feature tree carried the write out of the root (H-007).
  const DESTINATION_ESCAPES: Array<[label: string, relPath: string]> = [
    ['parent traversal', '../escaped.txt'],
    ['deep traversal', '../../escaped.txt'],
    ['symlink descendant', 'escape-link/planted.txt'],
    ['absolute path', path.join(os.tmpdir(), 'ant-planted-absolute.txt')],
  ];

  for (const [label, relPath] of DESTINATION_ESCAPES) {
    it(`upload rejects a per-file destination with ${label}`, async () => {
      const handler = handlerFor('post', '/projects/:id/features/:feature/upload');
      const res = await call(handler, {
        params: { id: 'p', feature: 'main' },
        body: { dirPath: '', relativePaths: [relPath] },
        files: [{ originalname: 'x.txt', buffer: Buffer.from('x') }],
      });
      expect(res.statusCode).toBe(400);
      expect((res.body as any)?.error).toBe('Invalid file path');
    });
  }

  it('upload still writes a legitimate nested destination', async () => {
    const handler = handlerFor('post', '/projects/:id/features/:feature/upload');
    const res = await call(handler, {
      params: { id: 'p', feature: 'main' },
      body: { dirPath: '', relativePaths: ['nested/ok.txt'] },
      files: [{ originalname: 'ok.txt', buffer: Buffer.from('ok') }],
    });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(featurePath, 'nested', 'ok.txt'), 'utf8')).toBe('ok');
  });

  it('upload is all-or-nothing when one destination escapes', async () => {
    const handler = handlerFor('post', '/projects/:id/features/:feature/upload');
    const res = await call(handler, {
      params: { id: 'p', feature: 'main' },
      body: { dirPath: '', relativePaths: ['first.txt', '../bad.txt'] },
      files: [
        { originalname: 'first.txt', buffer: Buffer.from('a') },
        { originalname: 'bad.txt', buffer: Buffer.from('b') },
      ],
    });
    expect(res.statusCode).toBe(400);
    // the valid member must NOT have been ingested before the bad one was seen
    expect(fs.existsSync(path.join(featurePath, 'first.txt'))).toBe(false);
  });

  const RENAME_ESCAPES: Array<[label: string, body: Record<string, string>]> = [
    ['traversal in oldPath', { oldPath: '../escaped.txt', newPath: 'y.txt' }],
    ['traversal in newPath', { oldPath: 'src.txt', newPath: '../escaped.txt' }],
    ['symlink descendant in newPath', { oldPath: 'src.txt', newPath: 'escape-link/planted.txt' }],
  ];

  for (const [label, body] of RENAME_ESCAPES) {
    it(`rename rejects ${label}`, async () => {
      fs.writeFileSync(path.join(featurePath, 'src.txt'), 'v');
      const handler = router.stack.find(
        (l: any) => l.route?.path === '/projects/:id/features/:feature/rename' && l.route?.methods?.patch,
      ).route.stack.at(-1).handle;
      const res = await call(handler, { params: { id: 'p', feature: 'main' }, body });
      expect(res.statusCode).toBe(400);
      expect((res.body as any)?.error).toBe('Invalid file path');
    });
  }

  it('no escaped directory or file was created by any rejected request', () => {
    expect(fs.existsSync(path.join(base, 'features', 'main-escaped'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'outside'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'planted'))).toBe(false);
    // the destination axis: a write that escaped would land here
    expect(fs.existsSync(path.join(base, 'escaped.txt'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'planted.txt'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'features', 'escaped.txt'))).toBe(false);
    expect(fs.existsSync(path.join(os.tmpdir(), 'ant-planted-absolute.txt'))).toBe(false);
  });
});

describe('preview connection source stays in the workspace (H-003)', () => {
  let workspace: string;

  let outside: string;

  beforeAll(() => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-conn-parent-'));
    workspace = path.join(parent, 'workspace');
    outside = path.join(parent, 'outside');
    fs.mkdirSync(path.join(workspace, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'existing'), { recursive: true });
    // an escaping link and an inward link, both inside the workspace
    fs.symlinkSync(outside, path.join(workspace, 'jump'), 'dir');
    fs.symlinkSync(path.join(workspace, 'apps'), path.join(workspace, 'inlink'), 'dir');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(workspace), { recursive: true, force: true });
  });

  const CASES: Array<[label: string, source: string | undefined, allowed: boolean]> = [
    ['workspace-global "*"', '*', true],
    ['undefined source', undefined, true],
    ['monorepo subdir', 'apps/web', true],
    ['not-yet-created subdir', 'apps/api', true],
    ['deep not-yet-created chain', 'apps/api/sub/deeper', true],
    ['not-yet-created subdir under an inward link', 'inlink/new-package', true],
    ['parent traversal', '../other-user/project/codebase', false],
    ['deep traversal', '../../../../etc', false],
    ['absolute path', '/etc', false],
    // The finding: the leaf does not exist, so the old existence-gated realpath
    // check never looked at `jump` — and the writers then created the directory
    // and its `.env` outside the workspace.
    ['not-yet-created subdir under an escaping link', 'jump/new-package', false],
    ['existing subdir under an escaping link', 'jump/existing', false],
    ['the escaping link itself', 'jump', false],
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

  // H-010: the walk gate and the read gate were separate `realpath` calls, and
  // the read then re-opened the ORIGINAL name.
  it('indexFile refuses a path whose canonical target left the root', async () => {
    const { CodebaseIndexer } = await import('../../src/core/codebase/CodebaseIndexer.js');
    const chunk = { process: vi.fn(async () => ({ chunks: [], stats: { avgTokens: 0 } })) };
    const result = await (CodebaseIndexer.prototype as any)['indexFile'].call(
      Object.create(CodebaseIndexer.prototype),
      path.join(root, 'stolen', 'credentials.json'),
      root,
      'proj',
      'main',
      'abc123',
      { vectorDB: { delete: vi.fn(async () => {}), store: vi.fn(async () => {}) }, chunk },
    );
    expect(result).toEqual({ chunks: 0, tokens: 0 });
    expect(chunk.process).not.toHaveBeenCalled();
  });

  it('indexFile reads the resolved target but keeps the requested name as identity', async () => {
    const { CodebaseIndexer } = await import('../../src/core/codebase/CodebaseIndexer.js');
    const chunk = { process: vi.fn(async () => ({ chunks: [], stats: { avgTokens: 0 } })) };
    const vectorDB = { delete: vi.fn(async () => {}), store: vi.fn(async () => {}) };
    await (CodebaseIndexer.prototype as any)['indexFile'].call(
      Object.create(CodebaseIndexer.prototype),
      path.join(root, 'src-link', 'app.ts'),
      root,
      'proj',
      'main',
      'abc123',
      { vectorDB, chunk },
    );
    // content came from the resolved target...
    expect(chunk.process).toHaveBeenCalled();
    const processed = (chunk.process as any).mock.calls[0][0];
    expect(processed.content).toContain('export const a = 1;');
    // ...but identity stays on the link name, or previously stored chunks of
    // that path would be orphaned by the incremental delete.
    expect(processed.source).toContain('src-link');
    expect(processed.metadata.filePath).toContain('src-link');
    const deleteFilter = JSON.stringify((vectorDB.delete as any).mock.calls[0]?.[1] ?? {});
    expect(deleteFilter).toContain('src-link');
  });
});

/**
 * H-010 / H-011 — the shared primitive. Containment must bind to the file
 * object, not to a name that can be repointed after the check.
 */
describe('contained I/O binds the read to the resolved target (H-010 / H-011)', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-containedio-'));
    root = path.join(base, 'root');
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, 'plan'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(root, 'plan', 'prd.md'), 'contained content');
    fs.writeFileSync(path.join(outside, 'secret.env'), 'ANT_JWT_SECRET=leak');
    fs.symlinkSync(path.join(root, 'plan'), path.join(root, 'plan-link'), 'dir');
    fs.symlinkSync(outside, path.join(root, 'escape-link'), 'dir');
    fs.symlinkSync(path.join(outside, 'secret.env'), path.join(root, 'leaf-link'));
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'broken'));
  });

  afterAll(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  const CASES: Array<[label: string, target: string, ok: boolean, reason?: string]> = [
    ['plain file', 'plan/prd.md', true],
    ['inward symlink directory', 'plan-link/prd.md', true],
    ['outward symlink file', 'leaf-link', false],
    ['outward symlink parent', 'escape-link/secret.env', false],
    ['parent traversal', '../outside/secret.env', false],
    ['dangling symlink', 'broken', false, 'missing'],
    ['directory where a file was expected', 'plan', false, 'not-a-file'],
  ];

  for (const [label, target, ok, reason] of CASES) {
    it(`${ok ? 'reads' : 'refuses'} ${label}`, async () => {
      const { readTextContained } = await import('../../src/core/config/containedIo.js');
      const result = readTextContained(root, target);
      expect(result.ok).toBe(ok);
      if (ok) expect((result as any).text).toBe('contained content');
      if (reason) expect((result as any).reason).toBe(reason);
    });
  }

  it('canonicalPath is the resolved target, not the requested name', async () => {
    const { readTextContained } = await import('../../src/core/config/containedIo.js');
    const result = readTextContained(root, 'plan-link/prd.md');
    expect(result.ok).toBe(true);
    expect((result as any).canonicalPath.endsWith(path.join('plan', 'prd.md'))).toBe(true);
  });

  it('enforces maxBytes off the descriptor, reading nothing', async () => {
    const { readTextContained } = await import('../../src/core/config/containedIo.js');
    const result = readTextContained(root, 'plan/prd.md', { maxBytes: 4 });
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });

  it('an absolute path inside the root is accepted', async () => {
    const { readTextContained } = await import('../../src/core/config/containedIo.js');
    expect(readTextContained(root, path.join(root, 'plan', 'prd.md')).ok).toBe(true);
  });

  // The TOCTOU row. A real race is not deterministic in a unit test, so it is
  // pinned at the seam instead: `openCanonical` receives a path that
  // containment already blessed, and must refuse it if a symlink is sitting
  // there at open time — which is exactly the post-check swap.
  it.skipIf(process.platform === 'win32')(
    'the open refuses a canonical path that became a symlink after resolution',
    async () => {
      const { openCanonical } = await import('../../src/core/config/containedIo.js');
      const swapped = path.join(root, 'plan', 'swapped.md');
      fs.symlinkSync(path.join(outside, 'secret.env'), swapped);
      try {
        expect(openCanonical(swapped)).toEqual({ ok: false, reason: 'swapped' });

        // control: a target that stayed a regular file still opens, so the row
        // above cannot be satisfied by "always fails"
        const ok = openCanonical(path.join(root, 'plan', 'prd.md'));
        expect('fd' in ok).toBe(true);
        if ('fd' in ok) fs.closeSync(ok.fd);
      } finally {
        fs.rmSync(swapped, { force: true });
      }
    },
  );
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
