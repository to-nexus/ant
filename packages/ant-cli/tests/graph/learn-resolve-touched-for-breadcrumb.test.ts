import { describe, expect, it } from 'vitest';
import type { TouchedFromChatLog } from '../../src/core/context/breadcrumb';
import { resolveTouchedForLearn } from '../../src/agents/architect/graph/code/nodes/learn/resolveTouchedForLearn';

function touched(paths: string[]): TouchedFromChatLog {
  return {
    all: new Set(paths),
    created: [],
    modified: paths,
    deleted: [],
  };
}

describe('resolveTouchedForLearn', () => {
  it('uses task-state touched files when chat snapshot is empty (async flush race)', () => {
    const out = resolveTouchedForLearn({
      chatTouched: touched([]),
      currentTask: undefined,
      completedTasksDetails: [
        { touchedFiles: ['codebase/apps/hub/app/page.tsx'] },
        { touchedFiles: ['codebase/apps/hub/.env', 'codebase/apps/hub/app/page.tsx'] },
      ],
    });

    expect(out).toBeDefined();
    expect(Array.from(out!.all)).toEqual([
      'codebase/apps/hub/app/page.tsx',
      'codebase/apps/hub/.env',
    ]);
    expect(out!.modified).toEqual([
      'codebase/apps/hub/app/page.tsx',
      'codebase/apps/hub/.env',
    ]);
  });

  it('returns chat snapshot unchanged when task-state is empty', () => {
    const out = resolveTouchedForLearn({
      chatTouched: {
        all: new Set(['a.ts']),
        created: ['a.ts'],
        modified: [],
        deleted: [],
        range: { startTs: '1', endTs: '2' },
      },
      currentTask: undefined,
      completedTasksDetails: [],
    });

    expect(Array.from(out!.all)).toEqual(['a.ts']);
    expect(out!.created).toEqual(['a.ts']);
    expect(out!.modified).toEqual([]);
    expect(out!.range).toEqual({ startTs: '1', endTs: '2' });
  });

  it('merges task-state-only files into modified when chat snapshot is partial', () => {
    const out = resolveTouchedForLearn({
      chatTouched: {
        all: new Set(['a.ts']),
        created: ['a.ts'],
        modified: [],
        deleted: [],
      },
      currentTask: { touchedFiles: ['b.ts'] },
      completedTasksDetails: [],
    });

    expect(Array.from(out!.all)).toEqual(['b.ts', 'a.ts']);
    expect(out!.created).toEqual(['a.ts']);
    expect(out!.modified).toEqual(['b.ts']);
    expect(out!.deleted).toEqual([]);
  });

  it('returns undefined when both sources are empty', () => {
    const out = resolveTouchedForLearn({
      chatTouched: undefined,
      currentTask: undefined,
      completedTasksDetails: [],
    });
    expect(out).toBeUndefined();
  });
});

