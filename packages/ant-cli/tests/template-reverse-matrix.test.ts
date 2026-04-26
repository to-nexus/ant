/**
 * Template Reverse Coverage Matrix
 *
 * For every .md template file under prompt/templates/, verifies that at least
 * one production code path can reach it. Reachability sources:
 *
 *   (a) build() call-site hardcoded paths (templates.base / rules / system)
 *   (b) AutoInjectionResolver.resolve() combinatorial sweep
 *   (c) POLICY_TEMPLATE_MAP values
 *   (d) render() direct calls from agent TS source
 *   (e) {{> partial}} references from other templates
 *   (f) buildBasisSection via TECH_TIER_TEMPLATE_PATHS + VISUAL_TIER_TEMPLATE_PATHS
 *
 * Outputs a JSON matrix to tests/__generated__/template-matrix.json.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  POLICY_TEMPLATE_MAP,
  TECH_TIER_TEMPLATE_PATHS,
  VISUAL_TIER_TEMPLATE_PATHS,
  VISUAL_TIER_LAYER_KEYS,
  VISUAL_LANGUAGE_VARIANTS,
  SURFACE_SYSTEM_VARIANTS,
  SPATIAL_SYSTEM_VARIANTS,
  INTERACTION_GRAMMAR_VARIANTS,
  COMPONENT_SEMANTICS_VARIANTS,
  VISUAL_HIERARCHY_RULES_VARIANTS,
  SUPPORTED_LANGUAGES,
  SUPPORTED_STACKS,
  SUPPORTED_FRAMEWORKS,
  LANGUAGE_VARIANT_MAP,
  resolveLanguageVariants,
  FRAMEWORK_NONE,
  GAME_ART_TIER_TEMPLATE_PATHS,
  GAME_ART_TIER_AXIS_KEYS,
  GAME_ART_CONCEPT_VARIANTS,
  GAME_ART_PERSPECTIVE_VARIANTS,
  GAME_ART_ENTITY_CATALOG_VARIANTS,
  GAME_ART_MOTION_PATTERN_VARIANTS,
  GAME_ART_PARTICLE_PROFILE_VARIANTS,
  GAME_ART_PROJECTILE_POLICY_VARIANTS,
  GAME_ART_AUDIO_PROFILE_VARIANTS,
  GAME_CONTENT_TIER_TEMPLATE_PATHS,
  GAME_GENRE_VARIANTS,
  GAME_CORE_LOOP_VARIANTS,
  SUPPORTED_GAME_ENGINES,
} from '@ant/shared';
import type { SupportedLanguage, SupportedStack, LanguageVariant } from '@ant/shared';
import { AutoInjectionResolver } from '../src/core/prompt/builder/AutoInjectionResolver';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
const AGENT_SRC_DIRS = [
  join(__dirname, '../src/agents'),
  join(__dirname, '../src/core/prompt/builder'),
  join(__dirname, '../src/core/context'),
  join(__dirname, '../src/core/config'),
];
const OUTPUT_PATH = join(__dirname, '__generated__/template-matrix.json');

// ============================================
// Collectors
// ============================================

async function collectAllTemplates(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...await collectAllTemplates(join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      result.push(rel.replace(/\.md$/, ''));
    }
  }
  return result;
}

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import('fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...await collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ============================================
// Source (a): build() call-site hardcoded paths
// ============================================

function collectBuildCallSitePaths(tsFiles: string[]): Set<string> {
  const paths = new Set<string>();
  for (const file of tsFiles) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    for (const line of lines) {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

      // templates: { base: 'path', rules: 'path', system: 'path' }
      const propPattern = /(?:base|rules|system):\s*['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = propPattern.exec(line)) !== null) {
        if (m[1].startsWith('jobs/') || m[1].startsWith('infra/') || m[1].startsWith('agents/')) {
          paths.add(m[1]);
        }
      }
    }
  }
  return paths;
}

// ============================================
// Source (b): AutoInjectionResolver combinatorial
// ============================================

function collectAutoInjectionPaths(): Set<string> {
  const resolver = new AutoInjectionResolver();
  const paths = new Set<string>();

  const JOBS = ['code', 'design'] as const;
  const NODES = ['plan', 'execute'] as const;
  const TASK_TYPES = [
    'setup', 'feature', 'ui', 'design-system', 'test-code',
    'error', 'verification', 'explain', 'doc', undefined,
  ] as const;
  const MODES = ['generate', 'refactor', 'explain', undefined] as const;
  const LANGUAGES: SupportedLanguage[] = ['typescript', 'go'];
  const STACKS: (SupportedStack | undefined)[] = ['frontend', 'backend', 'fullstack', undefined];

  const DATA_COMBOS = [
    {},
    { hasDirective: true },
    { hasMemory: true },
    { hasGitDiff: true },
    { hasRetrievedCode: true },
    { hasReferenceCode: true },
    { hasProjectCode: true },
    { hasRetryContext: true },
    { hasLessons: true },
    { hasSessionContext: true },
    { hasMissingDependency: true },
    { hasRuntimeError: true },
  ] as const;

  for (const job of JOBS) {
    for (const node of NODES) {
      for (const taskType of TASK_TYPES) {
        for (const mode of MODES) {
          for (const lang of LANGUAGES) {
            for (const stack of STACKS) {
              for (const data of DATA_COMBOS) {
                const result = resolver.resolve({
                  job,
                  node,
                  taskType,
                  mode: mode as any,
                  techTiers: stack ? [{ language: lang, stack }] : [],
                  techTier: stack ? { language: lang, stack } : undefined,
                  data: { ...data } as any,
                  resolvedAction: mode === 'refactor'
                    ? { source: 'explicit' as const, mode: 'refactor' as const, hasExplicitFields: true, tech: {} } as any
                    : mode === 'explain'
                      ? { source: 'infer' as const, mode: 'explain' as const, hasExplicitFields: false, tech: {} } as any
                      : undefined,
                });
                for (const p of result) paths.add(p);
              }
            }
          }
        }
      }
    }
  }
  return paths;
}

// ============================================
// Source (c): POLICY_TEMPLATE_MAP
// ============================================

function collectPolicyTemplatePaths(): Set<string> {
  return new Set(Object.values(POLICY_TEMPLATE_MAP));
}

// ============================================
// Source (d): render() / readFileSync / template literal paths
// ============================================

const TEMPLATE_VAR_EXPANSIONS: Record<string, string[]> = {
  /** `artDesignDecompose`: `jobs/design/nodes/decompose/variants/art-design-${variant}/base` */
  variant: ['by-figma', 'by-desc'],
  logSuffix: ['by-figma', 'by-desc'],
  templateSuffix: ['by-figma', 'by-desc'],
  freshLogSuffix: ['by-figma', 'by-desc'],
  job: ['code', 'design'],
  'mapLang(techTier.language)': ['typescript', 'go'],
  'mapLang(lang)': ['typescript', 'go'],
  language: ['typescript', 'go'],
  lang: ['typescript', 'go'],
  fallbackLanguage: ['typescript', 'go'],
  primaryLang: ['typescript', 'go'],
  'tool.name': ['run_command'],
};

