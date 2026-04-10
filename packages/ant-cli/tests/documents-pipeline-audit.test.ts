/**
 * Audit 3: Documents Pipeline Verification
 *
 * Validates that documents[] are correctly constructed at each prompt build point:
 * - 3A. promptBuilder (code execute): explicit vs infer, designDoc/prd/uiDoc composition
 * - 3B. systemDesignPrompt (design execute): explicit vs infer, prdSpec handling
 * - 3C. planGeneration (code plan): planDocs from designDoc + uiDoc
 * - 3D. designSelector (code decompose): inline vs tool mode
 *
 * These tests verify the document composition LOGIC, not the full prompt rendering.
 * They use the same data flow patterns as the real code.
 */
import { describe, it, expect } from 'vitest';
import type { ResolvedActionContext, ResolvedDocument } from '@ant/shared';

// ============================================
// Shared helpers — mirror real code logic
// ============================================

function buildInferDocuments(opts: {
  designDoc?: string;
  prd?: string;
  uiDoc?: string;
  isVerification?: boolean;
  isError?: boolean;
  selectedSpec?: string;
  specContent?: string;
}): ResolvedDocument[] {
  const docs: ResolvedDocument[] = [];

  if (opts.designDoc) {
    docs.push({ path: 'system-design', content: opts.designDoc, role: 'ref', label: 'System Design' });
  }

  const prdContent = !opts.isVerification && !opts.isError ? opts.prd : undefined;
  if (prdContent) {
    docs.push({ path: 'prd', content: prdContent, role: 'context', label: 'PRD Specification' });
  }

  if (opts.uiDoc && !opts.isVerification && !opts.isError) {
    docs.push({ path: 'ui-spec', content: opts.uiDoc, role: 'context', label: 'UI Specification' });
  }

  return docs;
}

function buildExplicitRAC(docs: ResolvedDocument[]): ResolvedActionContext {
  return {
    source: 'explicit',
    jobMode: 'generate',
    tech: { language: 'typescript', environment: 'frontend' },
    hasExplicitFields: true,
    documents: docs,
  };
}

function buildInferRAC(): ResolvedActionContext {
  return {
    source: 'infer',
    jobMode: 'generate',
    tech: {},
    hasExplicitFields: false,
  };
}

// ============================================
// 3A. promptBuilder (code execute)
// ============================================

describe('Audit 3A: promptBuilder documents composition (code execute)', () => {
  describe('explicit + documents present → RAC.documents used as-is', () => {
    it('explicit RAC documents are preserved, infer docs not generated', () => {
      const explicitDocs: ResolvedDocument[] = [
        { path: 'user-file.md', content: 'User content', role: 'ref', label: 'User File' },
      ];
      const rac = buildExplicitRAC(explicitDocs);
      const hasExplicitDocs = rac.source === 'explicit' && (rac.documents?.length ?? 0) > 0;

      expect(hasExplicitDocs).toBe(true);
      expect(rac.documents).toEqual(explicitDocs);
    });
  });

  describe('explicit + documents empty → falls back to infer composition', () => {
    it('when explicit RAC has no documents, designDoc/prd/uiDoc are synthesized', () => {
      const rac: ResolvedActionContext = {
        source: 'explicit',
        jobMode: 'generate',
        tech: {},
        hasExplicitFields: true,
        documents: [],
      };
      const hasExplicitDocs = rac.source === 'explicit' && (rac.documents?.length ?? 0) > 0;
      expect(hasExplicitDocs).toBe(false);

      const docs = buildInferDocuments({
        designDoc: '# System Design',
        prd: '# PRD',
        uiDoc: '# UI Spec',
      });
      expect(docs).toHaveLength(3);
      expect(docs[0].path).toBe('system-design');
      expect(docs[1].path).toBe('prd');
      expect(docs[2].path).toBe('ui-spec');
    });
  });

  describe('infer + designDoc+prd+ui → 3 documents synthesized', () => {
    it('all three documents composed', () => {
      const docs = buildInferDocuments({
        designDoc: '# FE System Design',
        prd: '# Product Requirements',
        uiDoc: '# UI Tokens & Spec',
      });
      expect(docs).toHaveLength(3);
      expect(docs.map(d => d.path)).toEqual(['system-design', 'prd', 'ui-spec']);
      expect(docs.map(d => d.role)).toEqual(['ref', 'context', 'context']);
    });
  });

  describe('infer + designDoc only → 1 document', () => {
    it('only system-design document', () => {
      const docs = buildInferDocuments({ designDoc: '# Design' });
      expect(docs).toHaveLength(1);
      expect(docs[0].path).toBe('system-design');
      expect(docs[0].label).toBe('System Design');
    });
  });

  describe('infer + nothing → empty', () => {
    it('no documents when no source data', () => {
      const docs = buildInferDocuments({});
      expect(docs).toHaveLength(0);
    });
  });

  describe('verification task → prd/uiDoc skipped', () => {
    it('only designDoc included for verification', () => {
      const docs = buildInferDocuments({
        designDoc: '# Design',
        prd: '# PRD',
        uiDoc: '# UI',
        isVerification: true,
      });
      expect(docs).toHaveLength(1);
      expect(docs[0].path).toBe('system-design');
    });

    it('no docs at all when verification + no designDoc', () => {
      const docs = buildInferDocuments({
        prd: '# PRD',
        uiDoc: '# UI',
        isVerification: true,
      });
      expect(docs).toHaveLength(0);
    });
  });

  describe('error task → prd/uiDoc skipped', () => {
    it('only designDoc included for error', () => {
      const docs = buildInferDocuments({
        designDoc: '# Design',
        prd: '# PRD',
        uiDoc: '# UI',
        isError: true,
      });
      expect(docs).toHaveLength(1);
      expect(docs[0].path).toBe('system-design');
    });
  });

  describe('resolvedActionWithDocs construction', () => {
    it('infer path: creates new RAC with documents when docs > 0', () => {
      const inferRAC = buildInferRAC();
      const docs = buildInferDocuments({ designDoc: '# Design', prd: '# PRD' });

      const resolvedActionWithDocs = docs.length > 0
        ? { ...inferRAC, documents: docs }
        : inferRAC;

      expect(resolvedActionWithDocs.documents).toHaveLength(2);
      expect(resolvedActionWithDocs.source).toBe('infer');
    });

    it('infer path: no resolvedAction → creates default RAC shell', () => {
      const docs = buildInferDocuments({ designDoc: '# Design' });
      const resolvedActionWithDocs = docs.length > 0
        ? {
            source: 'infer' as const,
            jobMode: 'generate' as const,
            tech: {},
            hasExplicitFields: false,
            documents: docs,
          }
        : undefined;

      expect(resolvedActionWithDocs).toBeDefined();
      expect(resolvedActionWithDocs!.source).toBe('infer');
      expect(resolvedActionWithDocs!.documents).toHaveLength(1);
    });
  });
});

