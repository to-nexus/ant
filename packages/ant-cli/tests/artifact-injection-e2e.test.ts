/**
 * Artifact Injection E2E Tests
 *
 * Verifies the forward injection pipeline: user-provided artifacts (ref/context roles)
 * and directives reach the correct sections of the final prompt.
 *
 * 8 artifact cases + 4 directive cases = 12 scenarios.
 * Results are collected into a JSON matrix at tests/__generated__/artifact-injection-matrix.json.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptBuilder } from '../src/core/prompt/builder/PromptBuilder';
import type { PromptBuildConfig, PromptBuildResult } from '../src/core/prompt/builder/PromptBuildConfig';
import type { ResolvedArtifact } from '@ant/shared';
import { resolveToRAC } from '@ant/shared';
import type { IntentId } from '@ant/shared';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
const OUTPUT_PATH = join(__dirname, '__generated__/artifact-injection-matrix.json');

let promptBuilder: PromptBuilder;

// ============================================
// Injection Template Fingerprints (unique text per template)
// ============================================

const INJECTION_FP: Record<string, string> = {
  'jobs/shared/injections/action-context': 'User Action Specification',
  'jobs/shared/injections/directive': 'SYSTEM NOTE',
  'jobs/shared/injections/visual-source-authority': 'Visual Source Authority',
  'jobs/shared/injections/memory': 'Relevant Memory',
  'jobs/code/base/injections/preview-setup': 'Path Prefix Configuration',
  'jobs/code/base/injections/tool-calling-rules-compact': 'Observe Before Repeating',
  'jobs/code/base/injections/preview-env-contract': 'Dev Server Runtime Contract',
  'jobs/code/nodes/execute/injections/port-management': 'Port Management',
  'jobs/code/base/injections/behavioral-debugging': 'Behavioral bugs cannot be diagnosed',
  'jobs/code/nodes/execute/injections/backend-safety': 'Backend Safety Principles',
  'jobs/design/base/injections/document-language': 'Document Output Language',
};

// ============================================
// Result Store (full PromptBuildResult per scenario)
// ============================================

const results: Record<string, PromptBuildResult> = {};

// ============================================
// Fingerprint Constants
// ============================================

// Under the 3-axis role model (Authority / Edit-scope / Task-scope), `ref`
// and `context` are BOTH authoritative inputs rendered under a single
// "## Provided Documents" section. Authority is conveyed by hierarchical
// [ref] / [context] labels and the role-guide partial wording, not by
// separate "Primary References" / "Background Context" section headers
// (which were the legacy binary Authority/Background dichotomy this
// refactor removed). See `jobs/shared/injections/role-guide.md`.
const ART_FP = {
  DOCS_SECTION: '## Provided Documents',
  REF_HEADER_PREFIX: '### [ref]',
  CTX_HEADER_PREFIX: '### [context]',
  ROLE_GUIDE_AUTHORITY: 'both authoritative inputs',
  REF_MARKER: '__ART_REF_MARKER_e7b3a1__',
  CTX_MARKER: '__ART_CTX_MARKER_f9d2c4__',
  DIR_ROLE_MARKER: '__ART_DIR_ROLE_MARKER_a1b2c3__',
  DIRECTIVE_MARKER: '__DIRECTIVE_MARKER_7x9k2m__',
  DIRECTIVE_HEADER: '# Directive',
} as const;

// ============================================
// Artifact Fixtures
// ============================================

const refArtifact: ResolvedArtifact = {
  path: 'outputs/design/system/fe-system-main.md',
  content: `Frontend design ${ART_FP.REF_MARKER} document`,
  role: 'ref',
};

const ctxArtifact: ResolvedArtifact = {
  path: 'inputs/sources/prd.md',
  content: `PRD requirements ${ART_FP.CTX_MARKER} document`,
  role: 'context',
};

const dirRoleArtifact: ResolvedArtifact = {
  path: 'inputs/directives/main.md',
  content: `Directive content ${ART_FP.DIR_ROLE_MARKER}`,
  role: 'directive',
};

// ============================================
// Helpers
// ============================================

function assertMarkerInSection(text: string, marker: string, sectionStart: string, sectionEnd?: string) {
  const startIdx = text.indexOf(sectionStart);
  const markerIdx = text.indexOf(marker);
  expect(startIdx, `section "${sectionStart}" not found`).toBeGreaterThan(-1);
  expect(markerIdx, `marker not found`).toBeGreaterThan(startIdx);
  if (sectionEnd) {
    const endIdx = text.indexOf(sectionEnd, startIdx + sectionStart.length);
    if (endIdx > startIdx) {
      expect(markerIdx, `marker should be before "${sectionEnd}"`).toBeLessThan(endIdx);
    }
  }
}

function countOccurrences(text: string, marker: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(marker, pos)) !== -1) {
    count++;
    pos += marker.length;
  }
  return count;
}

function assertExactlyOnce(text: string, marker: string, label: string) {
  const count = countOccurrences(text, marker);
  expect(count, `${label}: expected exactly 1 occurrence, got ${count}`).toBe(1);
}

function assertNoDuplicateInjectionPaths(injections: string[]) {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const p of injections) {
    if (seen.has(p)) dupes.push(p);
    seen.add(p);
  }
  expect(dupes, `duplicate injection paths: ${dupes.join(', ')}`).toHaveLength(0);
}

function makeCodeExecuteConfig(overrides: Partial<PromptBuildConfig>): PromptBuildConfig {
  const rac = resolveToRAC('gen-code-sys' as IntentId, {
    refs: ['outputs/design/system/fe-system-main.md'],
  }, 'explicit');

  return {
    templates: {
      base: 'jobs/code/nodes/execute/variants/default/base',
      rules: 'jobs/code/nodes/execute/variants/default/rules',
      system: 'jobs/code/base/system',
    },
    techContext: {
      techTier: { language: 'typescript', stack: 'frontend' },
      techTiers: [{ language: 'typescript', stack: 'frontend' }],
      taskType: 'feature',
      mode: 'generate',
      resolvedAction: rac,
    },
    pipeline: {
      sanitizeInput: true,
      includeBasis: false,
      includeExamples: false,
      applyPolicyGuardrails: false,
    },
    vars: {
      currentTask: { id: 't1', type: 'feature', description: 'Test task', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
      resolvedAction: rac,
      projectFileTree: 'src/\n  index.ts',
    },
    ...overrides,
  };
}

// ============================================
// Matrix Collection
// ============================================

interface InjectionTestResult {
  scenario: string;
  template: string;
  refMarkerInInjections?: boolean;
  ctxMarkerInInjections?: boolean;
  refMarkerInUser?: boolean;
  ctxMarkerInUser?: boolean;
  refInPrimarySection?: boolean;
  ctxInBackgroundSection?: boolean;
  directiveMarkerInInjections?: boolean;
  directiveMarkerInUser?: boolean;
  directiveHeaderInInjections?: boolean;
  refCountTotal: number;
  ctxCountTotal: number;
  directiveCountTotal: number;
  duplicateInjectionPaths: string[];
  failedTemplates: number;
  injectionPaths: string[];
}

type InjectionMatrix = Record<string, InjectionTestResult>;

const matrix: InjectionMatrix = {};

function collectResult(key: string, scenario: string, template: string, result: PromptBuildResult) {
  results[key] = result;

  const injText = result.sections.injections;
  const userText = result.user;
  const fullText = injText + userText;

  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const p of result.injections) {
    if (seen.has(p)) dupes.push(p);
    seen.add(p);
  }

  matrix[key] = {
    scenario,
    template,
    refMarkerInInjections: injText.includes(ART_FP.REF_MARKER),
    ctxMarkerInInjections: injText.includes(ART_FP.CTX_MARKER),
    refMarkerInUser: userText.includes(ART_FP.REF_MARKER),
    ctxMarkerInUser: userText.includes(ART_FP.CTX_MARKER),
    refInPrimarySection: injText.includes(ART_FP.DOCS_SECTION) && injText.includes(ART_FP.REF_HEADER_PREFIX) && injText.includes(ART_FP.REF_MARKER),
    ctxInBackgroundSection: injText.includes(ART_FP.DOCS_SECTION) && injText.includes(ART_FP.CTX_HEADER_PREFIX) && injText.includes(ART_FP.CTX_MARKER),
    directiveMarkerInInjections: injText.includes(ART_FP.DIRECTIVE_MARKER),
    directiveMarkerInUser: userText.includes(ART_FP.DIRECTIVE_MARKER),
    directiveHeaderInInjections: injText.includes(ART_FP.DIRECTIVE_HEADER),
    refCountTotal: countOccurrences(fullText, ART_FP.REF_MARKER),
    ctxCountTotal: countOccurrences(fullText, ART_FP.CTX_MARKER),
    directiveCountTotal: countOccurrences(fullText, ART_FP.DIRECTIVE_MARKER),
    duplicateInjectionPaths: dupes,
    failedTemplates: result.sections.failedTemplates.length,
    injectionPaths: result.injections,
  };
}

// ============================================
// Setup
// ============================================

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  promptBuilder = new PromptBuilder(adapter);
});

// ============================================
// A1: code execute — ref + context
// ============================================

describe('A1: code execute — ref + context', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-code-sys' as IntentId, {
      refs: [refArtifact.path],
      context: [ctxArtifact.path],
    }, 'explicit');

    result = await promptBuilder.build(makeCodeExecuteConfig({
      artifacts: [refArtifact, ctxArtifact],
      vars: {
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: rac,
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('A1', 'code execute: ref+context', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('REF marker appears under [ref] sub-header inside Provided Documents', () => {
    const docsIdx = result.sections.injections.indexOf(ART_FP.DOCS_SECTION);
    const refHeaderIdx = result.sections.injections.indexOf(ART_FP.REF_HEADER_PREFIX);
    const refMarkerIdx = result.sections.injections.indexOf(ART_FP.REF_MARKER);
    expect(docsIdx, 'Provided Documents section must exist').toBeGreaterThan(-1);
    expect(refHeaderIdx, '[ref] sub-header must exist').toBeGreaterThan(docsIdx);
    expect(refMarkerIdx, 'REF marker must appear after [ref] sub-header').toBeGreaterThan(refHeaderIdx);
  });

  it('CTX marker appears under [context] sub-header inside Provided Documents', () => {
    const docsIdx = result.sections.injections.indexOf(ART_FP.DOCS_SECTION);
    const ctxHeaderIdx = result.sections.injections.indexOf(ART_FP.CTX_HEADER_PREFIX);
    const ctxMarkerIdx = result.sections.injections.indexOf(ART_FP.CTX_MARKER);
    expect(docsIdx, 'Provided Documents section must exist').toBeGreaterThan(-1);
    expect(ctxHeaderIdx, '[context] sub-header must exist').toBeGreaterThan(docsIdx);
    expect(ctxMarkerIdx, 'CTX marker must appear after [context] sub-header').toBeGreaterThan(ctxHeaderIdx);
  });

  it('REF marker is NOT in [context] sub-section', () => {
    const ctxHeaderIdx = result.sections.injections.indexOf(ART_FP.CTX_HEADER_PREFIX);
    expect(ctxHeaderIdx, '[context] sub-header must exist').toBeGreaterThan(-1);
    const ctxText = result.sections.injections.slice(ctxHeaderIdx);
    expect(ctxText).not.toContain(ART_FP.REF_MARKER);
  });

  it('CTX marker is NOT in [ref] sub-section (refs render before context)', () => {
    const refHeaderIdx = result.sections.injections.indexOf(ART_FP.REF_HEADER_PREFIX);
    const ctxHeaderIdx = result.sections.injections.indexOf(ART_FP.CTX_HEADER_PREFIX);
    expect(refHeaderIdx).toBeGreaterThan(-1);
    expect(ctxHeaderIdx).toBeGreaterThan(refHeaderIdx);
    const refText = result.sections.injections.slice(refHeaderIdx, ctxHeaderIdx);
    expect(refText).not.toContain(ART_FP.CTX_MARKER);
  });

  it('no duplicate: REF marker exactly once across full output', () => {
    assertExactlyOnce(result.sections.injections + result.user, ART_FP.REF_MARKER, 'REF');
  });

  it('no duplicate: CTX marker exactly once across full output', () => {
    assertExactlyOnce(result.sections.injections + result.user, ART_FP.CTX_MARKER, 'CTX');
  });

  it('no duplicate injection paths', () => {
    assertNoDuplicateInjectionPaths(result.injections);
  });

  it('no cross-path leak: markers not in both injections AND user', () => {
    const inj = result.sections.injections;
    const usr = result.user;
    expect(inj.includes(ART_FP.REF_MARKER) && usr.includes(ART_FP.REF_MARKER),
      'REF in both injections and user').toBe(false);
    expect(inj.includes(ART_FP.CTX_MARKER) && usr.includes(ART_FP.CTX_MARKER),
      'CTX in both injections and user').toBe(false);
  });
});

// ============================================
// A2: code execute — ref only
// ============================================

describe('A2: code execute — ref only', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-code-sys' as IntentId, {
      refs: [refArtifact.path],
    }, 'explicit');

    result = await promptBuilder.build(makeCodeExecuteConfig({
      artifacts: [refArtifact],
      vars: {
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: rac,
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('A2', 'code execute: ref only', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('REF marker under [ref] sub-header inside Provided Documents', () => {
    const docsIdx = result.sections.injections.indexOf(ART_FP.DOCS_SECTION);
    const refHeaderIdx = result.sections.injections.indexOf(ART_FP.REF_HEADER_PREFIX);
    const refMarkerIdx = result.sections.injections.indexOf(ART_FP.REF_MARKER);
    expect(docsIdx).toBeGreaterThan(-1);
    expect(refHeaderIdx).toBeGreaterThan(docsIdx);
    expect(refMarkerIdx).toBeGreaterThan(refHeaderIdx);
  });

  it('CTX marker nowhere in full output', () => {
    expect(result.sections.injections).not.toContain(ART_FP.CTX_MARKER);
    expect(result.user).not.toContain(ART_FP.CTX_MARKER);
  });

  it('no [context] sub-header rendered when no context artifacts', () => {
    // Under the 3-axis model, [context] sub-header is omitted when the
    // documents array has no context entries — no empty section placeholder.
    expect(result.sections.injections).not.toContain(ART_FP.CTX_HEADER_PREFIX);
  });

  it('no duplicate: REF marker exactly once', () => {
    assertExactlyOnce(result.sections.injections + result.user, ART_FP.REF_MARKER, 'REF');
  });

  it('no duplicate injection paths', () => {
    assertNoDuplicateInjectionPaths(result.injections);
  });
});

// ============================================
// A3: code execute — context only
// ============================================

describe('A3: code execute — context only', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-code-sys' as IntentId, {
      context: [ctxArtifact.path],
    }, 'explicit');

    result = await promptBuilder.build(makeCodeExecuteConfig({
      artifacts: [ctxArtifact],
      vars: {
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: rac,
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('A3', 'code execute: context only', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('CTX marker under [context] sub-header inside Provided Documents', () => {
    const docsIdx = result.sections.injections.indexOf(ART_FP.DOCS_SECTION);
    const ctxHeaderIdx = result.sections.injections.indexOf(ART_FP.CTX_HEADER_PREFIX);
    const ctxMarkerIdx = result.sections.injections.indexOf(ART_FP.CTX_MARKER);
    expect(docsIdx).toBeGreaterThan(-1);
    expect(ctxHeaderIdx).toBeGreaterThan(docsIdx);
    expect(ctxMarkerIdx).toBeGreaterThan(ctxHeaderIdx);
  });

  it('REF marker nowhere in full output', () => {
    expect(result.sections.injections).not.toContain(ART_FP.REF_MARKER);
    expect(result.user).not.toContain(ART_FP.REF_MARKER);
  });

  it('no duplicate: CTX marker exactly once', () => {
    assertExactlyOnce(result.sections.injections + result.user, ART_FP.CTX_MARKER, 'CTX');
  });

  it('no duplicate injection paths', () => {
    assertNoDuplicateInjectionPaths(result.injections);
  });
});

// ============================================
// A4: no artifacts, no resolvedAction
// ============================================

describe('A4: no artifacts, no resolvedAction', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    result = await promptBuilder.build(makeCodeExecuteConfig({
      artifacts: undefined,
      techContext: {
        techTier: { language: 'typescript', stack: 'frontend' },
        techTiers: [{ language: 'typescript', stack: 'frontend' }],
        taskType: 'feature',
        mode: 'generate',
      },
      vars: {
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('A4', 'no artifacts, no resolvedAction', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('Provided Documents section NOT in injections (no artifacts, no RAC)', () => {
    expect(result.sections.injections).not.toContain(ART_FP.DOCS_SECTION);
    expect(result.sections.injections).not.toContain(ART_FP.REF_HEADER_PREFIX);
    expect(result.sections.injections).not.toContain(ART_FP.CTX_HEADER_PREFIX);
  });

  it('no artifact markers anywhere', () => {
    const fullText = result.system + result.user;
    expect(fullText).not.toContain(ART_FP.REF_MARKER);
    expect(fullText).not.toContain(ART_FP.CTX_MARKER);
  });
});

// ============================================
// A5: defensive bridge — resolvedAction.artifacts only
// ============================================

describe('A5: defensive bridge — resolvedAction.artifacts only', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-code-sys' as IntentId, {
      refs: [refArtifact.path],
    }, 'explicit');

    const racWithArtifacts = { ...rac, artifacts: [refArtifact] };

    result = await promptBuilder.build(makeCodeExecuteConfig({
      artifacts: undefined,
      vars: {
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: racWithArtifacts,
        projectFileTree: 'src/\n  index.ts',
      },
      techContext: {
        techTier: { language: 'typescript', stack: 'frontend' },
        techTiers: [{ language: 'typescript', stack: 'frontend' }],
        taskType: 'feature',
        mode: 'generate',
        resolvedAction: rac,
      },
    }));

    collectResult('A5', 'defensive bridge: resolvedAction.artifacts only', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('defensive bridge populates documents — REF marker in injections', () => {
    expect(result.sections.injections).toContain(ART_FP.REF_MARKER);
  });

  it('no duplicate: REF marker exactly once', () => {
    assertExactlyOnce(result.sections.injections + result.user, ART_FP.REF_MARKER, 'REF');
  });

  it('no duplicate injection paths', () => {
    assertNoDuplicateInjectionPaths(result.injections);
  });
});

// ============================================
// A6: spec — partial path (action-context via {{> partial}})
// ============================================

describe('A6: spec — partial path', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-spec' as IntentId, {
      refs: [refArtifact.path],
      context: [ctxArtifact.path],
    }, 'explicit');

    const racWithDocs = { ...rac, artifacts: [refArtifact, ctxArtifact] };

    result = await promptBuilder.build({
      templates: {
        base: 'jobs/design/nodes/execute/variants/spec/base',
        rules: 'jobs/design/nodes/execute/variants/spec/rules',
        system: 'jobs/design/base/system',
      },
      pipeline: {
        sanitizeInput: true,
        applyPolicyGuardrails: false,
      },
      artifacts: [refArtifact, ctxArtifact],
      vars: {
        directive: 'Create spec',
        taskDescription: 'Spec for test',
        projectFileTree: 'src/\n  index.ts',
        resolvedAction: racWithDocs,
      },
    });

    collectResult('A6', 'spec: partial path', 'design/spec', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('REF/CTX markers in result.user (via partial, not injection)', () => {
    expect(result.user).toContain(ART_FP.REF_MARKER);
    expect(result.user).toContain(ART_FP.CTX_MARKER);
  });

  it('markers NOT in sections.injections', () => {
    expect(result.sections.injections).not.toContain(ART_FP.REF_MARKER);
    expect(result.sections.injections).not.toContain(ART_FP.CTX_MARKER);
  });

  it('no duplicate: REF marker exactly once in user', () => {
    assertExactlyOnce(result.user, ART_FP.REF_MARKER, 'REF in user');
  });

  it('no duplicate: CTX marker exactly once in user', () => {
    assertExactlyOnce(result.user, ART_FP.CTX_MARKER, 'CTX in user');
  });

  it('no cross-path leak: markers not in both injections AND user', () => {
    const inj = result.sections.injections;
    const usr = result.user;
    expect(inj.includes(ART_FP.REF_MARKER) && usr.includes(ART_FP.REF_MARKER),
      'REF in both injections and user').toBe(false);
    expect(inj.includes(ART_FP.CTX_MARKER) && usr.includes(ART_FP.CTX_MARKER),
      'CTX in both injections and user').toBe(false);
  });
});

// ============================================
// A7: verification — skips action-context
// ============================================

describe('A7: verification — skips action-context', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    result = await promptBuilder.build({
      templates: {
        base: 'jobs/code/nodes/execute/variants/verification/base',
        rules: 'jobs/code/nodes/execute/variants/verification/rules',
        system: 'jobs/code/base/system',
      },
      techContext: {
        techTier: { language: 'typescript', stack: 'frontend' },
        taskType: 'verification',
        mode: 'generate',
      },
      pipeline: {
        sanitizeInput: true,
        includeBasis: false,
        includeExamples: false,
        applyPolicyGuardrails: false,
      },
      artifacts: [refArtifact],
      vars: {
        currentTask: { id: 't2', type: 'verification', description: 'Verify', targetFile: '', name: 'verify', priority: 'high' },
        projectFileTree: 'src/\n  index.ts',
      },
    });

    collectResult('A7', 'verification: skips action-context', 'code/execute/verification', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('action-context NOT in injections list', () => {
    expect(result.injections).not.toContain('jobs/shared/injections/action-context');
  });

  it('REF marker NOT in injections', () => {
    expect(result.sections.injections).not.toContain(ART_FP.REF_MARKER);
  });
});

// ============================================
// A8: directive role — silent drop
// ============================================

describe('A8: directive role — silent drop', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    const rac = resolveToRAC('gen-code-sys' as IntentId, {
      refs: [dirRoleArtifact.path],
    }, 'explicit');

    result = await promptBuilder.build(makeCodeExecuteConfig({
      artifacts: [dirRoleArtifact],
      vars: {
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: rac,
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('A8', 'directive role: silent drop', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('Provided Documents section rendered (documents array non-empty)', () => {
    expect(result.sections.injections).toContain(ART_FP.DOCS_SECTION);
  });

  it('DIR_ROLE_MARKER NOT anywhere in injections (role="directive" is silently dropped)', () => {
    // The action-context partial renders only role='ref' and role='context'
    // entries via its two {{#each documents}}{{#if (eq role "...")}} blocks.
    // role='directive' artifacts therefore never reach the prompt; the RAC
    // directive text flows through a separate injection (directive.md).
    expect(result.sections.injections).not.toContain(ART_FP.DIR_ROLE_MARKER);
  });
});

// ============================================
// D1: code execute — directive truthy
// ============================================

describe('D1: code execute — directive truthy', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    result = await promptBuilder.build(makeCodeExecuteConfig({
      vars: {
        directive: ART_FP.DIRECTIVE_MARKER,
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: resolveToRAC('gen-code-sys' as IntentId, {
          refs: ['outputs/design/system/fe-system-main.md'],
        }, 'explicit'),
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('D1', 'code execute: directive truthy', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('Directive header + marker in sections.injections', () => {
    expect(result.sections.injections).toContain(ART_FP.DIRECTIVE_HEADER);
    expect(result.sections.injections).toContain(ART_FP.DIRECTIVE_MARKER);
  });

  it('directive marker NOT in result.user', () => {
    expect(result.user).not.toContain(ART_FP.DIRECTIVE_MARKER);
  });

  it('no duplicate: directive marker exactly once', () => {
    assertExactlyOnce(result.sections.injections + result.user, ART_FP.DIRECTIVE_MARKER, 'DIRECTIVE');
  });

  it('no duplicate injection paths', () => {
    assertNoDuplicateInjectionPaths(result.injections);
  });
});

// ============================================
// D2: code execute — directive empty
// ============================================

describe('D2: code execute — directive empty', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    result = await promptBuilder.build(makeCodeExecuteConfig({
      vars: {
        directive: '',
        currentTask: { id: 't1', type: 'feature', description: 'Test', targetFile: 'src/App.tsx', name: 'task-1', priority: 'high' },
        resolvedAction: resolveToRAC('gen-code-sys' as IntentId, {
          refs: ['outputs/design/system/fe-system-main.md'],
        }, 'explicit'),
        projectFileTree: 'src/\n  index.ts',
      },
    }));

    collectResult('D2', 'code execute: directive empty', 'code/execute/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('Directive header NOT in sections.injections', () => {
    expect(result.sections.injections).not.toContain(ART_FP.DIRECTIVE_HEADER);
  });

  it('directive marker NOT anywhere', () => {
    expect(result.system + result.user).not.toContain(ART_FP.DIRECTIVE_MARKER);
  });
});

// ============================================
// D3: spec — directive via runtimeContext
// ============================================

describe('D3: spec — directive via runtimeContext', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    result = await promptBuilder.build({
      templates: {
        base: 'jobs/design/nodes/execute/variants/spec/base',
        rules: 'jobs/design/nodes/execute/variants/spec/rules',
        system: 'jobs/design/base/system',
      },
      pipeline: {
        sanitizeInput: true,
        applyPolicyGuardrails: false,
      },
      vars: {
        directive: 'Create spec',
        taskDescription: 'Spec for test',
        projectFileTree: 'src/\n  index.ts',
        runtimeContext: `# User Directive\n${ART_FP.DIRECTIVE_MARKER}`,
      },
    });

    collectResult('D3', 'spec: directive via runtimeContext', 'design/spec', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('directive marker in result.user', () => {
    expect(result.user).toContain(ART_FP.DIRECTIVE_MARKER);
  });

  it('directive marker NOT in sections.injections', () => {
    expect(result.sections.injections).not.toContain(ART_FP.DIRECTIVE_MARKER);
  });

  it('no duplicate: directive marker exactly once in user', () => {
    assertExactlyOnce(result.user, ART_FP.DIRECTIVE_MARKER, 'DIRECTIVE in user');
  });
});

// ============================================
// D4: plan — directive in base template
// ============================================

describe('D4: plan — directive in base template', () => {
  let result: PromptBuildResult;

  beforeAll(async () => {
    result = await promptBuilder.build({
      templates: {
        base: 'jobs/plan/nodes/plan/variants/default/base',
        rules: 'jobs/plan/nodes/plan/variants/default/rules',
      },
      intent: 'gen-plan' as IntentId,
      vars: {
        directive: ART_FP.DIRECTIVE_MARKER,
        hasExistingDocument: false,
      },
    });

    collectResult('D4', 'plan: directive in base template', 'plan/default', result);
  });

  it('no templates fail', () => {
    expect(result.sections.failedTemplates).toHaveLength(0);
  });

  it('directive marker in result.user', () => {
    expect(result.user).toContain(ART_FP.DIRECTIVE_MARKER);
  });

  it('directive marker NOT in sections.injections', () => {
    expect(result.sections.injections).not.toContain(ART_FP.DIRECTIVE_MARKER);
  });

  it('no duplicate: directive marker exactly once in user', () => {
    assertExactlyOnce(result.user, ART_FP.DIRECTIVE_MARKER, 'DIRECTIVE in user');
  });
});

// ============================================
// Matrix JSON Output
// ============================================

describe('Injection Matrix', () => {
  it('writes matrix JSON', () => {
    const dir = join(__dirname, '__generated__');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(matrix, null, 2));
    expect(existsSync(OUTPUT_PATH)).toBe(true);
  });

  it('matrix has 12 scenarios', () => {
    expect(Object.keys(matrix).length).toBe(12);
  });

  it('no scenario has duplicate markers (cross-cutting)', () => {
    for (const [key, v] of Object.entries(matrix)) {
      const hasRef = v.refMarkerInInjections || v.refMarkerInUser;
      const hasCtx = v.ctxMarkerInInjections || v.ctxMarkerInUser;
      const hasDir = v.directiveMarkerInInjections || v.directiveMarkerInUser;

      if (hasRef) {
        expect(v.refCountTotal, `${key}: REF duplicated (${v.refCountTotal}x)`).toBe(1);
      }
      if (hasCtx) {
        expect(v.ctxCountTotal, `${key}: CTX duplicated (${v.ctxCountTotal}x)`).toBe(1);
      }
      if (hasDir) {
        expect(v.directiveCountTotal, `${key}: DIRECTIVE duplicated (${v.directiveCountTotal}x)`).toBe(1);
      }
      expect(v.duplicateInjectionPaths, `${key}: duplicate injection paths`).toHaveLength(0);
    }
  });

  it('no scenario has cross-path leak (cross-cutting)', () => {
    for (const [key, v] of Object.entries(matrix)) {
      expect(
        v.refMarkerInInjections && v.refMarkerInUser,
        `${key}: REF leaked to both injections and user`,
      ).toBe(false);
      expect(
        v.ctxMarkerInInjections && v.ctxMarkerInUser,
        `${key}: CTX leaked to both injections and user`,
      ).toBe(false);
      expect(
        v.directiveMarkerInInjections && v.directiveMarkerInUser,
        `${key}: DIRECTIVE leaked to both injections and user`,
      ).toBe(false);
    }
  });

  it('prints injection matrix summary', () => {
    const rows = Object.entries(matrix).map(([key, v]) => ({
      key,
      scenario: v.scenario,
      refInj: v.refMarkerInInjections ?? '-',
      ctxInj: v.ctxMarkerInInjections ?? '-',
      refUsr: v.refMarkerInUser ?? '-',
      ctxUsr: v.ctxMarkerInUser ?? '-',
      dirInj: v.directiveMarkerInInjections ?? '-',
      dirUsr: v.directiveMarkerInUser ?? '-',
      'ref#': v.refCountTotal,
      'ctx#': v.ctxCountTotal,
      'dir#': v.directiveCountTotal,
      dupes: v.duplicateInjectionPaths.length,
      fail: v.failedTemplates,
    }));
    console.table(rows);
  });
});

// ============================================
// System Prompt Duplicate Injection Verification
// ============================================

describe('System Prompt: no duplicate injections', () => {
  it('each injection fingerprint appears exactly once in result.system', () => {
    const failures: string[] = [];

    for (const [key, result] of Object.entries(results)) {
      for (const injPath of result.injections) {
        const fp = INJECTION_FP[injPath];
        if (!fp) continue;

        const count = countOccurrences(result.system, fp);
        if (count !== 1) {
          failures.push(`${key} → ${injPath}: "${fp}" appeared ${count}x in system (expected 1)`);
        }
      }
    }

    expect(failures, failures.join('\n')).toHaveLength(0);
  });

  it('injection fingerprints do not leak to result.user', () => {
    const leaks: string[] = [];

    for (const [key, result] of Object.entries(results)) {
      for (const injPath of result.injections) {
        const fp = INJECTION_FP[injPath];
        if (!fp) continue;

        if (result.user.includes(fp)) {
          leaks.push(`${key} → ${injPath}: "${fp}" found in user prompt`);
        }
      }
    }

    expect(leaks, leaks.join('\n')).toHaveLength(0);
  });

  it('sections do not duplicate each other (systemBase vs injections vs rules)', () => {
    const overlaps: string[] = [];

    for (const [key, result] of Object.entries(results)) {
      const { systemBase, injections, rules } = result.sections;
      if (!systemBase || !injections) continue;

      for (const injPath of result.injections) {
        const fp = INJECTION_FP[injPath];
        if (!fp) continue;

        if (systemBase.includes(fp)) {
          overlaps.push(`${key}: "${fp}" in both systemBase and injections`);
        }
        if (rules.includes(fp)) {
          overlaps.push(`${key}: "${fp}" in both rules and injections`);
        }
      }
    }

    expect(overlaps, overlaps.join('\n')).toHaveLength(0);
  });

  it('system prompt length equals sum of non-empty sections', () => {
    for (const [key, result] of Object.entries(results)) {
      const { systemBase, profiles, rules, injections, examples, guardrail, policy } = result.sections;
      const parts = [systemBase, profiles, rules, injections, examples].filter(Boolean);
      if (guardrail) parts.unshift(guardrail);
      if (policy) parts.push(policy);

      const expectedLength = parts.join('\n\n').length;
      expect(
        result.system.length,
        `${key}: system length ${result.system.length} ≠ parts sum ${expectedLength}`,
      ).toBe(expectedLength);
    }
  });
});
