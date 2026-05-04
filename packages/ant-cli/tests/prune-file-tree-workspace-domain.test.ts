import { describe, it, expect } from 'vitest';
import type { FileNode } from '@ant/shared';
import { pruneFileTreeForWorkspaceDomain } from '@ant/shared';

function dir(path: string, children: FileNode[]): FileNode {
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  return { path, name, type: 'directory', children };
}

describe('pruneFileTreeForWorkspaceDomain', () => {
  const tree: FileNode[] = [
    dir('visual', [
      dir('visual/ui', []),
      dir('visual/game-art', []),
    ]),
    dir('assets', [
      dir('assets/service', []),
      dir('assets/game', []),
      dir('assets/gen', []),
      dir('assets/future-bucket', []),
    ]),
    dir('plan', [dir('plan/x', [])]),
  ];

  it('service keeps visual/ui and assets/service + gen + non-pool dirs', () => {
    const out = pruneFileTreeForWorkspaceDomain(tree, 'service');
    const visual = out.find(n => n.path === 'visual')!;
    const names = visual.children!.map(c => c.name).sort();
    expect(names).toEqual(['ui']);
    const assets = out.find(n => n.path === 'assets')!;
    const assetNames = assets.children!.map(c => c.name).sort();
    expect(assetNames).toEqual(['future-bucket', 'gen', 'service']);
  });

  it('game keeps visual/game-art and assets/game + gen + non-pool dirs', () => {
    const out = pruneFileTreeForWorkspaceDomain(tree, 'game');
    const visual = out.find(n => n.path === 'visual')!;
    expect(visual.children!.map(c => c.name)).toEqual(['game-art']);
    const assets = out.find(n => n.path === 'assets')!;
    const assetNames = assets.children!.map(c => c.name).sort();
    expect(assetNames).toEqual(['future-bucket', 'game', 'gen']);
  });

  it('defaults invalid domain to service', () => {
    const out = pruneFileTreeForWorkspaceDomain(tree, undefined);
    expect(out.find(n => n.path === 'visual')!.children!.map(c => c.name)).toEqual(['ui']);
  });

  it('does not strip non-visual branches', () => {
    const out = pruneFileTreeForWorkspaceDomain(tree, 'game');
    expect(out.find(n => n.path === 'plan')).toBeDefined();
  });
});