function collectRenderCallPaths(tsFiles: string[]): Set<string> {
  const paths = new Set<string>();

  // Phase 1: collect const variable assignments that hold template path prefixes
  const constPrefixes: Record<string, string> = {};

  for (const file of tsFiles) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    // Collect const vars with template-like paths
    for (const line of lines) {
      const constMatch = /(?:const|let)\s+(\w+)\s*=\s*['"]((jobs|infra|agents|basis)\/[^'"]+)['"]/;
      const m = constMatch.exec(line);
      if (m) constPrefixes[m[1]] = m[2];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

      // Pattern 1: render('literal') or render("literal")
      const renderLiteral = /\.render\(\s*['"]([^'"]+)['"]/g;
      let m2: RegExpExecArray | null;
      while ((m2 = renderLiteral.exec(line)) !== null) {
        if (m2[1].startsWith('jobs/') || m2[1].startsWith('infra/') || m2[1].startsWith('agents/')) {
          paths.add(m2[1]);
        }
      }

      // Pattern 2: render(`template ${var}`)
      const renderTemplate = /\.render\(\s*`([^`]+)`/g;
      while ((m2 = renderTemplate.exec(line)) !== null) {
        expandAndAdd(m2[1], paths, constPrefixes);
      }

      // Pattern 3: = `${constVar}/...` (template literal path assignment)
      const assignTemplate = /=\s*`(\$\{[\w]+\}\/[^`]+)`/g;
      while ((m2 = assignTemplate.exec(line)) !== null) {
        expandAndAdd(m2[1], paths, constPrefixes);
      }

      // Pattern 4: readFileSync / getPromptTemplatePath with 'jobs/...' paths
      const fileReadPattern = /(?:readFileSync|getPromptTemplatePath|readFile)\(\s*(?:.*?)['"]((jobs|basis|agents|infra)\/[^'"]+)(?:\.md)?['"]/g;
      while ((m2 = fileReadPattern.exec(line)) !== null) {
        paths.add(m2[1].replace(/\.md$/, ''));
      }

      // Pattern 5: quoted string containing a template-like path (broad catch-all)
      const quotedPathPattern = /['"]((jobs|basis|agents|infra)\/[\w/\-]+?)(?:\.md)?['"]/g;
      while ((m2 = quotedPathPattern.exec(line)) !== null) {
        const candidate = m2[1].replace(/\.md$/, '');
        if (!candidate.includes('.') || candidate.endsWith('.md')) {
          paths.add(candidate.replace(/\.md$/, ''));
        }
      }

      // Pattern 6: backtick template literal with template path (may contain ${...})
      const backtickPattern = /`((?:jobs|basis|agents|infra)\/[^`]+)`/g;
      while ((m2 = backtickPattern.exec(line)) !== null) {
        expandAndAdd(m2[1].replace(/\.md$/, ''), paths, constPrefixes);
      }

      // Pattern 7: backtick template starting with ${constVar} that resolves to a template path
      const varStartBacktick = /`(\$\{(\w+)\}[^`]+)`/g;
      while ((m2 = varStartBacktick.exec(line)) !== null) {
        expandAndAdd(m2[1], paths, constPrefixes);
      }
    }
  }

  // Phase 3: detect path.join(dirVar, 'file.md') and resolve to full paths.
  // When a TS file stores a template directory in a variable and later joins sub-filenames,
  // we expand the directory into the known sub-files.
  for (const file of tsFiles) {
    const source = readFileSync(file, 'utf8');

    // Step 1: find variable assignments where the value contains a template directory path
    const varDirMap: Record<string, string> = {};
    const varAssignPattern = /(?:const|let)\s+(\w+)\s*=\s*[^;\n]*['"]((jobs|basis|agents|infra)\/[^'"]+)['"]/g;
    let dm: RegExpExecArray | null;
    while ((dm = varAssignPattern.exec(source)) !== null) {
      varDirMap[dm[1]] = dm[2];
    }

    // Step 2: find path.join(varName, 'file.md') and expand
    const SUB_FILES = ['base', 'rules', 'system'];
    for (const [varName, dirPath] of Object.entries(varDirMap)) {
      for (const sub of SUB_FILES) {
        if (source.includes(`${varName}, '${sub}.md'`) || source.includes(`${varName}, "${sub}.md"`)) {
          paths.add(`${dirPath}/${sub}`);
        }
      }
    }
  }

  return paths;
}

function expandAndAdd(tmpl: string, paths: Set<string>, constPrefixes: Record<string, string>): void {
  // Replace known const prefixes first
  let expanded = tmpl;
  for (const [varName, value] of Object.entries(constPrefixes)) {
    expanded = expanded.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), value);
  }

  if (!expanded.startsWith('jobs/') && !expanded.startsWith('infra/') && !expanded.startsWith('agents/') && !expanded.startsWith('basis/')) {
    return;
  }

  if (!expanded.includes('${')) {
    paths.add(expanded);
    return;
  }

  const results = expandVars(expanded, TEMPLATE_VAR_EXPANSIONS);
  for (const p of results) paths.add(p);
}

function expandVars(tmpl: string, expansions: Record<string, string[]>): string[] {
  if (!tmpl.includes('${')) return [tmpl];
  const varPattern = /\$\{([^}]+)\}/;
  const match = varPattern.exec(tmpl);
  if (!match) return [tmpl];

  const varExpr = match[1].trim();
  const key = Object.keys(expansions).find(k => varExpr.includes(k));
  if (!key) return [];

  const results: string[] = [];
  for (const v of expansions[key]) {
    const replaced = tmpl.replace(match[0], v);
    results.push(...expandVars(replaced, expansions));
  }
  return results;
}

