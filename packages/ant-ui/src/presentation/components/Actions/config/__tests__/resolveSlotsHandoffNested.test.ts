/**
 * Handoff nested-directory inclusion — FE rendering side
 *
 * `visual/ui/handoff/` is a free-form bundle that may carry arbitrary
 * nested subdirs (screens/login/spec.md, assets/logo.png, etc). The BE
 * `loadResolvedArtifacts.walkDir` already descends recursively, but the
 * FE used to flat-list only direct children — which meant:
 *   1. The dir-card count `(N)` undercounted nested files.
 *   2. `togglePaths` was built from `sg.files.map(f => f.path)`, so the
 *      user could not select nested files into the RAC — the BE never
 *      received them.
 *
 * `listDirWithMeta` is now recursive. This test locks that behavior so
 * a future refactor cannot silently drop nested files again.
 */

import { describe, it, expect } from 'vitest';
import type { SlotDef } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { resolveSlotEntries, listDir } from '../resolveSlots';

const handoffSlot: SlotDef = {
  path: 'visual/ui',
  label: { en: 'UI Design', ko: 'UI 설계' },
  type: 'ui-source',
  required: false,
  uiSources: [
    {
      id: 'handoff',
      dir: 'visual/ui/handoff',
      label: { en: 'Handoff', ko: '핸드오프' },
    },
  ],
};

const fileMeta = (size: number) => ({
  size,
  mtime: 0,
  isTemplate: false,
  templateReason: null,
});

const fileTree: FileNode[] = [
  {
    name: 'visual',
    path: 'visual',
    type: 'directory',
    children: [
      {
        name: 'ui',
        path: 'visual/ui',
        type: 'directory',
        children: [
          {
            name: 'handoff',
            path: 'visual/ui/handoff',
            type: 'directory',
            children: [
              { name: 'overview.md', path: 'visual/ui/handoff/overview.md', type: 'file', meta: fileMeta(120) },
              {
                name: 'screens',
                path: 'visual/ui/handoff/screens',
                type: 'directory',
                children: [
                  {
                    name: 'login',
                    path: 'visual/ui/handoff/screens/login',
                    type: 'directory',
                    children: [
                      { name: 'spec.md', path: 'visual/ui/handoff/screens/login/spec.md', type: 'file', meta: fileMeta(200) },
                      { name: 'mock.png', path: 'visual/ui/handoff/screens/login/mock.png', type: 'file', meta: fileMeta(50_000) },
                    ],
                  },
                ],
              },
              {
                name: 'assets',
                path: 'visual/ui/handoff/assets',
                type: 'directory',
                children: [
                  { name: 'logo.png', path: 'visual/ui/handoff/assets/logo.png', type: 'file', meta: fileMeta(8_000) },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe('resolveSlotEntries — handoff nested directories', () => {
  it('includes ALL files under visual/ui/handoff/ regardless of nesting depth', () => {
    const [entry] = resolveSlotEntries([handoffSlot], fileTree);
    const handoff = entry.subgroups?.find(s => s.id === 'handoff');
    expect(handoff).toBeDefined();
    expect(handoff!.hasFiles).toBe(true);

    const paths = handoff!.files.map(f => f.path).sort();
    expect(paths).toEqual([
      'visual/ui/handoff/assets/logo.png',
      'visual/ui/handoff/overview.md',
      'visual/ui/handoff/screens/login/mock.png',
      'visual/ui/handoff/screens/login/spec.md',
    ]);
  });

  it('handoff dir-card count reflects the recursive total (4 files, not 1)', () => {
    const [entry] = resolveSlotEntries([handoffSlot], fileTree);
    const handoff = entry.subgroups!.find(s => s.id === 'handoff')!;
    // SlotEntryList renders `${sg.files.length}` on the dir card.
    expect(handoff.files.length).toBe(4);
  });

  it('nested file paths are absolute (joined from the slot root, not basename)', () => {
    const [entry] = resolveSlotEntries([handoffSlot], fileTree);
    const handoff = entry.subgroups!.find(s => s.id === 'handoff')!;
    for (const f of handoff.files) {
      expect(f.path.startsWith('visual/ui/handoff/')).toBe(true);
      expect(f.path).not.toBe(f.name); // not a bare basename
    }
  });

  it('listDir wrapper inherits the recursive behavior', () => {
    const files = listDir(fileTree, 'visual/ui/handoff');
    expect(files.map(f => f.path).sort()).toEqual([
      'visual/ui/handoff/assets/logo.png',
      'visual/ui/handoff/overview.md',
      'visual/ui/handoff/screens/login/mock.png',
      'visual/ui/handoff/screens/login/spec.md',
    ]);
  });

  it('empty handoff directory yields zero files (no crash)', () => {
    const emptyTree: FileNode[] = [
      {
        name: 'visual',
        path: 'visual',
        type: 'directory',
        children: [
          {
            name: 'ui',
            path: 'visual/ui',
            type: 'directory',
            children: [
              { name: 'handoff', path: 'visual/ui/handoff', type: 'directory', children: [] },
            ],
          },
        ],
      },
    ];
    const [entry] = resolveSlotEntries([handoffSlot], emptyTree);
    const handoff = entry.subgroups!.find(s => s.id === 'handoff')!;
    expect(handoff.hasFiles).toBe(false);
    expect(handoff.files.length).toBe(0);
  });
});
