import { describe, it, expect } from 'vitest';
import { buildBreadcrumb, collectTouchedFilesFromChatLog } from '../../../src/core/context/breadcrumb';
import { BREADCRUMB_LIMITS } from '@ant/shared';
import type { ChatLine } from '@ant/shared';

function baseInput(overrides: Partial<Parameters<typeof buildBreadcrumb>[0]> = {}) {
  return {
    jobId: 'job-1',
    turnId: 't-abc',
    jobType: 'code' as const,
    summary: 'auth module scaffold',
    touched: [] as string[],
    ts: '2026-04-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildBreadcrumb — bubble-up tiers', () => {
  it('SMALL tier (≤10): keeps concrete files up to 10', () => {
    const touched = Array.from({ length: 7 }, (_, i) => `src/a/${i}.ts`);
    const bc = buildBreadcrumb(baseInput({ touched }));
    expect(bc.anchors.files).toEqual(touched);
    expect(bc.anchors.paths).toBeUndefined();
    expect(bc.anchors.specs).toBeUndefined();
    expect(bc.stats.touched).toBe(7);
    expect(bc.scope).toBe('modification');
  });

  it('SMALL tier respects files cap', () => {
    const touched = Array.from({ length: 15 }, (_, i) => `a/${i}.ts`);
    // 15 > SMALL(10) so this is MEDIUM — not files tier
    const bc = buildBreadcrumb(baseInput({ touched }));
    expect(bc.anchors.files).toBeUndefined();
    expect(bc.anchors.paths).toBeDefined();
    expect(bc.anchors.paths!.length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.paths);
  });

  it('MEDIUM tier (11–50): collapses to top-level path patterns', () => {
    const touched = [
      ...Array.from({ length: 8 }, (_, i) => `src/auth/a${i}.ts`),
      ...Array.from({ length: 8 }, (_, i) => `src/api/b${i}.ts`),
    ];
    const bc = buildBreadcrumb(baseInput({ touched }));
    expect(bc.anchors.paths).toBeDefined();
    expect(bc.anchors.paths).toEqual(['src/auth/**', 'src/api/**']);
    expect(bc.anchors.files).toBeUndefined();
    expect(bc.stats.touched).toBe(16);
  });

  it('LARGE tier (51–200): specs + top-level paths, capped', () => {
    const paths = Array.from({ length: 60 }, (_, i) => `src/module${i % 10}/${i}.ts`);
    const specs = ['docs/spec-a.md', 'docs/spec-b.md', 'outputs/design/design.md'];
    const touched = [...specs, ...paths];
    const bc = buildBreadcrumb(baseInput({ touched }));
    expect(bc.anchors.specs).toBeDefined();
    expect(bc.anchors.specs!.length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.specs);
    expect(bc.anchors.paths).toBeDefined();
    expect(bc.anchors.paths!.length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.paths);
    expect(bc.stats.touched).toBeGreaterThan(50);
    expect(bc.scope).toBe('modification');
  });

  it('XL tier (>200): scope flips to initial_creation', () => {
    const touched = Array.from({ length: 250 }, (_, i) => `src/mod${i % 5}/${i}.ts`);
    const bc = buildBreadcrumb(baseInput({ touched }));
    expect(bc.scope).toBe('initial_creation');
    expect(bc.anchors.paths).toBeDefined();
    expect(bc.anchors.paths!.length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.paths);
    expect(bc.anchors.files).toBeUndefined();
  });
});

describe('buildBreadcrumb — scope derivation', () => {
  it('refactor mode wins regardless of touched count', () => {
    const bc = buildBreadcrumb(baseInput({ mode: 'refactor', touched: ['a.ts'] }));
    expect(bc.scope).toBe('refactor');
  });

  it('generate / modify defaults to modification at small scale', () => {
    const bc = buildBreadcrumb(baseInput({ mode: 'generate', touched: ['a.ts'] }));
    expect(bc.scope).toBe('modification');
  });

  it('initial_creation only triggers above LARGE threshold', () => {
    const just200 = Array.from({ length: 200 }, (_, i) => `m/${i}.ts`);
    const just201 = Array.from({ length: 201 }, (_, i) => `m/${i}.ts`);
    expect(buildBreadcrumb(baseInput({ touched: just200 })).scope).toBe('modification');
    expect(buildBreadcrumb(baseInput({ touched: just201 })).scope).toBe('initial_creation');
  });
});

describe('buildBreadcrumb — limits', () => {
  it('never emits more than BREADCRUMB_LIMITS counts', () => {
    const touched = [
      ...Array.from({ length: 40 }, (_, i) => `docs/spec-${i}.md`),
      ...Array.from({ length: 40 }, (_, i) => `src/d${i % 10}/f${i}.ts`),
    ];
    const bc = buildBreadcrumb(baseInput({ touched }));
    expect((bc.anchors.specs ?? []).length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.specs);
    expect((bc.anchors.paths ?? []).length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.paths);
    expect((bc.anchors.files ?? []).length).toBeLessThanOrEqual(BREADCRUMB_LIMITS.files);
  });
});

describe('buildBreadcrumb — stats', () => {
  it('records operation counts when supplied', () => {
    const bc = buildBreadcrumb(
      baseInput({
        touched: ['a.ts', 'b.ts', 'c.ts'],
        created: ['a.ts'],
        modified: ['b.ts'],
        deleted: ['c.ts'],
      }),
    );
    expect(bc.stats.touched).toBe(3);
    expect(bc.stats.created).toBe(1);
    expect(bc.stats.modified).toBe(1);
    expect(bc.stats.deleted).toBe(1);
  });

  it('omits operation counts when not provided', () => {
    const bc = buildBreadcrumb(baseInput({ touched: ['a.ts'] }));
    expect(bc.stats.touched).toBe(1);
    expect(bc.stats.created).toBeUndefined();
    expect(bc.stats.modified).toBeUndefined();
    expect(bc.stats.deleted).toBeUndefined();
  });
});

describe('collectTouchedFilesFromChatLog', () => {
  function makeSession(lines: ChatLine[]): any {
    return {
      loadChatByTurnIds: async (turnIds: string[]) =>
        lines.filter((l) => turnIds.includes(l.turnId)),
    };
  }

  it('returns empty set when no session provided', async () => {
    const res = await collectTouchedFilesFromChatLog(undefined, 't-x');
    expect(res.all.size).toBe(0);
    expect(res.created).toEqual([]);
  });

  it('returns empty set when no turnId provided', async () => {
    const session = makeSession([]);
    const res = await collectTouchedFilesFromChatLog(session, undefined);
    expect(res.all.size).toBe(0);
  });

  it('collects file-op chat_status events filtered by turnId + groups by statusType', async () => {
    const ts0 = '2026-04-19T00:00:00.000Z';
    const ts1 = '2026-04-19T00:00:01.000Z';
    const ts2 = '2026-04-19T00:00:02.000Z';
    const session = makeSession([
      { type: 'chat_status', ts: ts0, jobId: 'j', turnId: 't-1', jobType: 'code', statusType: 'file_create', metadata: { filePath: 'a.ts' } },
      { type: 'chat_status', ts: ts1, jobId: 'j', turnId: 't-1', jobType: 'code', statusType: 'file_edit', metadata: { filePath: 'b.ts' } },
      { type: 'chat_status', ts: ts2, jobId: 'j', turnId: 't-1', jobType: 'code', statusType: 'file_delete', metadata: { filePath: 'c.ts' } },
      { type: 'assistant_message', ts: ts0, jobId: 'j', turnId: 't-1', jobType: 'code', text: 'ignore me' },
      { type: 'chat_status', ts: ts0, jobId: 'j', turnId: 't-other', jobType: 'code', statusType: 'file_create', metadata: { filePath: 'x.ts' } },
    ]);
    const res = await collectTouchedFilesFromChatLog(session, 't-1');
    expect(Array.from(res.all).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(res.created).toEqual(['a.ts']);
    expect(res.modified).toEqual(['b.ts']);
    expect(res.deleted).toEqual(['c.ts']);
    expect(res.range).toEqual({ startTs: ts0, endTs: ts2 });
  });

  it('counts _failed file-op statusTypes as attempted writes on the same operation', async () => {
    const ts0 = '2026-04-19T00:00:00.000Z';
    const session = makeSession([
      { type: 'chat_status', ts: ts0, jobId: 'j', turnId: 't-1', jobType: 'code', statusType: 'file_edit_failed', metadata: { filePath: 'bad.ts', reason: 'boom' } },
    ]);
    const res = await collectTouchedFilesFromChatLog(session, 't-1');
    expect(Array.from(res.all)).toEqual(['bad.ts']);
    expect(res.modified).toEqual(['bad.ts']);
    expect(res.created).toEqual([]);
    expect(res.deleted).toEqual([]);
  });

  it('returns empty without range when chat log has no file-op chat_status events', async () => {
    const session = makeSession([
      { type: 'assistant_message', ts: 't', jobId: 'j', turnId: 't-1', jobType: 'code', text: '' },
    ]);
    const res = await collectTouchedFilesFromChatLog(session, 't-1');
    expect(res.all.size).toBe(0);
    expect(res.range).toBeUndefined();
  });
});
