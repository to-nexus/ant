/**
 * workerGroupPolicy — pure derivation helpers for parallel-worker chat
 * groups (plan curious-spinning-twilight, Part C).
 *
 * Locks: scope parsing (cycleSeq stays a distinct group — even-getting-knave),
 * tri-state status (quiet-but-unfinished stays active), unresolved-choice
 * force-expand, override stickiness, and the parallel-vs-single collapse
 * defaults.
 */

import { describe, it, expect } from 'vitest';
import type { TurnSection } from '../../src/domain/store/selectors/chat';
import {
  isWorkerGroupScope,
  parseWorkerScope,
  resolveGroupCollapsed,
  sectionHasUnresolvedChoice,
  sectionStatus,
  sectionTaskName,
  sectionTicker,
  workerHue,
} from '../../src/presentation/components/chat/workerGroupPolicy';

function statusItem(
  statusType: string,
  metadata?: Record<string, unknown>,
  extra?: Record<string, unknown>,
): TurnSection['items'][number] {
  return {
    kind: 'status',
    line: {
      type: 'chat_status',
      ts: new Date().toISOString(),
      jobId: 'j1',
      turnId: 't1',
      jobType: 'code',
      cardId: `c-${Math.random()}`,
      statusType,
      metadata,
      ...extra,
    },
  } as unknown as TurnSection['items'][number];
}

function choiceItem(resolved: boolean): TurnSection['items'][number] {
  return {
    kind: 'choice',
    presented: {
      type: 'choice_presented',
      ts: new Date().toISOString(),
      jobId: 'j1',
      turnId: 't1',
      jobType: 'code',
      cardId: 'choice-1',
      cardType: 'unknown',
    },
    ...(resolved
      ? {
          resolved: {
            type: 'choice_resolved',
            ts: new Date().toISOString(),
            jobId: 'j1',
            turnId: 't1',
            jobType: 'code',
            cardId: 'choice-1',
            choiceSelected: 'ok',
          },
        }
      : {}),
  } as unknown as TurnSection['items'][number];
}

function section(overrides: Partial<TurnSection>): TurnSection {
  return { workerScope: 'worker-1#task-a', items: [], ...overrides };
}

describe('scope parsing', () => {
  it('classifies worker scopes; _main_ and _cancelled_ are never groups', () => {
    expect(isWorkerGroupScope('worker-1')).toBe(true);
    expect(isWorkerGroupScope('worker-2#task-x')).toBe(true);
    expect(isWorkerGroupScope('_main_')).toBe(false);
    expect(isWorkerGroupScope('_cancelled_:card-9')).toBe(false);
  });

  it('parses worker id, task key, and cycle suffix (distinct-group label only)', () => {
    expect(parseWorkerScope('worker-2#task-k#p3')).toEqual({
      workerLabel: 'worker-2',
      workerId: 2,
      taskKey: 'task-k',
      cycleSeq: 3,
    });
    // Task keys may themselves contain '#'-free arbitrary ids; a lone
    // trailing pN without a task segment is treated as the task key.
    expect(parseWorkerScope('worker-1#p2')).toEqual({
      workerLabel: 'worker-1',
      workerId: 1,
      taskKey: 'p2',
    });
    expect(parseWorkerScope('_main_')).toBeNull();
  });

  it('cycles a stable hue per workerId', () => {
    expect(workerHue(0)).toBe(workerHue(4));
    expect(workerHue(1)).not.toBe(workerHue(2));
  });
});

describe('sectionStatus', () => {
  it('is active while streaming or before the terminal task_response', () => {
    expect(sectionStatus(section({ activeText: 'typing…' }))).toBe('active');
    // Quiet section (no buffer, no terminal card) stays active — no flicker.
    expect(sectionStatus(section({ items: [statusItem('read')] }))).toBe('active');
  });

  it('completes on task_response with no streaming overlay', () => {
    const s = section({ items: [statusItem('read'), statusItem('task_response')] });
    expect(sectionStatus(s)).toBe('completed');
    expect(sectionStatus({ ...s, activeText: 'more' })).toBe('active');
  });

  it('fails on *_failed statusTypes or error metadata', () => {
    expect(sectionStatus(section({ items: [statusItem('file_edit_failed')] }))).toBe('failed');
    expect(sectionStatus(section({ items: [statusItem('command', { error: 'boom' })] }))).toBe('failed');
    expect(sectionStatus(section({ items: [statusItem('command', { success: false })] }))).toBe('failed');
  });
});

describe('collapse policy', () => {
  const parallel = 3;

  it('unresolved choice forces expanded, overriding everything', () => {
    const s = section({ items: [choiceItem(false)] });
    expect(resolveGroupCollapsed(s, parallel, 'collapsed')).toBe(false);
    expect(sectionHasUnresolvedChoice(s)).toBe(true);
    expect(sectionHasUnresolvedChoice(section({ items: [choiceItem(true)] }))).toBe(false);
  });

  it('user override wins over defaults', () => {
    const s = section({});
    expect(resolveGroupCollapsed(s, parallel, 'expanded')).toBe(false);
    expect(resolveGroupCollapsed(s, 1, 'collapsed')).toBe(true);
  });

  it('defaults: parallel turns collapse, single-worker turns expand, failures expand', () => {
    expect(resolveGroupCollapsed(section({}), parallel, undefined)).toBe(true);
    expect(resolveGroupCollapsed(section({}), 1, undefined)).toBe(false);
    expect(
      resolveGroupCollapsed(section({ items: [statusItem('file_edit_failed')] }), parallel, undefined),
    ).toBe(false);
  });
});

describe('labels and ticker', () => {
  it('prefers BE-stamped line.taskName, then metadata scrape, then taskKey', () => {
    expect(
      sectionTaskName(section({ items: [statusItem('read', undefined, { taskName: 'Login page' })] })),
    ).toBe('Login page');
    expect(
      sectionTaskName(section({ items: [statusItem('task_response', { taskName: 'From meta' })] })),
    ).toBe('From meta');
    expect(sectionTaskName(section({}))).toBe('task-a');
  });

  it('ticker surfaces the latest observable activity', () => {
    expect(sectionTicker(section({ activeText: 'first\nsecond line' }))).toBe('second line');
    const withStatus = section({ items: [statusItem('read', { fileName: 'a.ts' })] });
    expect(sectionTicker(withStatus)).toBeTruthy();
    expect(sectionTicker(section({}))).toBeUndefined();
  });
});