// ============================================
// Source (e): {{> partial}} references
// ============================================

async function collectPartialRefs(): Promise<Set<string>> {
  const paths = new Set<string>();
  const allTemplates = await collectAllTemplates(TEMPLATES_DIR);
  for (const name of allTemplates) {
    const filePath = join(TEMPLATES_DIR, `${name}.md`);
    const content = readFileSync(filePath, 'utf8');
    const pattern = /\{\{>\s*([\w/\-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      paths.add(m[1]);
    }
  }
  return paths;
}

// ============================================
// Source (f): buildBasisSection — TECH_TIER_TEMPLATE_PATHS + VISUAL_TIER_TEMPLATE_PATHS
// ============================================

function collectBasisPaths(): Set<string> {
  const paths = new Set<string>();

  // ── TechTier paths ──

  // Stack templates
  for (const stack of SUPPORTED_STACKS) {
    paths.add(TECH_TIER_TEMPLATE_PATHS.stack(stack));
  }

  // Language base templates
  for (const lang of SUPPORTED_LANGUAGES) {
    const base = TECH_TIER_TEMPLATE_PATHS.languageBase(lang);
    if (base) paths.add(base);
  }

  // Language variant templates (per job)
  const JOBS = ['code', 'design'];
  for (const job of JOBS) {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const stack of SUPPORTED_STACKS) {
        const variants = resolveLanguageVariants(lang, stack);
        for (const variant of variants) {
          paths.add(TECH_TIER_TEMPLATE_PATHS.jobLanguageVariant(job, variant));
        }
      }
    }

    // Framework templates
    for (const [variant, frameworks] of Object.entries(SUPPORTED_FRAMEWORKS)) {
      for (const fw of frameworks) {
        paths.add(TECH_TIER_TEMPLATE_PATHS.jobFramework(job, fw));
      }
    }

    // Domain templates
    for (const domain of ['game', 'service']) {
      paths.add(TECH_TIER_TEMPLATE_PATHS.jobDomain(job, domain));
    }
  }

  // D27 (v6): domain identity lives at `templates/domain/{d}.md` (above
  // basis, since domain is the workspace selector, not a tier).
  for (const domain of ['game', 'service']) {
    paths.add(TECH_TIER_TEMPLATE_PATHS.basisDomain(domain));
  }

  // Setup templates (pushed by AutoInjectionResolver, also buildBasisSection for some paths)
  for (const lang of SUPPORTED_LANGUAGES) {
    paths.add(TECH_TIER_TEMPLATE_PATHS.setup(lang, 'config'));
    paths.add(TECH_TIER_TEMPLATE_PATHS.setup(lang, 'constraints'));
  }

  // ── VisualTier paths ──

  // Shared preamble
  paths.add(VISUAL_TIER_TEMPLATE_PATHS.preamble());

  // 6-layer variant templates
  const VARIANT_MAP: Record<string, readonly string[]> = {
    visualLanguage: VISUAL_LANGUAGE_VARIANTS,
    surfaceSystem: SURFACE_SYSTEM_VARIANTS,
    spatialSystem: SPATIAL_SYSTEM_VARIANTS,
    interactionGrammar: INTERACTION_GRAMMAR_VARIANTS,
    componentSemantics: COMPONENT_SEMANTICS_VARIANTS,
    visualHierarchyRules: VISUAL_HIERARCHY_RULES_VARIANTS,
  };
  for (const [layer, variants] of Object.entries(VARIANT_MAP)) {
    const pathFn = VISUAL_TIER_TEMPLATE_PATHS[layer as keyof typeof VARIANT_MAP];
    if (typeof pathFn === 'function') {
      for (const v of variants) {
        paths.add((pathFn as (v: string) => string)(v));
      }
    }
  }

  // Job-specific visualTier preambles
  for (const job of JOBS) {
    paths.add(VISUAL_TIER_TEMPLATE_PATHS.jobPreamble(job));
  }

  // ── GameArtTier paths (Phase 2 — D12-revised) ──
  paths.add(GAME_ART_TIER_TEMPLATE_PATHS.preamble());
  const GAME_ART_VARIANT_MAP: Record<string, readonly string[]> = {
    concept: GAME_ART_CONCEPT_VARIANTS,
    perspective: GAME_ART_PERSPECTIVE_VARIANTS,
    entityCatalog: GAME_ART_ENTITY_CATALOG_VARIANTS,
    motionPattern: GAME_ART_MOTION_PATTERN_VARIANTS,
    particleProfile: GAME_ART_PARTICLE_PROFILE_VARIANTS,
    projectilePolicy: GAME_ART_PROJECTILE_POLICY_VARIANTS,
    audioProfile: GAME_ART_AUDIO_PROFILE_VARIANTS,
  };
  for (const axis of GAME_ART_TIER_AXIS_KEYS) {
    const pathFn = GAME_ART_TIER_TEMPLATE_PATHS[axis as keyof typeof GAME_ART_TIER_TEMPLATE_PATHS];
    if (typeof pathFn === 'function') {
      for (const v of GAME_ART_VARIANT_MAP[axis]) {
        paths.add((pathFn as (v: string) => string)(v));
      }
    }
  }
  // Job-specific gameArtTier preambles (code + design, matching the renderer dispatch).
  for (const job of ['code', 'design']) {
    paths.add(GAME_ART_TIER_TEMPLATE_PATHS.jobPreamble(job));
  }

  // ── GameContentTier paths (Phase 1) ──
  paths.add(GAME_CONTENT_TIER_TEMPLATE_PATHS.preamble());
  for (const g of GAME_GENRE_VARIANTS) {
    paths.add(GAME_CONTENT_TIER_TEMPLATE_PATHS.genre(g));
  }
  for (const c of GAME_CORE_LOOP_VARIANTS) {
    paths.add(GAME_CONTENT_TIER_TEMPLATE_PATHS.coreLoop(c));
  }
  for (const job of ['plan', 'code', 'design']) {
    paths.add(GAME_CONTENT_TIER_TEMPLATE_PATHS.jobPreamble(job));
  }

  // ── GameEngine paths (Phase 1, game domain only) ──
  paths.add(TECH_TIER_TEMPLATE_PATHS.gameEnginePreamble());
  for (const engine of SUPPORTED_GAME_ENGINES) {
    paths.add(TECH_TIER_TEMPLATE_PATHS.gameEngine(engine));
    // Job-overlay only for code in Phase 1; phaser is the only Phase 2 body.
    paths.add(TECH_TIER_TEMPLATE_PATHS.jobGameEngine('code', engine));
  }

  // ── Plan job domain overlay (Phase 1 F-1 + D27 v6) ──
  // jobs/plan/domain/{game,service}.md is reachable via
  // PromptBuilder.renderDomainTier; explicitly enumerate so the matrix
  // knows about it.
  for (const domain of ['game', 'service']) {
    paths.add(TECH_TIER_TEMPLATE_PATHS.jobDomain('plan', domain));
  }

  // ── Shared paths ──

  // PromptBuilder.build() programmatic paths: `jobs/${job}/base/examples`
  for (const job of ['code', 'design']) {
    paths.add(`jobs/${job}/base/examples`);
  }

  return paths;
}

// ============================================
// Source (g): injection-manifest.json
// ============================================

function collectManifestPaths(): Set<string> {
  const manifest: Record<string, Record<string, string[]>> = JSON.parse(
    readFileSync(join(__dirname, '../src/core/prompt/injection-manifest.json'), 'utf8'),
  );
  const paths = new Set<string>();
  for (const [dir, entries] of Object.entries(manifest)) {
    if (dir.startsWith('$')) continue;
    for (const name of Object.keys(entries)) {
      paths.add(`${dir}/${name}`);
    }
  }
  return paths;
}

// ============================================
// Matrix Types
// ============================================

type ReachSource = 'build-callsite' | 'auto-injection' | 'policy-map' | 'render-call' | 'partial-ref' | 'basis-registry' | 'manifest';

interface TemplateReachability {
  sources: ReachSource[];
}

type TemplateMatrix = Record<string, TemplateReachability>;

// ============================================
// Test Suite
// ============================================

describe('Template Reverse Coverage Matrix', () => {
  let allTemplates: string[];
  let tsFiles: string[];
  let matrix: TemplateMatrix;

  // Per-source sets
  let buildPaths: Set<string>;
  let injectionPaths: Set<string>;
  let policyPaths: Set<string>;
  let renderPaths: Set<string>;
  let partialPaths: Set<string>;
  let basisPaths: Set<string>;
  let manifestPaths: Set<string>;

  beforeAll(async () => {
    allTemplates = await collectAllTemplates(TEMPLATES_DIR);

    tsFiles = [];
    for (const dir of AGENT_SRC_DIRS) {
      tsFiles.push(...await collectTsFiles(dir));
    }

    buildPaths = collectBuildCallSitePaths(tsFiles);
    injectionPaths = collectAutoInjectionPaths();
    policyPaths = collectPolicyTemplatePaths();
    renderPaths = collectRenderCallPaths(tsFiles);
    partialPaths = await collectPartialRefs();
    basisPaths = collectBasisPaths();
    manifestPaths = collectManifestPaths();

    // Build the matrix
    matrix = {};
    for (const tmpl of allTemplates) {
      const sources: ReachSource[] = [];
      if (buildPaths.has(tmpl)) sources.push('build-callsite');
      if (injectionPaths.has(tmpl)) sources.push('auto-injection');
      if (policyPaths.has(tmpl)) sources.push('policy-map');
      if (renderPaths.has(tmpl)) sources.push('render-call');
      if (partialPaths.has(tmpl)) sources.push('partial-ref');
      if (basisPaths.has(tmpl)) sources.push('basis-registry');
      if (manifestPaths.has(tmpl)) sources.push('manifest');
      matrix[tmpl] = { sources };
    }

    // Write JSON matrix
    writeFileSync(OUTPUT_PATH, JSON.stringify(matrix, null, 2));
  });

  it('matrix JSON is generated', () => {
    expect(existsSync(OUTPUT_PATH)).toBe(true);
    const content = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    expect(Object.keys(content).length).toBe(allTemplates.length);
  });

  it('every template is reachable from at least one source (no orphans)', () => {
    const orphans = Object.entries(matrix)
      .filter(([_, v]) => v.sources.length === 0)
      .filter(([name]) => {
        const basename = name.split('/').pop() || '';
        return !(basename.startsWith('_') && basename !== '_preamble');
      })
      .map(([name]) => name);

    if (orphans.length > 0) {
      expect.fail(
        `${orphans.length} orphan template(s) — not reachable from any code path:\n  ${orphans.join('\n  ')}`,
      );
    }
  });

  it('injection templates are in the manifest', () => {
    const injectionTemplates = allTemplates.filter(t => t.includes('/injections/'));
    const missing = injectionTemplates.filter(t => !manifestPaths.has(t));
    if (missing.length > 0) {
      expect.fail(
        `Injection templates missing from injection-manifest.json:\n  ${missing.join('\n  ')}`,
      );
    }
  });

  it('every manifest entry has a corresponding .md file', () => {
    const manifestOnly = [...manifestPaths].filter(p => !allTemplates.includes(p));
    if (manifestOnly.length > 0) {
      expect.fail(
        `Manifest entries with no .md file:\n  ${manifestOnly.join('\n  ')}`,
      );
    }
  });

  // Summary statistics
  it('prints coverage summary', () => {
    const total = allTemplates.length;
    const bySource: Record<ReachSource, number> = {
      'build-callsite': 0,
      'auto-injection': 0,
      'policy-map': 0,
      'render-call': 0,
      'partial-ref': 0,
      'basis-registry': 0,
      'manifest': 0,
    };

    for (const entry of Object.values(matrix)) {
      for (const s of entry.sources) {
        bySource[s]++;
      }
    }

    const orphanCount = Object.values(matrix).filter(v => v.sources.length === 0).length;
    const multiSource = Object.values(matrix).filter(v => v.sources.length > 1).length;

    console.log(`\n📊 Template Reverse Matrix Summary`);
    console.log(`   Total templates: ${total}`);
    console.log(`   Orphans: ${orphanCount}`);
    console.log(`   Multi-source: ${multiSource}`);
    console.log(`   By source:`);
    for (const [source, count] of Object.entries(bySource)) {
      console.log(`     ${source}: ${count}`);
    }
  });
});
