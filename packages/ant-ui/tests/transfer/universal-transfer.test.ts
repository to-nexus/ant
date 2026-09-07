/**
 * Transfer × workspace (universal) projects — FE side.
 *
 * Pure rows: `filterTransferSourceTree` shapes the Send-tab source tree per
 * project kind (canonical allowlist + domain prune vs universal reserved-root
 * exclusion), `autoSelectFeature` collapses a workspace destination to its one
 * pseudo-feature.
 *
 * Source-level rows (same convention as local-mode-ui.test.ts): the workspace
 * panel mounts the transfer affordance, and SendSubTab no longer carries its
 * own top-level allowlist — the pure module is the single owner.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import type { FileNode } from '@ant/shared';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import { autoSelectFeature, filterTransferSourceTree } from '../../src/shared/utils/transferSourceTree';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf-8');

const dir = (name: string, children: FileNode[] = []): FileNode => ({ name, path: name, type: 'directory', children });
const names = (tree: FileNode[]) => tree.map((n) => n.name);

describe('filterTransferSourceTree', () => {
  const tree: FileNode[] = [
    dir('plan'),
    dir('architecture'),
    dir('visual', [dir('ui'), dir('game-art')]),
    dir('assets', [dir('service'), dir('game')]),
    dir('meta'),
    dir('sessions'),
    dir('pipeline-runs'),
    dir('_agents'),
    dir('_pipelines'),
    dir('codebase'),
    dir('notes'),
  ];

  it('canonical: allowlist of UI-visible canonical roots, then the domain prune', () => {
    const out = filterTransferSourceTree(tree, { projectType: 'canonical', domain: 'service' });
    expect(names(out)).toEqual(['plan', 'architecture', 'visual', 'assets', 'meta']);
    // service domain drops the game subtrees
    expect(names(out.find((n) => n.name === 'visual')!.children!)).toEqual(['ui']);
    expect(names(out.find((n) => n.name === 'assets')!.children!)).toEqual(['service']);
  });

  it('canonical is the default when projectType is absent', () => {
    expect(names(filterTransferSourceTree(tree, { domain: 'game' }))).toEqual(['plan', 'architecture', 'visual', 'assets', 'meta']);
  });

  it('universal: every user root minus the reserved grafts; no allowlist, no domain prune', () => {
    const out = filterTransferSourceTree(tree, { projectType: 'universal', domain: 'service' });
    expect(names(out)).toEqual(['plan', 'architecture', 'visual', 'assets', 'meta', 'codebase', 'notes']);
    expect(names(out.find((n) => n.name === 'visual')!.children!)).toEqual(['ui', 'game-art']);
  });

  it('universal: a name that merely starts with a reserved root is kept', () => {
    expect(names(filterTransferSourceTree([dir('sessions-notes'), dir('sessions')], { projectType: 'universal' }))).toEqual(['sessions-notes']);
  });
});

describe('autoSelectFeature', () => {
  it.each([
    [[{ featureId: UNIVERSAL_FEATURE }], UNIVERSAL_FEATURE],
    [[{ featureId: 'main' }], null],
    [[{ featureId: UNIVERSAL_FEATURE }, { featureId: 'main' }], null],
    [[], null],
  ])('%j → %s', (features, expected) => {
    expect(autoSelectFeature(features)).toBe(expected);
  });
});

describe('source-level — transfer affordance on the workspace panel', () => {
  it('UniversalArtifactsPanel mounts TransferToolbar and passes onSend', () => {
    const src = read('presentation/components/UniversalArtifactsPanel.tsx');
    expect(src).toMatch(/import \{ TransferToolbar \} from '\.\/ArtifactsPanel\/TransferToolbar'/);
    expect(src).toMatch(/<TransferToolbar/);
    expect(src).toMatch(/onSend=\{handleSend\}/);
    expect(src).toMatch(/useSendToTransfer\(selectedProject, UNIVERSAL_FEATURE\)/);
  });

  it('both panels open the Send tab through the one hook', () => {
    expect(read('presentation/components/ArtifactsPanel.tsx')).toMatch(/useSendToTransfer\(selectedProject, selectedFeature\)/);
    expect(read('presentation/components/ArtifactsPanel.tsx')).not.toMatch(/preselectedSource:/);
  });

  it('SendSubTab delegates source shaping to the pure module and owns no allowlist', () => {
    const src = read('presentation/components/Transfer/SendSubTab.tsx');
    expect(src).toMatch(/filterTransferSourceTree\(/);
    expect(src).not.toMatch(/filterArtifactDirs/);
    expect(src).not.toMatch(/UI_VISIBLE_TOP_LEVEL_DIRS/);
    expect(src).not.toMatch(/pruneFileTreeForWorkspaceDomain/);
  });

  it('SendSubTab collapses a workspace destination: auto-select + hidden feature dropdown', () => {
    const src = read('presentation/components/Transfer/SendSubTab.tsx');
    expect(src).toMatch(/autoSelectFeature\(features\)/);
    expect(src).toMatch(/hideFeature=\{isWorkspaceProject\(/);
    expect(src).toMatch(/\{!hideFeature && \(/);
  });

  it("the raw 'universal' id is never shown — the label goes through send.workspace", () => {
    const src = read('presentation/components/Transfer/SendSubTab.tsx');
    expect(src).toMatch(/t\('send\.workspace'\)/);
    for (const loc of ['en', 'ko']) {
      const json = JSON.parse(read(`i18n/locales/${loc}/transfer.json`));
      expect(typeof json.send.workspace).toBe('string');
    }
  });
});
