/**
 * makeTreeListDir + compressPathsByFolderCore — FE preview path.
 *
 * Locks that the chat-input preview collapses directory-level selections from
 * the in-memory `fileTree` with the SAME shared algorithm the BE uses for the
 * durable record (so the input box and the user bubble agree).
 *
 * Runner: vitest.
 */

import { describe, it, expect } from 'vitest';
import { compressPathsByFolderCore, type FileNode } from '@ant/shared';
import { makeTreeListDir } from '@/presentation/components/chat/foldersCompressedTree';

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
});
