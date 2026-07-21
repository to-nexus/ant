/**
 * read_state handler (item 7) — live run-state reader. Returns completed-task
 * scope/manifest from `ctx.completedTasks` (ahead of any disk checkpoint).
 * Discovery (no arg) → roster; expand (task arg) → full untruncated detail.
 *
 * scope='history' — past-conversation recall over `ctx.featureHistory`
 * (feature.jsonl user/assistant originals since the last boundary, folded
 * turns included). Discovery → turn roster; query → verbatim bodies.
 */
import { describe, it, expect } from 'vitest';
import { handleReadState } from '../../src/agents/common/tool/handlers/readState';

const ctx = (completedTasks?: any[], featureHistory?: () => Promise<any[]>): any => ({
  completedTasks,
  featureHistory,
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

const turns = [
  {
    turnId: 't-1',
    ts: '2026-07-20T09:00:00.000Z',
    jobType: 'code',
    userText: '로그인은 반드시 OAuth 팝업 없이 리다이렉트로 구현해줘',
    assistantFinalText: 'Implemented redirect-based OAuth as requested.',
  },
  {
    turnId: 't-2',
    ts: '2026-07-20T10:00:00.000Z',
    jobType: 'ask',
    userText: 'what did we decide about ports?',
    assistantFinalText: 'Port 4200 is the canonical origin.',
    ephemeral: true,
  },
];

describe("read_state handler — scope='history'", () => {
  it('gracefully degrades when featureHistory is not attached', async () => {
    const out = (await handleReadState(ctx(tasks), { scope: 'history' })).content as string;
    expect(out).toMatch(/not available/);
  });

  it('empty history → friendly empty message', async () => {
    const out = (await handleReadState(ctx(tasks, async () => []), { scope: 'history' })).content as string;
    expect(out).toMatch(/No past turns/);
  });

  it('no query → roster of recent turns with previews (never full bodies)', async () => {
    const out = (await handleReadState(ctx(tasks, async () => turns), { scope: 'history' })).content as string;
    expect(out).toMatch(/2 past turn\(s\)/);
    expect(out).toMatch(/t-1 \[2026-07-20T09:00:00\.000Z · code\]/);
    expect(out).toMatch(/t-2/);
    expect(out).not.toMatch(/Implemented redirect-based OAuth/);
  });

  it('turn-id query → verbatim user + assistant bodies', async () => {
    const out = (await handleReadState(ctx(tasks, async () => turns), { scope: 'history', task: 't-1' })).content as string;
    expect(out).toMatch(/리다이렉트로 구현해줘/);
    expect(out).toMatch(/Implemented redirect-based OAuth/);
    expect(out).not.toMatch(/canonical origin/);
  });

  it('text query matches user AND assistant text', async () => {
    const out = (await handleReadState(ctx(tasks, async () => turns), { scope: 'history', task: 'canonical origin' })).content as string;
    expect(out).toMatch(/t-2/);
    expect(out).toMatch(/Port 4200/);
  });

  it('no match → guidance to list', async () => {
    const out = (await handleReadState(ctx(tasks, async () => turns), { scope: 'history', task: 'zzz' })).content as string;
    expect(out).toMatch(/No past turn matches/);
  });

  it("scope='history' never touches completedTasks (run scope untouched)", async () => {
    const out = (await handleReadState(ctx(undefined, async () => turns), { scope: 'history' })).content as string;
    expect(out).toMatch(/2 past turn\(s\)/);
  });
});
