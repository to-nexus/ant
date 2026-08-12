/**
 * `shared/utils/selectionDisplay` — the one owner of how a selected artifact
 * path is rendered and edited.
 *
 * Locks that every surface reading `actionMetadata.refs` / `.context` collapses
 * directory-level selections from the in-memory `fileTree` with the SAME shared
 * algorithm the BE uses for the durable record, so the chat input box, the user
 * bubble, and the action-tab config panel all agree. These helpers used to live
 * under `presentation/components/chat/`, which is why the panel grew its own
 * catalog-driven renderer instead of reusing them.
 *
 * Runner: vitest.
 */

import { describe, it, expect } from 'vitest';
import { compressPathsByFolderCore, type FileNode } from '@ant/shared';
import {
  collectRepresentablePaths,
  compressSelection,
  makeTreeListDir,
  preserveHiddenSelections,
  removeSelectedEntry,
  entryFromPath,
} from '@/shared/utils/selectionDisplay';

const dir = (name: string, path: string, children: FileNode[]): FileNode => ({
  name,
  path,
  type: 'directory',
  children,
});
const file = (name: string, path: string): FileNode => ({ name, path, type: 'file' });

// visual/ui/
//   handoff/{index.html, screens/{login.md,home.md}, assets/logo.png}
//   ant/ui-tokens.json   ← sibling so `visual/ui` & `visual` are NOT fully
//                           covered by a handoff-only selection
const tree: FileNode[] = [
  dir('visual', 'visual', [
    dir('ui', 'visual/ui', [
      dir('handoff', 'visual/ui/handoff', [
        file('index.html', 'visual/ui/handoff/index.html'),
        dir('screens', 'visual/ui/handoff/screens', [
          file('login.md', 'visual/ui/handoff/screens/login.md'),
          file('home.md', 'visual/ui/handoff/screens/home.md'),
        ]),
        dir('assets', 'visual/ui/handoff/assets', [
          file('logo.png', 'visual/ui/handoff/assets/logo.png'),
        ]),
      ]),
      dir('ant', 'visual/ui/ant', [
        file('ui-tokens.json', 'visual/ui/ant/ui-tokens.json'),
      ]),
    ]),
  ]),
];

describe('FE folder-collapse preview (tree-backed listDir)', () => {
  it('collapses a nested full-subtree selection to the topmost directory', () => {
    const out = compressPathsByFolderCore(
      [
        'visual/ui/handoff/index.html',
        'visual/ui/handoff/screens/login.md',
        'visual/ui/handoff/screens/home.md',
        'visual/ui/handoff/assets/logo.png',
      ],
      makeTreeListDir(tree),
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'visual/ui/handoff', fileCount: 4 },
    ]);
  });

  it('keeps a partial selection as individual files', () => {
    const out = compressPathsByFolderCore(
      [
        'visual/ui/handoff/index.html',
        'visual/ui/handoff/screens/login.md',
      ],
      makeTreeListDir(tree),
    );
    expect(out).toEqual([
      { kind: 'file', path: 'visual/ui/handoff/index.html' },
      { kind: 'file', path: 'visual/ui/handoff/screens/login.md' },
    ]);
  });

  it('collapses only the fully-covered inner dir of a partial subtree', () => {
    const out = compressPathsByFolderCore(
      [
        'visual/ui/handoff/screens/login.md',
        'visual/ui/handoff/screens/home.md',
      ],
      makeTreeListDir(tree),
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'visual/ui/handoff/screens', fileCount: 2 },
    ]);
  });

  it('returns null listDir for a non-directory / missing path (no collapse)', () => {
    const listDir = makeTreeListDir(tree);
    expect(listDir('visual/ui/handoff/index.html')).toBeNull();
    expect(listDir('nope')).toBeNull();
  });

  // BE `resolveToRAC` widens a refactor-mode handoff target to the bundle root,
  // so the badge row receives one bare directory path. Rendering it as a plain
  // "file" showed `handoff` with a file icon and no count.
  it('emits one folder entry for a bare directory path', () => {
    const out = compressPathsByFolderCore(
      ['visual/ui/handoff'],
      makeTreeListDir(tree),
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'visual/ui/handoff', fileCount: 4 },
    ]);
  });

  it('a directory path mixed with an unrelated file keeps both shapes', () => {
    const out = compressPathsByFolderCore(
      ['visual/ui/handoff', 'visual/ui/ant/ui-tokens.json'],
      makeTreeListDir(tree),
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'visual/ui/handoff', fileCount: 4 },
      { kind: 'file', path: 'visual/ui/ant/ui-tokens.json' },
    ]);
  });
});

