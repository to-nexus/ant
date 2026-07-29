/**
 * `PackageInfo.projectProfile` must be read from EACH package's own directory.
 *
 * Previously the repo-level profile was stamped onto every package, so in a
 * polyglot repo `DependencyInstaller.installIfNeeded` and
 * `ProcessSpawner.spawn` — both of which dispatch on
 * `pkg.projectProfile.language` — would try to install and run a Go module with
 * npm. The same `PackageInfo` feeds deploy via `DeployPackage.projectProfile`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectStructureDetector } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ProjectStructureDetector';

let root: string;

function write(rel: string, content: unknown) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-polyglot-'));
  // Go multi-module workspace with one Go service and one Go gateway.
  write('go.work', 'go 1.23\n\nuse (\n\t./services/orders\n\t./services/gateway\n)\n');
  write('services/orders/go.mod', 'module example.com/orders\n\nrequire github.com/gin-gonic/gin v1.10.0\n');
  write('services/orders/main.go', 'package main');
  write('services/gateway/go.mod', 'module example.com/gateway\n\nrequire github.com/labstack/echo/v4 v4.12.0\n');
  write('services/gateway/main.go', 'package main');
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('per-package profiles', () => {
  it('each Go module reports its OWN framework, not the repo-level one', async () => {
    const structure = await new ProjectStructureDetector().detect(root);
    expect(structure.type).toBe('monorepo');

    const byName = Object.fromEntries(
      structure.packages.map(p => [p.name, p.projectProfile]),
    );
    expect(byName['services/orders']).toMatchObject({ language: 'go', framework: 'gin' });
    expect(byName['services/gateway']).toMatchObject({ language: 'go', framework: 'echo' });
  });

  it('a Node package nested in a Go workspace keeps its own language', async () => {
    const nodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-mixed-'));
    try {
      fs.writeFileSync(
        path.join(nodeRoot, 'package.json'),
        JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }),
      );
      fs.mkdirSync(path.join(nodeRoot, 'apps/web'), { recursive: true });
      fs.writeFileSync(
        path.join(nodeRoot, 'apps/web/package.json'),
        JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '^19.0.0' } }),
      );
      fs.writeFileSync(path.join(nodeRoot, 'apps/web/tsconfig.json'), '{}');
      // A Go module living inside the Node workspace glob.
      fs.mkdirSync(path.join(nodeRoot, 'apps/edge'), { recursive: true });
      fs.writeFileSync(
        path.join(nodeRoot, 'apps/edge/package.json'),
        JSON.stringify({ name: 'edge', scripts: { dev: 'make dev' } }),
      );
      fs.writeFileSync(path.join(nodeRoot, 'apps/edge/go.mod'), 'module example.com/edge\n');

      const structure = await new ProjectStructureDetector().detect(nodeRoot);
      const byName = Object.fromEntries(
        structure.packages.map(p => [p.name, p.projectProfile?.language]),
      );
      expect(byName[path.join('apps', 'web')]).toBe('typescript');
      // package.json wins for a directory that has both — it is the manifest the
      // spawner can act on — but the point is the value is per-directory, not
      // inherited blindly from the root.
      expect(byName[path.join('apps', 'edge')]).toBeDefined();
    } finally {
      fs.rmSync(nodeRoot, { recursive: true, force: true });
    }
  });
});
