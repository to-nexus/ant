/**
 * Tech Tier Registry ↔ Template Sync Tests
 *
 * Verifies bidirectional consistency:
 *   1. Every registry entry has a corresponding template file
 *   2. Every template file is accounted for in the registry
 *   3. VALID_STACKS_BY_LANGUAGE ↔ LANGUAGE_VARIANT_MAP consistency
 *   4. Job-scoped paths exist for code/design jobs
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_FRAMEWORKS,
  SUPPORTED_STACKS,
  LANGUAGE_VARIANT_MAP,
  VALID_STACKS_BY_LANGUAGE,
  VALID_LANGUAGES_BY_STACK,
  TECH_TIER_TEMPLATE_PATHS,
  TECH_TIER_CONSTRAINTS,
  FRAMEWORK_LABELS,
  resolveLanguageVariants,
  isValidLanguageStackCombo,
  getValidLanguages,
  getValidFrameworks,
  getFrameworkOptions,
  getFullstackLanguages,
  VISUAL_TIER_TEMPLATE_PATHS,
  VISUAL_TIER_LAYER_KEYS,
  VISUAL_LANGUAGE_VARIANTS,
  SURFACE_SYSTEM_VARIANTS,
  SPATIAL_SYSTEM_VARIANTS,
  INTERACTION_GRAMMAR_VARIANTS,
  COMPONENT_SEMANTICS_VARIANTS,
  VISUAL_HIERARCHY_RULES_VARIANTS,
  VISUAL_LANGUAGE_OPTIONS,
  SURFACE_SYSTEM_OPTIONS,
  SPATIAL_SYSTEM_OPTIONS,
  INTERACTION_GRAMMAR_OPTIONS,
  COMPONENT_SEMANTICS_OPTIONS,
  VISUAL_HIERARCHY_RULES_OPTIONS,
  deriveInteractionGrammar,
  deriveVisualHierarchyRules,
  deriveComponentSemantics,
  type LanguageVariant,
  type SupportedLanguage,
  type SupportedStack,
  type TechTierKey,
} from '@ant/shared';

const TEMPLATES_ROOT = path.resolve(
  __dirname,
  '../src/core/prompt/templates',
);

function templateExists(templatePath: string): boolean {
  const fullPath = path.join(TEMPLATES_ROOT, `${templatePath}.md`);
  return fs.existsSync(fullPath);
}

// ============================================
// Registry → Template File (forward check)
// ============================================

describe('Registry → Template files exist', () => {
  it('_typescript-common partial exists', () => {
    expect(templateExists('basis/techTier/language/_typescript-common')).toBe(true);
  });

  it('root go.md language base exists', () => {
    expect(templateExists('basis/techTier/language/go')).toBe(true);
  });

  it.each([...SUPPORTED_STACKS])('stack "%s" has template file (may be skeleton)', (stack) => {
    const tmplPath = TECH_TIER_TEMPLATE_PATHS.stack(stack);
    expect(templateExists(tmplPath)).toBe(true);
  });
});

// ============================================
// Job-scoped: code job templates exist
// ============================================

describe('Job-scoped: code job templates exist', () => {
  const allVariants: LanguageVariant[] = ['typescript-browser', 'typescript-node', 'go'];

  it.each(allVariants)('code job language variant "%s" has template file', (variant) => {
    const tmplPath = TECH_TIER_TEMPLATE_PATHS.jobLanguageVariant('code', variant);
    expect(templateExists(tmplPath)).toBe(true);
  });

  const allFrameworks = Object.values(SUPPORTED_FRAMEWORKS).flat();

  it.each(allFrameworks)('code job framework "%s" has template file', (fw) => {
    const tmplPath = TECH_TIER_TEMPLATE_PATHS.jobFramework('code', fw);
    expect(templateExists(tmplPath)).toBe(true);
  });
});

// ============================================
// Job-scoped: design job templates exist
// ============================================

describe('Job-scoped: design job templates exist', () => {
  it('design job framework nextjs exists', () => {
    expect(templateExists(TECH_TIER_TEMPLATE_PATHS.jobFramework('design', 'nextjs'))).toBe(true);
  });

  it('design job framework go exists', () => {
    expect(templateExists(TECH_TIER_TEMPLATE_PATHS.jobFramework('design', 'go'))).toBe(true);
  });

  it('design job domain game exists', () => {
    expect(templateExists(TECH_TIER_TEMPLATE_PATHS.jobDomain('design', 'game'))).toBe(true);
  });

  it('design job domain service exists', () => {
    expect(templateExists(TECH_TIER_TEMPLATE_PATHS.jobDomain('design', 'service'))).toBe(true);
  });
});

// ============================================
// Template File → Registry (reverse orphan check)
// ============================================

describe('Template files → Registry (no orphans)', () => {
  it('every code job language variant template is in LANGUAGE_VARIANT_MAP', () => {
    const langDir = path.join(TEMPLATES_ROOT, 'jobs/code/basis/techTier/language');
    const files = fs.readdirSync(langDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    const registryVariants = new Set<string>();
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const stack of SUPPORTED_STACKS) {
        const variants = resolveLanguageVariants(lang, stack);
        for (const v of variants) registryVariants.add(v);
      }
    }

    for (const file of files) {
      const variant = file.replace('.md', '');
      expect(registryVariants.has(variant)).toBe(true);
    }
  });

  it('every code job framework template is in SUPPORTED_FRAMEWORKS', () => {
    const fwDir = path.join(TEMPLATES_ROOT, 'jobs/code/basis/techTier/framework');
    const files = fs.readdirSync(fwDir).filter(f => f.endsWith('.md'));
    const allFws = new Set(Object.values(SUPPORTED_FRAMEWORKS).flat());

    for (const file of files) {
      const fw = file.replace('.md', '');
      expect(allFws.has(fw)).toBe(true);
    }
  });
});

// ============================================
// Validity Matrix Consistency
// ============================================

describe('VALID_STACKS_BY_LANGUAGE ↔ LANGUAGE_VARIANT_MAP consistency', () => {
  it('every valid (language, stack) combo has variant mapping', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const validStacks = VALID_STACKS_BY_LANGUAGE[lang];
      for (const stack of validStacks) {
        const variants = resolveLanguageVariants(lang, stack);
        expect(variants.length).toBeGreaterThan(0);
      }
    }
  });

  it('LANGUAGE_VARIANT_MAP only contains valid stacks', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const variantMap = LANGUAGE_VARIANT_MAP[lang];
      const validStacks = new Set(VALID_STACKS_BY_LANGUAGE[lang]);
      for (const stack of Object.keys(variantMap)) {
        expect(validStacks.has(stack as SupportedStack)).toBe(true);
      }
    }
  });

  it('go + frontend is invalid', () => {
    expect(isValidLanguageStackCombo('go', 'frontend')).toBe(false);
  });

  it('go + fullstack is invalid', () => {
    expect(isValidLanguageStackCombo('go', 'fullstack')).toBe(false);
  });

  it('typescript + all stacks are valid', () => {
    for (const stack of SUPPORTED_STACKS) {
      expect(isValidLanguageStackCombo('typescript', stack)).toBe(true);
    }
  });
});

// ============================================
// resolveLanguageVariants edge cases
// ============================================

describe('resolveLanguageVariants', () => {
  it('typescript + frontend → typescript-browser', () => {
    expect(resolveLanguageVariants('typescript', 'frontend')).toEqual(['typescript-browser']);
  });

  it('typescript + backend → typescript-node', () => {
    expect(resolveLanguageVariants('typescript', 'backend')).toEqual(['typescript-node']);
  });

  it('typescript + fullstack → both variants', () => {
    expect(resolveLanguageVariants('typescript', 'fullstack')).toEqual([
      'typescript-browser',
      'typescript-node',
    ]);
  });

  it('go + backend → go', () => {
    expect(resolveLanguageVariants('go', 'backend')).toEqual(['go']);
  });

  it('go without stack → go', () => {
    expect(resolveLanguageVariants('go')).toEqual(['go']);
  });

  it('typescript without stack → typescript-browser (default)', () => {
    expect(resolveLanguageVariants('typescript')).toEqual(['typescript-browser']);
  });

  it('go + frontend (invalid combo) → falls back to go', () => {
    expect(resolveLanguageVariants('go', 'frontend')).toEqual(['go']);
  });
});

// ============================================
// TECH_TIER_CONSTRAINTS — SSOT validation
// ============================================

describe('TECH_TIER_CONSTRAINTS SSOT', () => {
  it('FRAMEWORK_LABELS covers every framework in TECH_TIER_CONSTRAINTS', () => {
    for (const [, tier] of Object.entries(TECH_TIER_CONSTRAINTS)) {
      for (const fws of Object.values(tier.frameworks)) {
        for (const fw of fws!) {
          expect(FRAMEWORK_LABELS[fw]).toBeDefined();
        }
      }
    }
  });

  it('VALID_LANGUAGES_BY_STACK ↔ VALID_STACKS_BY_LANGUAGE symmetry', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const stack of VALID_STACKS_BY_LANGUAGE[lang]) {
        expect((VALID_LANGUAGES_BY_STACK[stack] as readonly string[]).includes(lang)).toBe(true);
      }
    }
    for (const stack of SUPPORTED_STACKS) {
      for (const lang of VALID_LANGUAGES_BY_STACK[stack]) {
        expect((VALID_STACKS_BY_LANGUAGE[lang] as readonly string[]).includes(stack)).toBe(true);
      }
    }
  });

  it('getFullstackLanguages returns intersection of FE ∩ BE', () => {
    const fullstackLangs = getFullstackLanguages();
    expect(fullstackLangs).toContain('typescript');
    expect(fullstackLangs).not.toContain('go');
    expect(fullstackLangs).toEqual(VALID_LANGUAGES_BY_STACK.fullstack);
  });
});

// ============================================
// Derived helpers
// ============================================

describe('getValidLanguages', () => {
  it('frontend → typescript only', () => {
    expect(getValidLanguages('frontend')).toEqual(['typescript']);
  });

  it('backend → typescript, go', () => {
    expect(getValidLanguages('backend')).toEqual(['typescript', 'go']);
  });
});

describe('getValidFrameworks', () => {
  it('frontend + typescript → react, nextjs, react-native', () => {
    expect(getValidFrameworks('frontend', 'typescript')).toEqual(['react', 'nextjs', 'react-native']);
  });

  it('backend + go → gin', () => {
    expect(getValidFrameworks('backend', 'go')).toEqual(['gin']);
  });

  it('backend + typescript → nestjs', () => {
    expect(getValidFrameworks('backend', 'typescript')).toEqual(['nestjs']);
  });

  it('invalid combo returns empty', () => {
    expect(getValidFrameworks('frontend', 'go')).toEqual([]);
  });
});

describe('getFrameworkOptions', () => {
  it('returns BasisOption[] with labels', () => {
    const opts = getFrameworkOptions('frontend', 'typescript');
    expect(opts).toHaveLength(3);
    expect(opts[0].id).toBe('react');
    expect(opts[0].label.en).toBe('React');
  });

  it('backend go returns gin option', () => {
    const opts = getFrameworkOptions('backend', 'go');
    expect(opts).toHaveLength(1);
    expect(opts[0].id).toBe('gin');
  });
});

// ============================================
// VisualTier Registry — Forward check (registry → files)
// ============================================

describe('VisualTier: Registry → Template files exist', () => {
  it('shared preamble exists', () => {
    expect(templateExists(VISUAL_TIER_TEMPLATE_PATHS.preamble())).toBe(true);
  });

  const VARIANT_MAP: Record<string, readonly string[]> = {
    visualLanguage: VISUAL_LANGUAGE_VARIANTS,
    surfaceSystem: SURFACE_SYSTEM_VARIANTS,
    spatialSystem: SPATIAL_SYSTEM_VARIANTS,
    interactionGrammar: INTERACTION_GRAMMAR_VARIANTS,
    componentSemantics: COMPONENT_SEMANTICS_VARIANTS,
    visualHierarchyRules: VISUAL_HIERARCHY_RULES_VARIANTS,
  };

  for (const [layer, variants] of Object.entries(VARIANT_MAP)) {
    describe(`layer: ${layer}`, () => {
      const pathFn = VISUAL_TIER_TEMPLATE_PATHS[layer as keyof typeof VARIANT_MAP];
      it.each([...variants])(`variant "%s" has template file`, (variant) => {
        expect(templateExists((pathFn as (v: string) => string)(variant))).toBe(true);
      });
    });
  }

  it.each(['code', 'design'])('job "%s" visualTier preamble exists', (job) => {
    expect(templateExists(VISUAL_TIER_TEMPLATE_PATHS.jobPreamble(job))).toBe(true);
  });
});

// ============================================
// VisualTier: Template files → Registry (reverse orphan check)
// ============================================

describe('VisualTier: Template files → Registry (no orphans)', () => {
  const registryPaths = new Set<string>();

  // Collect all paths the registry can generate
  registryPaths.add(VISUAL_TIER_TEMPLATE_PATHS.preamble());
  for (const [layer, variants] of Object.entries({
    visualLanguage: VISUAL_LANGUAGE_VARIANTS,
    surfaceSystem: SURFACE_SYSTEM_VARIANTS,
    spatialSystem: SPATIAL_SYSTEM_VARIANTS,
    interactionGrammar: INTERACTION_GRAMMAR_VARIANTS,
    componentSemantics: COMPONENT_SEMANTICS_VARIANTS,
    visualHierarchyRules: VISUAL_HIERARCHY_RULES_VARIANTS,
  })) {
    const pathFn = VISUAL_TIER_TEMPLATE_PATHS[layer as keyof typeof VISUAL_TIER_TEMPLATE_PATHS];
    if (typeof pathFn === 'function') {
      for (const v of variants) {
        registryPaths.add((pathFn as (v: string) => string)(v));
      }
    }
  }
  for (const job of ['code', 'design']) {
    registryPaths.add(VISUAL_TIER_TEMPLATE_PATHS.jobPreamble(job));
  }

  it('every basis/visualTier/ template file is in registry', () => {
    const vtDir = path.join(TEMPLATES_ROOT, 'basis/visualTier');
    const files = collectMdFiles(vtDir);
    for (const file of files) {
      const rel = path.relative(TEMPLATES_ROOT, file).replace(/\.md$/, '').replace(/\\/g, '/');
      expect(registryPaths.has(rel)).toBe(true);
    }
  });

  it('every jobs/*/basis/visualTier/ template file is in registry', () => {
    for (const job of ['code', 'design']) {
      const jobVtDir = path.join(TEMPLATES_ROOT, `jobs/${job}/basis/visualTier`);
      if (!fs.existsSync(jobVtDir)) continue;
      const files = collectMdFiles(jobVtDir);
      for (const file of files) {
        const rel = path.relative(TEMPLATES_ROOT, file).replace(/\.md$/, '').replace(/\\/g, '/');
        expect(registryPaths.has(rel)).toBe(true);
      }
    }
  });
});