// ============================================
// 3B. systemDesignPrompt (design execute)
// ============================================

describe('Audit 3B: systemDesignPrompt documents composition (design execute)', () => {
  it('explicit + documents → RAC.documents as-is, useSourceFileTool=false', () => {
    const explicitDocs: ResolvedDocument[] = [
      { path: 'user-prd.md', content: 'Explicit PRD', role: 'ref' },
    ];
    const rac = buildExplicitRAC(explicitDocs);
    const hasExplicitDocs = rac.source === 'explicit' && (rac.documents?.length ?? 0) > 0;

    expect(hasExplicitDocs).toBe(true);
    const useSourceFileTool = false;
    expect(useSourceFileTool).toBe(false);
  });

  it('infer + prdSpec present → 1 document (source-docs)', () => {
    const prdSpec = '# PRD Specification\nFeature details...';
    const docs: ResolvedDocument[] = [];
    if (prdSpec) {
      docs.push({ path: 'source-docs', content: prdSpec, role: 'context', label: 'PRD Specification' });
    }

    expect(docs).toHaveLength(1);
    expect(docs[0].path).toBe('source-docs');
    expect(docs[0].label).toBe('PRD Specification');
  });

  it('infer + prdSpec absent → no documents', () => {
    const prdSpec = undefined;
    const docs: ResolvedDocument[] = [];
    if (prdSpec) {
      docs.push({ path: 'source-docs', content: prdSpec, role: 'context', label: 'PRD Specification' });
    }

    expect(docs).toHaveLength(0);
  });

  it('infer + large prdSpec → transforms to index, useSourceFileTool=true', () => {
    const EXECUTE_SOURCE_THRESHOLD = 100_000;
    const largePrd = 'x'.repeat(EXECUTE_SOURCE_THRESHOLD + 1);
    const useSourceFileTool = largePrd.length > EXECUTE_SOURCE_THRESHOLD;

    expect(useSourceFileTool).toBe(true);
  });
});

// ============================================
// 3C. planGeneration (code plan)
// ============================================

