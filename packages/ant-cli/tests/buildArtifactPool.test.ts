import { describe, it, expect } from 'vitest';
import { ARTIFACT_PREFIX } from '@ant/shared';

/**
 * Since buildArtifactPool is a private function inside resolve.ts,
 * we test its logic by importing the module's exported functions
 * or by testing the equivalent logic pattern.
 *
 * The core logic under test:
 *   const hasDesignContent = opts.designDocs && (
 *     Object.values(opts.designDocs.feDesigns).some(v => !!v) ||
 *     Object.values(opts.designDocs.beDesigns).some(v => !!v) ||
 *     Object.values(opts.designDocs.apiContracts).some(v => !!v)
 *   );
 *   if (opts.design && !hasDesignContent) { pool.push full design }
 */

interface DesignDocsShape {
  apiContracts: Record<string, string>;
  feDesigns: Record<string, string>;
  beDesigns: Record<string, string>;
}

function hasDesignContent(designDocs?: DesignDocsShape): boolean {
  if (!designDocs) return false;
  return (
    Object.values(designDocs.feDesigns).some(v => !!v) ||
    Object.values(designDocs.beDesigns).some(v => !!v) ||
    Object.values(designDocs.apiContracts).some(v => !!v)
  );
}

describe('buildArtifactPool design fallback', () => {
  it('designDocs가 빈 객체(truthy지만 콘텐츠 없음)이면 full design을 pool에 추가해야 함', () => {
    const designDocs: DesignDocsShape = {
      feDesigns: {},
      beDesigns: {},
      apiContracts: {},
    };
    const design = 'full design content';

    expect(hasDesignContent(designDocs)).toBe(false);
    // design && !hasDesignContent → should add full
    expect(design && !hasDesignContent(designDocs)).toBe(true);
  });

  it('designDocs에 실제 콘텐츠가 있으면 full design 미추가', () => {
    const designDocs: DesignDocsShape = {
      feDesigns: { 'main': 'frontend design' },
      beDesigns: {},
      apiContracts: {},
    };

    expect(hasDesignContent(designDocs)).toBe(true);
    // design && !hasDesignContent → should NOT add full
    expect('some design' && !hasDesignContent(designDocs)).toBe(false);
  });

  it('design이 없으면 아무것도 추가하지 않음', () => {
    const design = '';
    const designDocs: DesignDocsShape = {
      feDesigns: {},
      beDesigns: {},
      apiContracts: {},
    };

    // falsy design → should not add
    expect(design && !hasDesignContent(designDocs)).toBeFalsy();
  });

  it('이전 구현(dead branch): designDocs가 truthy이면 항상 false였음', () => {
    const designDocs: DesignDocsShape = {
      feDesigns: {},
      beDesigns: {},
      apiContracts: {},
    };
    // Old check: !opts.designDocs → always false when designDocs is truthy
    expect(!designDocs).toBe(false);
    // New check: !hasDesignContent(designDocs) → correctly true for empty maps
    expect(!hasDesignContent(designDocs)).toBe(true);
  });

  it('apiContracts에만 콘텐츠가 있어도 full 미추가', () => {
    const designDocs: DesignDocsShape = {
      feDesigns: {},
      beDesigns: {},
      apiContracts: { 'auth': 'api contract content' },
    };
    expect(hasDesignContent(designDocs)).toBe(true);
  });
});