function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// ============================================
// VisualTier: Options arrays match variant constants
// ============================================

describe('VisualTier: Options ↔ Variants consistency', () => {
  const PAIRS: [string, readonly string[], { id: string }[]][] = [
    ['visualLanguage', VISUAL_LANGUAGE_VARIANTS, VISUAL_LANGUAGE_OPTIONS],
    ['surfaceSystem', SURFACE_SYSTEM_VARIANTS, SURFACE_SYSTEM_OPTIONS],
    ['spatialSystem', SPATIAL_SYSTEM_VARIANTS, SPATIAL_SYSTEM_OPTIONS],
    ['interactionGrammar', INTERACTION_GRAMMAR_VARIANTS, INTERACTION_GRAMMAR_OPTIONS],
    ['componentSemantics', COMPONENT_SEMANTICS_VARIANTS, COMPONENT_SEMANTICS_OPTIONS],
    ['visualHierarchyRules', VISUAL_HIERARCHY_RULES_VARIANTS, VISUAL_HIERARCHY_RULES_OPTIONS],
  ];

  it.each(PAIRS)('%s: OPTIONS ids match VARIANTS', (layer, variants, options) => {
    const optionIds = options.map(o => o.id);
    expect(optionIds).toEqual([...variants]);
  });

  it('VISUAL_TIER_LAYER_KEYS covers all 6 layers', () => {
    expect(VISUAL_TIER_LAYER_KEYS).toHaveLength(6);
    expect(VISUAL_TIER_LAYER_KEYS).toContain('visualLanguage');
    expect(VISUAL_TIER_LAYER_KEYS).toContain('visualHierarchyRules');
  });
});

