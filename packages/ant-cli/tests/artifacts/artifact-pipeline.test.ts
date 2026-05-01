import { describe, it, expect, vi } from 'vitest';
import {
  selectArtifactsWithPolicy,
  flattenPolicyToInclude,
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
// selectArtifactsWithPolicy
// ---------------------------------------------------------------------------

describe('selectArtifactsWithPolicy', () => {
  const pool: ResolvedArtifact[] = [
    artifact('plan', 'context', 'prd content'),
    artifact('architecture/system/fe-system-main.md', 'ref', 'fe design'),
    artifact('architecture/system/api-contract-auth.md', 'ref', 'api contract'),
    artifact('visual/ui/ant/tokens', 'context', 'ui tokens'),
    artifact('visual/ui/ant/spec/header', 'context', 'header spec'),
  ];

  it('refs 패턴에 매칭되는 아티팩트를 role=ref로 반환', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['plan'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('plan');
    expect(result[0].role).toBe('ref');
  });

  it('context 패턴에 매칭되는 아티팩트를 role=context로 반환', () => {
    const result = selectArtifactsWithPolicy(pool, {
      context: ['visual/ui/'],
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every(a => a.role === 'context')).toBe(true);
  });

  it('refs와 context 모두 매칭되면 refs 우선 (seen set)', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['plan'],
      context: ['plan'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('ref');
  });

  it('빈 policy면 빈 배열 반환', () => {
    expect(selectArtifactsWithPolicy(pool, {})).toEqual([]);
    expect(selectArtifactsWithPolicy(pool, { refs: [], context: [] })).toEqual([]);
  });

  it('매칭 없으면 빈 배열 반환', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['nonexistent/path'],
    });
    expect(result).toEqual([]);
  });

  it('pool 원본의 role을 policy의 role로 오버라이드', () => {
    const result = selectArtifactsWithPolicy(pool, {
      context: ['architecture/system/fe-system-'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('architecture/system/fe-system-main.md');
    expect(result[0].role).toBe('context');
  });

  it('glob-style trailing * 패턴 지원', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['architecture/system/api-contract-*'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('architecture/system/api-contract-auth.md');
    expect(result[0].role).toBe('ref');
  });
});

// ---------------------------------------------------------------------------
// flattenPolicyToInclude
// ---------------------------------------------------------------------------

describe('flattenPolicyToInclude', () => {
  it('refs+context를 하나의 string[]로 합침', () => {
    const result = flattenPolicyToInclude({
      refs: ['architecture/spec/'],
      context: ['visual/ui/ant/'],
    });
    expect(result).toEqual(['architecture/spec/', 'visual/ui/ant/']);
  });

  it('undefined 입력이면 undefined 반환', () => {
    expect(flattenPolicyToInclude(undefined)).toBeUndefined();
  });

  it('빈 refs+context면 undefined 반환', () => {
    expect(flattenPolicyToInclude({ refs: [], context: [] })).toBeUndefined();
  });

  it('refs만 있어도 동작', () => {
    const result = flattenPolicyToInclude({ refs: ['a', 'b'] });
    expect(result).toEqual(['a', 'b']);
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

// ---------------------------------------------------------------------------
// selectArtifacts task-type defaults — ui/design-system under ant
// ---------------------------------------------------------------------------

describe('selectArtifacts ui/design-system default', () => {
  it('ant 하위 UI 문서가 ui 태스크 기본 선택에 포함', () => {
    const candidates = [
      artifact('visual/ui/ant/ui-tokens.json'),
      artifact('visual/ui/ant/ui-assets.json'),
      artifact('architecture/system/fe-system-main.md'),
    ];
    const selected = selectArtifacts(candidates, { taskType: 'ui' });
    const paths = selected.map(a => a.path).sort();
    expect(paths).toEqual([
      'visual/ui/ant/ui-assets.json',
      'visual/ui/ant/ui-tokens.json',
    ]);
  });

  it('design-system 태스크도 동일 규칙', () => {
    const candidates = [
      artifact('visual/ui/ant/ui-spec.json'),
      artifact('visual/ui/ant/ui-tokens.json'),
    ];
    const selected = selectArtifacts(candidates, { taskType: 'design-system' });
    expect(selected).toHaveLength(2);
  });
});
