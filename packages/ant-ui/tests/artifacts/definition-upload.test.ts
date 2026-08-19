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
import { findConflicts } from '../../src/shared/utils/upload-utils';
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