// ============================================
// VisualTier: Derive functions
// ============================================

describe('VisualTier: Derive functions', () => {
  it('deriveInteractionGrammar covers all visualLanguage variants', () => {
    for (const vl of VISUAL_LANGUAGE_VARIANTS) {
      const result = deriveInteractionGrammar(vl);
      expect(INTERACTION_GRAMMAR_VARIANTS).toContain(result);
    }
  });

  it('deriveVisualHierarchyRules covers all combinations', () => {
    for (const vl of VISUAL_LANGUAGE_VARIANTS) {
      for (const ss of SPATIAL_SYSTEM_VARIANTS) {
        const result = deriveVisualHierarchyRules(vl, ss);
        expect(VISUAL_HIERARCHY_RULES_VARIANTS).toContain(result);
      }
    }
  });

  it('deriveComponentSemantics returns valid variant for known keywords', () => {
    expect(COMPONENT_SEMANTICS_VARIANTS).toContain(deriveComponentSemantics('dashboard'));
    expect(COMPONENT_SEMANTICS_VARIANTS).toContain(deriveComponentSemantics('settings'));
    expect(COMPONENT_SEMANTICS_VARIANTS).toContain(deriveComponentSemantics('catalog'));
    expect(COMPONENT_SEMANTICS_VARIANTS).toContain(deriveComponentSemantics('onboarding'));
  });

  it('deriveComponentSemantics returns fallback for unknown context', () => {
    const result = deriveComponentSemantics('unknownxyz');
    expect(COMPONENT_SEMANTICS_VARIANTS).toContain(result);
  });
});
