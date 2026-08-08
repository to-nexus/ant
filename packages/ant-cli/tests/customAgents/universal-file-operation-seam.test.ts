/**
 * FileOperationService universal seam — the chokepoint every canonical file
 * route passes through. Truth table: universal-feature requests resolve into
 * the container's merged view; canonical projects are untouched (null
 * branch); and NO code path materializes a phantom `features/universal`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import { FileOperationService } from '../../src/periphery/adapters/http/services/ProjectService/FileOperationService';
import { resolveFeatureScopedFilePath } from '../../src/periphery/adapters/http/routes/helpers/featureFiles';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';

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
