/**
 * read_state handler (item 7) — live run-state reader. Returns completed-task
 * scope/manifest from `ctx.completedTasks` (ahead of any disk checkpoint).
 * Discovery (no arg) → roster; expand (task arg) → full untruncated detail.
 */
import { describe, it, expect } from 'vitest';
import { handleReadState } from '../../src/agents/common/tool/handlers/readState';

const ctx = (completedTasks?: any[]): any => ({
  completedTasks,
  chatStatus: { showStatus: async () => undefined, removeStatus: async () => {} },
});

const tasks = [
  {
    id: 'app-home',
    name: '앱 — 홈',
    type: 'feature',
    band: 'platform',
    description: 'full home scope (PRD §4.2)',
    files: ['codebase/a.tsx'],
  },
  { id: 'app-feed', name: '앱 — 피드', type: 'feature', description: 'feed scope', files: [] },
];

describe('read_state handler', () => {
  it('no completed tasks → friendly empty message (handles undefined too)', async () => {
    expect((await handleReadState(ctx([]), {})).content).toMatch(/No tasks have completed/);
    expect((await handleReadState(ctx(undefined), {})).content).toMatch(/No tasks have completed/);
  });

  it('no task arg → compact roster of all completed tasks (discovery)', async () => {
    const out = (await handleReadState(ctx(tasks), {})).content as string;
    expect(out).toMatch(/2 task\(s\) completed/);
    expect(out).toMatch(/앱 — 홈 \[feature · platform\] \(1 file\)/);
    expect(out).toMatch(/앱 — 피드 \[feature\] \(0 files\)/);
  });

  it('task arg → FULL (untruncated) description + file manifest of matches', async () => {
    const out = (await handleReadState(ctx(tasks), { task: 'app-home' })).content as string;
    expect(out).toMatch(/full home scope \(PRD §4\.2\)/);
    expect(out).toMatch(/codebase\/a\.tsx/);
  });

  it('matches by name substring too', async () => {
    const out = (await handleReadState(ctx(tasks), { task: '피드' })).content as string;
    expect(out).toMatch(/feed scope/);
  });

  it('no match → guidance to list', async () => {
    const out = (await handleReadState(ctx(tasks), { task: 'nope' })).content as string;
    expect(out).toMatch(/No completed task matches/);
  });
});
