/**
 * FileOperationService universal seam — the chokepoint every canonical file
 * route passes through. Truth table: universal-feature requests resolve into
 * the container's merged view; canonical projects are untouched (null
 * branch); and NO code path materializes a phantom `features/universal`.
 *
 * Also covers the SSE peer (`FileTreeBroadcaster`): both writers of the shared
 * `ARTIFACTS.FILETREE` cache key must emit the SAME merged shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FileNode } from '@ant/shared';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import { FileOperationService } from '../../src/periphery/adapters/http/services/ProjectService/FileOperationService';
import { resolveFeatureScopedFilePath } from '../../src/periphery/adapters/http/routes/helpers/featureFiles';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';

const redisWrites: Array<{ key: string; value: string }> = [];

vi.mock('ioredis', () => {
  class MockRedis {
    on() { return this; }
    async set(key: string, value: string, ..._rest: unknown[]) {
      redisWrites.push({ key, value });
      return 'OK' as const;
    }
    async publish() { return 1; }
    async quit() { return 'OK' as const; }
  }
  return { Redis: MockRedis, default: MockRedis };
});

const { FileTreeBroadcaster } = await import('../../src/core/realtime/FileTreeBroadcaster');

let workspaceRoot: string;
let projectPath: string;

const userContext = { userId: 'u', organizationId: 'o' } as any;

function makeResolver(): WorkspaceResolver {
  return {
    getProjectPath: (_ctx: unknown, projectId: string) => path.join(workspaceRoot, projectId),
    getFeaturePath: (_ctx: unknown, projectId: string, featureName: string) =>
      path.join(workspaceRoot, projectId, 'features', featureName),
  } as unknown as WorkspaceResolver;
}

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-fileop-seam-'));
  projectPath = path.join(workspaceRoot, 'proj');
  fs.mkdirSync(projectPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

function markUniversal(): void {
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({ projectType: 'universal' }));
  fs.mkdirSync(path.join(projectPath, 'universal', 'artifacts', 'plan'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'universal', 'sessions'), { recursive: true });
}

describe('FileOperationService — universal seam truth table', () => {
  it('write + read resolve into {container}/artifacts (round-trip)', async () => {
    markUniversal();
    const svc = new FileOperationService(makeResolver());
    await svc.writeFile('proj', UNIVERSAL_FEATURE, 'plan/notes.md', '# notes', userContext);
    expect(fs.existsSync(path.join(projectPath, 'universal', 'artifacts', 'plan', 'notes.md'))).toBe(true);
    const resource = await svc.readFile('proj', UNIVERSAL_FEATURE, 'plan/notes.md', userContext);
    expect(resource.content).toBe('# notes');
  });

  it('sessions/** reads resolve into {container}/sessions (grafted node)', async () => {
    markUniversal();
    fs.writeFileSync(path.join(projectPath, 'universal', 'sessions', 'chat.jsonl'), '{"a":1}\n');
    const svc = new FileOperationService(makeResolver());
    const resource = await svc.readFile('proj', UNIVERSAL_FEATURE, 'sessions/chat.jsonl', userContext);
    expect(resource.content).toBe('{"a":1}\n');
  });

  it('getFileTree returns the merged view WITHOUT canonical scaffolding', async () => {
    markUniversal();
    fs.writeFileSync(path.join(projectPath, 'universal', 'artifacts', 'plan', 'p.md'), 'x');
    const svc = new FileOperationService(makeResolver());
    const tree = await svc.getFileTree('proj', UNIVERSAL_FEATURE, userContext);
    expect(tree[0]).toMatchObject({ name: 'plan', type: 'directory' });
    expect(tree[tree.length - 1]).toMatchObject({ name: 'sessions', type: 'directory' });
    expect(tree.some((n) => n.name === 'architecture')).toBe(false);
    // File meta shape preserved (fileSlice / stale detection compatibility).
    const planFile = tree[0].children?.find((c) => c.name === 'p.md');
    expect(planFile?.type).toBe('file');
    expect(planFile && 'meta' in planFile).toBe(true);
  });

  it('INVARIANT: no universal file op ever creates features/universal', async () => {
    markUniversal();
    const svc = new FileOperationService(makeResolver());
    await svc.writeFile('proj', UNIVERSAL_FEATURE, 'briefs/a.md', 'content', userContext);
    await svc.getFileTree('proj', UNIVERSAL_FEATURE, userContext);
    expect(fs.existsSync(path.join(projectPath, 'features'))).toBe(false);
  });

  it('free-form top-level dirs survive — the container is NOT allowlist-filtered', async () => {
    markUniversal();
    fs.mkdirSync(path.join(projectPath, 'universal', 'artifacts', 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'universal', 'artifacts', 'briefs', 'b.md'), 'x');
    fs.writeFileSync(path.join(projectPath, 'universal', 'artifacts', 'notes.md'), 'y');
    const svc = new FileOperationService(makeResolver());
    const tree = await svc.getFileTree('proj', UNIVERSAL_FEATURE, userContext);
    // The codespace feature-root allowlist (plan/architecture/visual/assets/
    // meta/sessions) must never reach this plane — a workspace has no codebase
    // and shows everything its agents author.
    expect(tree.map((n) => n.name)).toEqual(expect.arrayContaining(['briefs', 'notes.md']));
  });

  it('canonical project: universal feature name falls through to features/ (null branch)', async () => {
    fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({ projectType: 'canonical' }));
    const featureDir = path.join(projectPath, 'features', 'universal');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, 'a.md'), 'canonical-side');
    const svc = new FileOperationService(makeResolver());
    const resource = await svc.readFile('proj', 'universal', 'a.md', userContext);
    expect(resource.content).toBe('canonical-side');
  });
});

describe('universal file tree — HTTP and SSE writers agree on shape', () => {
  const flatten = (nodes: FileNode[]): string[] =>
    nodes.flatMap((n) => [n.path, ...flatten(n.children ?? [])]).sort();

  it('FileTreeBroadcaster emits the merged view, not a container raw walk', async () => {
    markUniversal();
    fs.writeFileSync(path.join(projectPath, 'universal', 'artifacts', 'plan', 'p.md'), 'x');
    fs.mkdirSync(path.join(projectPath, 'universal', 'artifacts', 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'universal', 'artifacts', 'briefs', 'b.md'), 'y');
    fs.writeFileSync(path.join(projectPath, 'universal', 'sessions', 'chat.jsonl'), '{}\n');

    const httpTree = await new FileOperationService(makeResolver()).getFileTree(
      'proj', UNIVERSAL_FEATURE, userContext,
    );

    redisWrites.length = 0;
    const broadcaster = new FileTreeBroadcaster({
      redisUrl: 'redis://mock',
      jobId: 'j',
      projectId: 'proj',
      featureName: UNIVERSAL_FEATURE,
      jobType: 'universal',
      userContext,
      // Universal jobs pass ANT_FEATURE_PATH = {project}/universal.
      projectPath: path.join(projectPath, 'universal'),
    });
    await broadcaster.notifyFileTreeUpdate('proj', UNIVERSAL_FEATURE, userContext);
    await broadcaster.close();

    const cached = redisWrites.find((w) => w.key.includes('filetree'));
    expect(cached).toBeDefined();
    const sseTree = JSON.parse(cached!.value) as FileNode[];

    // Both writers share one Redis key. A raw container walk would emit
    // `artifacts/plan/p.md`, which then resolves to
    // `{container}/artifacts/artifacts/plan/p.md` and 404s on every click.
    expect(flatten(sseTree)).toEqual(flatten(httpTree));
    expect(flatten(sseTree)).toContain('plan/p.md');
    expect(flatten(sseTree).some((p) => p.startsWith('artifacts/'))).toBe(false);
  });

  const makeBroadcaster = () => {
    markUniversal();
    return new FileTreeBroadcaster({
      redisUrl: 'redis://mock',
      jobId: 'j',
      projectId: 'proj',
      featureName: UNIVERSAL_FEATURE,
      jobType: 'universal',
      userContext,
      projectPath: path.join(projectPath, 'universal'),
    });
  };

  it('coalesces a burst of notifies instead of walking the tree N times', async () => {
    // Every mutating tool call asks for a refresh, and each refresh is a full
    // recursive walk + Redis write + publish. A 12-file batch used to cost 12
    // walks producing near-identical payloads.
    const broadcaster = makeBroadcaster();
    redisWrites.length = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        broadcaster.notifyFileTreeUpdate('proj', UNIVERSAL_FEATURE, userContext),
      ),
    );
    await broadcaster.close();

    const walks = redisWrites.filter((w) => w.key.includes('filetree')).length;
    expect(walks).toBeGreaterThanOrEqual(1);
    expect(walks).toBeLessThanOrEqual(2);
  });

  it('collapses a SEQUENTIAL batch too — the case a tool batch actually produces', async () => {
    // Tool calls in a batch run one after another. If the orchestrator awaited
    // each notify, every walk would finish before the next started and N writes
    // would cost N walks. Fire-and-forget lets calls 2..N join call 1's walk.
    const broadcaster = makeBroadcaster();
    redisWrites.length = 0;

    for (let i = 0; i < 12; i++) {
      // `void` mirrors ToolOrchestrator.notifyIfTreeMutated exactly.
      void broadcaster.notifyFileTreeUpdate('proj', UNIVERSAL_FEATURE, userContext);
    }
    // close() flushes the in-flight walk AND its coalesced trailing run.
    await broadcaster.close();

    const walks = redisWrites.filter((w) => w.key.includes('filetree')).length;
    expect(walks).toBeGreaterThanOrEqual(1);
    expect(walks).toBeLessThanOrEqual(2);
  });

  it('still reflects a write that lands DURING a walk (coalescing, not dropping)', async () => {
    const broadcaster = makeBroadcaster();
    redisWrites.length = 0;

    // First notify starts a walk; the file appears while it is in flight, and
    // the second notify coalesces into a trailing walk that must see it.
    const first = broadcaster.notifyFileTreeUpdate('proj', UNIVERSAL_FEATURE, userContext);
    fs.writeFileSync(path.join(projectPath, 'universal', 'artifacts', 'plan', 'late.md'), 'z');
    const second = broadcaster.notifyFileTreeUpdate('proj', UNIVERSAL_FEATURE, userContext);
    await Promise.all([first, second]);
    await broadcaster.close();

    // close() flushes in-flight AND coalesced runs, so the last payload is the
    // trailing one — the end-of-job broadcast must never be dropped.
    const last = [...redisWrites].reverse().find((w) => w.key.includes('filetree'));
    expect(last).toBeDefined();
    expect(flatten(JSON.parse(last!.value) as FileNode[])).toContain('plan/late.md');
  });
});

describe('resolveFeatureScopedFilePath (files-raw / download seam)', () => {
  it('universal → container merged path; canonical → feature path with traversal guard', () => {
    markUniversal();
    const resolver = makeResolver();
    expect(resolveFeatureScopedFilePath(resolver, userContext, 'proj', UNIVERSAL_FEATURE, 'plan/img.png')).toBe(
      path.join(projectPath, 'universal', 'artifacts', 'plan', 'img.png'),
    );
    expect(resolveFeatureScopedFilePath(resolver, userContext, 'proj', 'main', 'plan/img.png')).toBe(
      path.join(projectPath, 'features', 'main', 'plan', 'img.png'),
    );
    expect(() => resolveFeatureScopedFilePath(resolver, userContext, 'proj', 'main', '../../escape')).toThrow(
      /Invalid file path/,
    );
  });
});