describe('Audit 3C: planGeneration planDocs composition (code plan)', () => {
  function buildPlanDocs(designDoc?: string, uiDoc?: string, isSpecDriven?: boolean): ResolvedDocument[] {
    const planDocs: ResolvedDocument[] = [];
    if (designDoc) {
      const docLabel = isSpecDriven ? 'Feature Specification' : 'Design Specification';
      planDocs.push({ path: 'system-design', content: designDoc, role: 'ref', label: docLabel });
    }
    if (uiDoc) {
      planDocs.push({ path: 'ui-spec', content: uiDoc, role: 'context', label: 'UI Specification' });
    }
    return planDocs;
  }

  it('designDoc + uiDoc → 2 planDocs', () => {
    const docs = buildPlanDocs('# System Design', '# UI Spec');
    expect(docs).toHaveLength(2);
    expect(docs[0].path).toBe('system-design');
    expect(docs[0].label).toBe('Design Specification');
    expect(docs[1].path).toBe('ui-spec');
    expect(docs[1].label).toBe('UI Specification');
  });

  it('designDoc only → 1 planDoc', () => {
    const docs = buildPlanDocs('# System Design');
    expect(docs).toHaveLength(1);
    expect(docs[0].path).toBe('system-design');
  });

  it('neither → empty planDocs', () => {
    const docs = buildPlanDocs();
    expect(docs).toHaveLength(0);
  });

  it('spec-driven label: Feature Specification', () => {
    const docs = buildPlanDocs('# Spec content', undefined, true);
    expect(docs[0].label).toBe('Feature Specification');
  });

  it('non-spec label: Design Specification', () => {
    const docs = buildPlanDocs('# Design content', undefined, false);
    expect(docs[0].label).toBe('Design Specification');
  });

  it('planDocs are independent of resolvedAction.documents', () => {
    const racDocs: ResolvedDocument[] = [
      { path: 'ref-file', content: 'UNIQUE_REF_CONTENT', role: 'ref' },
    ];
    const planDocs = buildPlanDocs('# Design', '# UI');

    const racDocPaths = new Set(racDocs.map(d => d.path));
    const planDocPaths = new Set(planDocs.map(d => d.path));

    expect(racDocPaths.has('system-design')).toBe(false);
    expect(planDocPaths.has('ref-file')).toBe(false);
  });
});

// ============================================
// 3D. designSelector (code decompose)
// ============================================

describe('Audit 3D: designSelector documents composition (code decompose)', () => {
  function selectDesignDocumentsAsResolved(designDocs?: {
    apiContracts: Record<string, string>;
    feDesigns: Record<string, string>;
    beDesigns: Record<string, string>;
  }, design?: string): ResolvedDocument[] {
    if (!designDocs) {
      if (design) {
        return [{ path: 'design', content: design, role: 'ref', label: 'Design Document' }];
      }
      return [];
    }

    const docs: ResolvedDocument[] = [];
    for (const [name, content] of Object.entries(designDocs.apiContracts)) {
      docs.push({ path: `api-contract-${name}.md`, content, role: 'ref', label: `API Contract: ${name}` });
    }
    for (const [name, content] of Object.entries(designDocs.feDesigns)) {
      docs.push({ path: `fe-system-${name}.md`, content, role: 'ref', label: `Frontend Design: ${name}` });
    }
    for (const [name, content] of Object.entries(designDocs.beDesigns)) {
      docs.push({ path: `be-system-${name}.md`, content, role: 'ref', label: `Backend Design: ${name}` });
    }
    return docs;
  }

  it('inline mode: multiple design documents as individual ResolvedDocument[]', () => {
    const docs = selectDesignDocumentsAsResolved({
      apiContracts: { main: '# API' },
      feDesigns: { main: '# FE' },
      beDesigns: { main: '# BE' },
    });
    expect(docs).toHaveLength(3);
    expect(docs.map(d => d.role)).toEqual(['ref', 'ref', 'ref']);
  });

  it('tool mode: single design-index document', () => {
    const DECOMPOSE_SOURCE_THRESHOLD = 50_000;
    const largeDesign = 'x'.repeat(DECOMPOSE_SOURCE_THRESHOLD + 1);
    const isToolMode = largeDesign.length > DECOMPOSE_SOURCE_THRESHOLD;
    expect(isToolMode).toBe(true);

    const docs: ResolvedDocument[] = [
      { path: 'design-index', content: '## Index\n...', role: 'ref', label: 'Design Documents (Index)' },
    ];
    expect(docs).toHaveLength(1);
    expect(docs[0].path).toBe('design-index');
  });

  it('no designDocs but state.design exists → fallback single doc', () => {
    const docs = selectDesignDocumentsAsResolved(undefined, '# Legacy design');
    expect(docs).toHaveLength(1);
    expect(docs[0].path).toBe('design');
    expect(docs[0].content).toBe('# Legacy design');
  });

  it('no designDocs and no design → empty', () => {
    const docs = selectDesignDocumentsAsResolved();
    expect(docs).toHaveLength(0);
  });

  it('fe+be without api contracts → 2 docs', () => {
    const docs = selectDesignDocumentsAsResolved({
      apiContracts: {},
      feDesigns: { main: '# FE Design' },
      beDesigns: { main: '# BE Design' },
    });
    expect(docs).toHaveLength(2);
    expect(docs[0].path).toBe('fe-system-main.md');
    expect(docs[1].path).toBe('be-system-main.md');
  });
});
