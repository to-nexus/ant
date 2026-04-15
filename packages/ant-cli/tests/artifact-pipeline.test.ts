import { describe, it, expect, vi } from 'vitest';
import {
  selectArtifactsWithPolicy,
  flattenPolicyToInclude,
  appendOrUpdatePool,
  selectArtifacts,
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
