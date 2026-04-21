import { describe, it, expect, vi } from 'vitest';
import {
  selectArtifactsWithPolicy,
  flattenPolicyToInclude,
  appendOrUpdatePool,
  selectArtifacts,
  ArtifactPoolView,
} from '../src/core/artifact/ArtifactPipeline';
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
    artifact('inputs/sources', 'context', 'prd content'),
    artifact('outputs/design/system/fe-system-main.md', 'ref', 'fe design'),
    artifact('outputs/design/system/api-contract-auth.md', 'ref', 'api contract'),
    artifact('outputs/design/ui/tokens', 'context', 'ui tokens'),
    artifact('outputs/design/ui/spec/header', 'context', 'header spec'),
  ];

  it('refs 패턴에 매칭되는 아티팩트를 role=ref로 반환', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['inputs/sources'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('inputs/sources');
    expect(result[0].role).toBe('ref');
  });

  it('context 패턴에 매칭되는 아티팩트를 role=context로 반환', () => {
    const result = selectArtifactsWithPolicy(pool, {
      context: ['outputs/design/ui/'],
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every(a => a.role === 'context')).toBe(true);
  });

  it('refs와 context 모두 매칭되면 refs 우선 (seen set)', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['inputs/sources'],
      context: ['inputs/sources'],
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
      context: ['outputs/design/system/fe-system-'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('outputs/design/system/fe-system-main.md');
    expect(result[0].role).toBe('context');
  });

  it('glob-style trailing * 패턴 지원', () => {
    const result = selectArtifactsWithPolicy(pool, {
      refs: ['outputs/design/system/api-contract-*'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('outputs/design/system/api-contract-auth.md');
    expect(result[0].role).toBe('ref');
  });
});

// ---------------------------------------------------------------------------
// flattenPolicyToInclude
// ---------------------------------------------------------------------------

describe('flattenPolicyToInclude', () => {
  it('refs+context를 하나의 string[]로 합침', () => {
    const result = flattenPolicyToInclude({
      refs: ['outputs/design/spec/'],
      context: ['outputs/design/ui/'],
    });
    expect(result).toEqual(['outputs/design/spec/', 'outputs/design/ui/']);
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
    const pool = [artifact('inputs/sources', 'context')];
    const newArts = [artifact('inputs/sources', 'ref')];

    const result = appendOrUpdatePool(pool, newArts);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Role conflict');
    expect(warnSpy.mock.calls[0][0]).toContain('inputs/sources');
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('ref');

    warnSpy.mockRestore();
  });

  it('같은 path에 같은 role이면 경고 없음', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = [artifact('inputs/sources', 'context')];
    const newArts = [artifact('inputs/sources', 'context', 'updated content')];

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
// ArtifactPoolView.hasUi / ui — nested + flat-path fallback
// ---------------------------------------------------------------------------

describe('ArtifactPoolView UI detection', () => {
  it('인정: nested outputs/design/ui/ 경로 (canonical)', () => {
    const pool = [
      artifact('outputs/design/ui/ui-tokens.json'),
      artifact('outputs/design/ui/ui-spec.json'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(true);
    expect(view.ui).toHaveLength(2);
  });

  it('인정: flat outputs/design/ui-*.json 폴백 (design graph의 uiFlatPath)', () => {
    const pool = [
      artifact('outputs/design/ui-tokens.json'),
      artifact('outputs/design/ui-assets.json'),
      artifact('outputs/design/ui-spec.json'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(true);
    expect(view.ui.map(a => a.path).sort()).toEqual([
      'outputs/design/ui-assets.json',
      'outputs/design/ui-spec.json',
      'outputs/design/ui-tokens.json',
    ]);
  });

  it('거부: outputs/design/system 같은 비-ui 경로', () => {
    const pool = [
      artifact('outputs/design/system/fe-system-main.md'),
      artifact('outputs/design/system/ui-foo.md'), // ui- 가 basename이지만 system/ 아래라 거부
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(false);
    expect(view.ui).toEqual([]);
  });

  it('거부: design 외부에 ui- 접두가 있어도 UI로 분류하지 않음', () => {
    const pool = [
      artifact('inputs/sources/ui-brainstorm.md'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(false);
  });

  it('nested + flat 혼재도 모두 수거', () => {
    const pool = [
      artifact('outputs/design/ui/ui-tokens.json'),
      artifact('outputs/design/ui-assets.json'),
      artifact('outputs/design/system/fe-system-main.md'),
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasUi()).toBe(true);
    expect(view.ui).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// selectArtifacts task-type defaults — ui/design-system flat-path
// ---------------------------------------------------------------------------

describe('selectArtifacts ui/design-system default', () => {
  it('flat-path UI 문서도 ui 태스크 기본 선택에 포함', () => {
    const candidates = [
      artifact('outputs/design/ui/ui-tokens.json'),
      artifact('outputs/design/ui-assets.json'),
      artifact('outputs/design/system/fe-system-main.md'),
    ];
    const selected = selectArtifacts(candidates, { taskType: 'ui' });
    const paths = selected.map(a => a.path).sort();
    expect(paths).toEqual([
      'outputs/design/ui-assets.json',
      'outputs/design/ui/ui-tokens.json',
    ]);
  });

  it('design-system 태스크도 동일 규칙', () => {
    const candidates = [
      artifact('outputs/design/ui/ui-spec.json'),
      artifact('outputs/design/ui-tokens.json'),
    ];
    const selected = selectArtifacts(candidates, { taskType: 'design-system' });
    expect(selected).toHaveLength(2);
  });
});
