import { describe, it, expect, vi } from 'vitest';
import {
  appendOrUpdatePool,
  selectArtifacts,
  ArtifactPoolView,
} from '../../src/core/artifact/ArtifactPipeline';
import type { ResolvedArtifact } from '@ant/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function artifact(path: string, role: 'ref' | 'context' = 'context', content = 'test'): ResolvedArtifact {
  return { path, role, content };
}

// ---------------------------------------------------------------------------
// selectArtifacts — single `include` SSOT (no taskType defaults)
// ---------------------------------------------------------------------------

describe('selectArtifacts (include SSOT)', () => {
  const pool: ResolvedArtifact[] = [
    artifact('plan', 'context', 'prd content'),
    artifact('architecture/system/fe-system-main.md', 'ref', 'fe design'),
    artifact('architecture/system/api-contract-auth.md', 'ref', 'api contract'),
    artifact('visual/ui/ant/tokens', 'context', 'ui tokens'),
    artifact('visual/ui/ant/spec/header', 'context', 'header spec'),
  ];

  it('include prefix 매칭만 선택하고 role은 pool에서 상속', () => {
    const result = selectArtifacts(pool, { include: ['architecture/system/fe-system-'] });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('architecture/system/fe-system-main.md');
    expect(result[0].role).toBe('ref'); // inherited from pool, not reassigned
  });

  it('glob-style trailing * 패턴 지원', () => {
    const result = selectArtifacts(pool, { include: ['architecture/system/api-contract-*'] });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('architecture/system/api-contract-auth.md');
  });

  it('여러 include 경로 동시 매칭', () => {
    const result = selectArtifacts(pool, { include: ['visual/ui/ant/', 'plan'] });
    expect(result.map(a => a.path).sort()).toEqual([
      'plan',
      'visual/ui/ant/spec/header',
      'visual/ui/ant/tokens',
    ]);
  });

  it('빈/누락 include → [] (taskType default 없음)', () => {
    expect(selectArtifacts(pool, {})).toEqual([]);
    expect(selectArtifacts(pool, { include: [] })).toEqual([]);
    // taskType present but no include → still [] (no legacy default)
    expect(selectArtifacts(pool, { taskType: 'ui' })).toEqual([]);
    expect(selectArtifacts(pool, { taskType: 'feature' })).toEqual([]);
    expect(selectArtifacts(pool, { taskType: 'error' })).toEqual([]);
  });

  it('verification → [] regardless of include (defensive guard)', () => {
    expect(selectArtifacts(pool, { taskType: 'verification', include: ['plan'] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendOrUpdatePool role conflict warning
// ---------------------------------------------------------------------------

describe('appendOrUpdatePool role conflict', () => {
  it('같은 path에 다른 role이면 console.warn 출력', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = [artifact('plan', 'context')];
    const newArts = [artifact('plan', 'ref')];

    const result = appendOrUpdatePool(pool, newArts);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Role conflict');
    expect(warnSpy.mock.calls[0][0]).toContain('plan');
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('ref');

    warnSpy.mockRestore();
  });

  it('같은 path에 같은 role이면 경고 없음', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = [artifact('plan', 'context')];
    const newArts = [artifact('plan', 'context', 'updated content')];

    appendOrUpdatePool(pool, newArts);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('새로운 path는 추가만 됨', () => {
    const pool = [artifact('a', 'ref')];
    const result = appendOrUpdatePool(pool, [artifact('b', 'context')]);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ArtifactPoolView.hasUi / ui — three UiSource subdirectories
// ---------------------------------------------------------------------------

describe('ArtifactPoolView UI detection', () => {
  it('인정: visual/ui/ant/ 경로 (ant canonical)', () => {
    const pool = [
      artifact('visual/ui/ant/ui-tokens.json'),
      artifact('visual/ui/ant/ui-spec.json'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(true);
    expect(view.ui).toHaveLength(2);
    expect(view.uiSource()).toBe('ant');
  });

  it('인정: visual/ui/figma/figma.json', () => {
    const pool = [artifact('visual/ui/figma/figma.json')];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(true);
    expect(view.uiSource()).toBe('figma');
  });

  it('인정: visual/ui/handoff/** (임의 파일)', () => {
    const pool = [
      artifact('visual/ui/handoff/page.html'),
      artifact('visual/ui/handoff/styles.css'),
      artifact('visual/ui/handoff/notes.md'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(true);
    expect(view.ui).toHaveLength(3);
    expect(view.uiSource()).toBe('handoff');
  });

  it('거부: architecture/system 같은 비-ui 경로', () => {
    const pool = [
      artifact('architecture/system/fe-system-main.md'),
      artifact('architecture/system/ui-foo.md'), // ui- 가 basename이지만 system/ 아래라 거부
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(false);
    expect(view.ui).toEqual([]);
    expect(view.uiSource()).toBeNull();
  });

  it('거부: design 외부에 ui- 접두가 있어도 UI로 분류하지 않음', () => {
    const pool = [artifact('plan/ui-brainstorm.md')];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(false);
  });

  it('거부: legacy 평탄 경로 visual/ui-*.json 은 더 이상 UI로 매치되지 않음', () => {
    const pool = [
      artifact('visual/ui-tokens.json'),
      artifact('visual/ui-assets.json'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(false);
  });

  it('uiSource(): 두 UiSource 혼합이면 throw (hard-exclusive invariant)', () => {
    const pool = [
      artifact('visual/ui/ant/ui-tokens.json'),
      artifact('visual/ui/figma/figma.json'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(() => view.uiSource()).toThrow(/mixed UI sources/);
  });
});

