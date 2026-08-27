/**
 * Directory-unit upload mapping for agent definitions + the writable-root
 * conflict lookup both the definition tree and the universal artifacts root
 * depend on ('' addresses the tree itself, which has no node).
 */

import { describe, it, expect } from 'vitest';
import {
  entriesUnder,
  findDefinitionNode,
  hasEntry,
  pickedFolderName,
} from '../../src/presentation/components/AgentSettings/definitionUpload';
import {
  applyPerFileResolutions,
  fileListToEntries,
  findConflicts,
} from '../../src/shared/utils/upload-utils';
import type { FileNode } from '@ant/shared';

function fileList(paths: string[]): FileList {
  const files = paths.map((p) => {
    const file = new File(['x'], p.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: p });
    return file;
  });
  return { length: files.length, item: (i: number) => files[i] ?? null, ...files } as unknown as FileList;
}

describe('definition folder upload mapping', () => {
  it('the picked folder name is the id, and its segment is stripped', () => {
    const files = fileList(['research/job.yaml', 'research/base/system.md', 'research/intents/a/infer.md']);
    expect(pickedFolderName(files)).toBe('research');
    expect(entriesUnder(files, 'jobs/research').map((e) => e.relativePath)).toEqual([
      'jobs/research/job.yaml',
      'jobs/research/base/system.md',
      'jobs/research/intents/a/infer.md',
    ]);
  });

  it('re-roots under any destination (intent folder into a job)', () => {
    const files = fileList(['triage/infer.md', 'triage/prompt.md']);
    const entries = entriesUnder(files, 'jobs/weekly/intents/triage');
    expect(hasEntry(entries, 'jobs/weekly/intents/triage/infer.md')).toBe(true);
    expect(hasEntry(entries, 'jobs/weekly/intents/triage/job.yaml')).toBe(false);
  });

  it('two top-level folders → no id (the caller must refuse)', () => {
    expect(pickedFolderName(fileList(['a/agent.yaml', 'b/agent.yaml']))).toBeNull();
  });

  it('finds a directory node by path', () => {
    const tree = [
      { name: 'jobs', path: 'jobs', type: 'directory' as const, children: [
        { name: 'weekly', path: 'jobs/weekly', type: 'directory' as const, children: [] },
      ] },
    ];
    expect(findDefinitionNode(tree, 'jobs/weekly')?.name).toBe('weekly');
    expect(findDefinitionNode(tree, 'jobs/other')).toBeUndefined();
  });
});

describe('findConflicts at the tree root', () => {
  const tree: FileNode[] = [
    { name: 'agent.yaml', path: 'agent.yaml', type: 'file' },
    { name: 'base', path: 'base', type: 'directory', children: [] },
  ];

  it("'' addresses the root itself", () => {
    expect(findConflicts(tree, '', [{ file: new File([''], 'agent.yaml'), relativePath: 'agent.yaml' }])).toEqual([
      'agent.yaml',
    ]);
    expect(findConflicts(tree, '', [{ file: new File([''], 'job.yaml'), relativePath: 'job.yaml' }])).toEqual([]);
  });
});

describe('folder picks keep their structure', () => {
  it('webkitRelativePath is the relative path; a bare file falls back to its name', () => {
    expect(fileListToEntries(fileList(['docs/api/spec.md'])).map((e) => e.relativePath)).toEqual([
      'docs/api/spec.md',
    ]);
    const bare = new File(['x'], 'notes.md');
    const list = { length: 1, item: () => bare, 0: bare } as unknown as FileList;
    expect(fileListToEntries(list)[0].relativePath).toBe('notes.md');
  });
});

describe('conflict identity is the relative path, not the file name', () => {
  const tree: FileNode[] = [
    {
      name: 'plan',
      path: 'plan',
      type: 'directory',
      children: [
        { name: 'a.md', path: 'plan/a.md', type: 'file' },
        {
          name: 'docs',
          path: 'plan/docs',
          type: 'directory',
          children: [{ name: 'a.md', path: 'plan/docs/a.md', type: 'file' }],
        },
      ],
    },
  ];
  const entry = (relativePath: string) => ({ file: new File([''], 'a.md'), relativePath });

  it('the same name under a different sub-folder is not a conflict', () => {
    expect(findConflicts(tree, 'plan', [entry('other/a.md')])).toEqual([]);
  });

  it('a nested path that does exist IS a conflict, reported as the full relative path', () => {
    expect(findConflicts(tree, 'plan', [entry('docs/a.md')])).toEqual(['docs/a.md']);
  });

  it('two same-named files in different sub-folders resolve independently', () => {
    const resolved = applyPerFileResolutions(
      [entry('docs/a.md'), entry('other/a.md')],
      { 'docs/a.md': 'copy', 'other/a.md': 'overwrite' },
      ['a.md', 'docs', 'docs/a.md'],
    );
    expect(resolved.map((e) => e.relativePath)).toEqual(['docs/a (1).md', 'other/a.md']);
  });
});