describe('compressSelection — render-ready entries', () => {
  it('collapses a full subtree to one folder entry carrying the count', () => {
    const out = compressSelection(
      [
        'visual/ui/handoff/index.html',
        'visual/ui/handoff/screens/login.md',
        'visual/ui/handoff/screens/home.md',
        'visual/ui/handoff/assets/logo.png',
      ],
      tree,
    );
    expect(out).toEqual([
      { isFolder: true, display: 'handoff/', fileCount: 4, rawPath: 'visual/ui/handoff' },
    ]);
  });

  it('passes paths through untouched when there is no tree to collapse against', () => {
    expect(compressSelection(['a/b.md'], [])).toEqual([
      { isFolder: false, display: 'b.md', rawPath: 'a/b.md' },
    ]);
  });

  it('is empty for an empty selection', () => {
    expect(compressSelection([], tree)).toEqual([]);
  });
});

describe('removeSelectedEntry — a folder entry stands for its subtree', () => {
  const selection = [
    'visual/ui/handoff/index.html',
    'visual/ui/handoff/screens/login.md',
    'visual/ui/ant/ui-tokens.json',
  ];

  it('drops the whole subtree for a folder entry', () => {
    const [folder] = compressSelection(
      [
        'visual/ui/handoff/index.html',
        'visual/ui/handoff/screens/login.md',
        'visual/ui/handoff/screens/home.md',
        'visual/ui/handoff/assets/logo.png',
      ],
      tree,
    );
    expect(removeSelectedEntry(selection, folder)).toEqual(['visual/ui/ant/ui-tokens.json']);
  });

  it('drops exactly one path for a file entry', () => {
    expect(removeSelectedEntry(selection, entryFromPath('visual/ui/handoff/index.html'))).toEqual([
      'visual/ui/handoff/screens/login.md',
      'visual/ui/ant/ui-tokens.json',
    ]);
  });

  it('collapses to undefined when nothing is left (ready for updateActionMetadata)', () => {
    expect(removeSelectedEntry(['only.md'], entryFromPath('only.md'))).toBeUndefined();
    expect(removeSelectedEntry(undefined, entryFromPath('x.md'))).toBeUndefined();
  });

  it('a directory path is not treated as a prefix unless the entry IS a folder', () => {
    // `handoff` as a plain file entry must not eat `handoff/index.html`.
    expect(
      removeSelectedEntry(['visual/ui/handoff', 'visual/ui/handoff/index.html'],
        entryFromPath('visual/ui/handoff')),
    ).toEqual(['visual/ui/handoff/index.html']);
  });
});

/**
 * A picker commits its whole selection, replacing the field. The rendered tree
 * is domain-pruned and `excludePatterns`-filtered, so without this a path the
 * tree cannot show was deleted merely by opening the picker and confirming —
 * the same "a surface that cannot display something must not delete it" rule
 * the config panel's `added` group enforces.
 */
describe('preserveHiddenSelections — confirm must not delete the invisible', () => {
  const representable = collectRepresentablePaths(tree);

  it('collects directories as well as files', () => {
    expect(representable.has('visual/ui/handoff')).toBe(true);
    expect(representable.has('visual/ui/handoff/index.html')).toBe(true);
  });

  it('carries through a previously-selected path the tree cannot represent', () => {
    const out = preserveHiddenSelections(
      ['visual/ui/ant/ui-tokens.json'],
      ['visual/ui/ant/ui-tokens.json', 'assets/game/hero.png'],
      representable,
    );
    expect(out).toEqual(['visual/ui/ant/ui-tokens.json', 'assets/game/hero.png']);
  });

  it('honours a deliberate deselection of a path the tree CAN represent', () => {
    const out = preserveHiddenSelections(
      [],
      ['visual/ui/handoff/index.html'],
      representable,
    );
    expect(out).toEqual([]);
  });

  it('never duplicates a path present in both lists', () => {
    const out = preserveHiddenSelections(
      ['assets/game/hero.png'],
      ['assets/game/hero.png'],
      representable,
    );
    expect(out).toEqual(['assets/game/hero.png']);
  });
});
