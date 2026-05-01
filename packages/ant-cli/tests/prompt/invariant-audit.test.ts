/**
 * Audit 6: Invariant Static Verification
 *
 * 6A. injection-manifest integrity + classification
 * 6B. Template legacy variable absence
 * 6C. Code-to-template reverse reference integrity
 * 6D. AutoInjectionResolver combinatorial path coverage
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { AutoInjectionResolver } from '../../src/core/prompt/builder/AutoInjectionResolver';
import { POLICY_TEMPLATE_MAP } from '@ant/shared';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const MANIFEST_PATH = join(__dirname, '../../src/core/prompt/injection-manifest.json');
const AUTO_INJECTION_RESOLVER_PATH = join(__dirname, '../../src/core/prompt/builder/AutoInjectionResolver.ts');
const AGENT_SRC_DIRS = [
  join(__dirname, '../../src/agents'),
  join(__dirname, '../../src/core/prompt/builder'),
  join(__dirname, '../../src/core/context'),
  join(__dirname, '../../src/agents/common'),
];

async function collectAllTemplates(dir: string, prefix = ''): Promise<Array<[string, string]>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: Array<[string, string]> = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...await collectAllTemplates(join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      const content = await fs.readFile(join(dir, entry.name), 'utf8');
      result.push([rel.replace(/\.md$/, ''), content]);
    }
  }
  return result;
}

beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
});

// ============================================
// 6A. injection-manifest integrity + classification
// ============================================

describe('Audit 6A: injection-manifest integrity', () => {
  let manifest: Record<string, Record<string, string[]>>;

  beforeAll(() => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  });

  it('manifest has no legacy entries (design-doc, prd-spec, ui-doc)', () => {
    for (const [category, entries] of Object.entries(manifest)) {
      if (category.startsWith('$') || typeof entries !== 'object') continue;
      expect(entries['design-doc']).toBeUndefined();
      expect(entries['prd-spec']).toBeUndefined();
      expect(entries['ui-doc']).toBeUndefined();
    }
  });

  it('all manifest entries have corresponding .md template files', async () => {
    const missing: string[] = [];
    for (const [dir, entries] of Object.entries(manifest)) {
      if (dir.startsWith('$')) continue;
      if (typeof entries !== 'object' || entries === null) continue;
      for (const name of Object.keys(entries)) {
        const fullPath = join(TEMPLATES_DIR, `${dir}/${name}.md`);
        try {
          await fs.access(fullPath);
        } catch {
          missing.push(`${dir}/${name}`);
        }
      }
    }
    if (missing.length > 0) {
      expect.fail(`Manifest entries missing template files:\n  ${missing.join('\n  ')}`);
    }
  });

  it('manifest entry classification: every entry is used as injection, partial, policy, or render call', async () => {
    const mcSource = readFileSync(AUTO_INJECTION_RESOLVER_PATH, 'utf-8');
    const allTemplates = await collectAllTemplates(TEMPLATES_DIR);

    // Also check POLICY_TEMPLATE_MAP and agent TS source code for render() calls
    const policyValues = new Set(Object.values(POLICY_TEMPLATE_MAP));
    const agentTsFiles = await collectTsFiles(AGENT_SRC_DIRS[0]);
    const agentSources = agentTsFiles.map(f => readFileSync(f, 'utf-8')).join('\n');

    const orphans: string[] = [];

    for (const [category, entries] of Object.entries(manifest)) {
      if (category.startsWith('$') || typeof entries !== 'object') continue;
      for (const name of Object.keys(entries)) {
        const fullPath = `${category}/${name}`;

        const isInjectedByMC = mcSource.includes(name) || mcSource.includes(fullPath);

        const isUsedAsPartial = allTemplates.some(([_, content]) =>
          content.includes(`{{> ${fullPath}}}`) ||
          content.includes(`{{> ${fullPath} `) ||
          content.includes(`{{> ${fullPath}\n`)
        );

        const isInPolicyMap = policyValues.has(fullPath);

        const isRenderedByAgent = agentSources.includes(fullPath) || agentSources.includes(name);

        if (!isInjectedByMC && !isUsedAsPartial && !isInPolicyMap && !isRenderedByAgent) {
          orphans.push(`${fullPath} — not found in AutoInjectionResolver, partials, POLICY_TEMPLATE_MAP, or agent render calls`);
        }
      }
    }

    if (orphans.length > 0) {
      expect.fail(`[6A] ${orphans.length} manifest entry(s) with no usage path:\n  ${orphans.join('\n  ')}`);
    }
  });
});

// ============================================
// 6B. Template legacy variable absence
// ============================================

describe('Audit 6B: template legacy variable absence', () => {
  it('no template contains {{designDoc}}, {{prdSpec}}, or {{uiDoc}} in render position', async () => {
    const templates = await collectAllTemplates(TEMPLATES_DIR);
    const violations: Array<{ name: string; variable: string }> = [];

    for (const [name, content] of templates) {
      const cleaned = content.replace(/\{\{!--[\s\S]*?--\}\}/g, '');
      if (/\{\{designDoc\}\}/.test(cleaned)) {
        violations.push({ name, variable: '{{designDoc}}' });
      }
      if (/\{\{prdSpec\}\}/.test(cleaned)) {
        violations.push({ name, variable: '{{prdSpec}}' });
      }
      if (/\{\{uiDoc\}\}/.test(cleaned)) {
        violations.push({ name, variable: '{{uiDoc}}' });
      }
    }

    if (violations.length > 0) {
      const report = violations.map(v => `  ${v.name}: ${v.variable}`).join('\n');
      expect.fail(`Legacy variables found in templates:\n${report}`);
    }
  });
});

// ============================================
// 6C. Code-to-template reverse reference integrity
// ============================================

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return results; }
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

/**
 * Extract template path strings from TS source code.
 * Finds render('path'), render(`path`), and templates: { base: 'path', ... } patterns.
 */
function extractTemplatePaths(source: string, filePath: string): Array<{ path: string; line: number; optional: boolean }> {
  const results: Array<{ path: string; line: number; optional: boolean }> = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments and logPrompt blocks
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
    if (/logPrompt|templatePath:/.test(line)) continue;

    // Pattern 1: render('jobs/...' or 'infra/...' or 'agents/...')
    const renderLiteral = /\.render\(\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = renderLiteral.exec(line)) !== null) {
      if (m[1].startsWith('jobs/') || m[1].startsWith('infra/') || m[1].startsWith('agents/')) {
        const isInTryCatch = isInsideTryCatch(lines, i);
        results.push({ path: m[1], line: lineNum, optional: isInTryCatch });
      }
    }

    // Pattern 2: render(`jobs/.../${var}/...`) - template literals
    const renderTemplate = /\.render\(\s*`([^`]+)`/g;
    while ((m = renderTemplate.exec(line)) !== null) {
      const tmpl = m[1];
      if (tmpl.startsWith('jobs/') || tmpl.startsWith('infra/') || tmpl.startsWith('agents/')) {
        const isInTryCatch = isInsideTryCatch(lines, i);
        const expanded = expandTemplateVars(tmpl);
        for (const p of expanded) {
          results.push({ path: p, line: lineNum, optional: isInTryCatch });
        }
      }
    }

    // Pattern 3: templates object: { base: 'path', rules: 'path', system: 'path' }
    const templatesProp = /(?:base|rules|system):\s*['"]([^'"]+)['"]/g;
    while ((m = templatesProp.exec(line)) !== null) {
      if (m[1].startsWith('jobs/') || m[1].startsWith('infra/') || m[1].startsWith('agents/')) {
        results.push({ path: m[1], line: lineNum, optional: false });
      }
    }
  }

  return results;
}

function isInsideTryCatch(lines: string[], lineIdx: number): boolean {
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 5); i--) {
    if (/\btry\s*\{/.test(lines[i])) return true;
  }
  return false;
}

/**
 * Expand `${...}` template variables into concrete paths using known value matrices.
 */
function expandTemplateVars(tmpl: string): string[] {
  if (!tmpl.includes('${')) return [tmpl];

  const expansions: Record<string, string[]> = {
    'job': ['code', 'design'],
    'mapLang(techTier.language)': ['typescript', 'go'],
    'mapLang(lang)': ['typescript', 'go'],
    'language': ['typescript', 'go'],
    'lang': ['typescript', 'go'],
    'fallbackLanguage': ['typescript', 'go'],
    'primaryLang': ['typescript', 'go'],
    'logSuffix': ['by-figma', 'by-desc'],
    'templateSuffix': ['by-figma', 'by-desc'],
    'freshLogSuffix': ['by-figma', 'by-desc'],
    'tool.name': ['run_command'],
  };

  const envExpansions: Record<string, string[]> = {
    'env': ['browser', 'node-api', 'node-cli', 'go-api', 'go-cli', 'config', 'fullstack'],
    'backendEnv': ['node-api', 'go-api'],
  };

  let paths = [tmpl];

  // Process each ${...} in the template
  const varPattern = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = varPattern.exec(tmpl)) !== null) {
    const varExpr = match[1].trim();
    const key = Object.keys({ ...expansions, ...envExpansions })
      .find(k => varExpr.includes(k));
    if (!key) return []; // Unknown variable, skip this template
    const values = expansions[key] || envExpansions[key];
    const newPaths: string[] = [];
    for (const p of paths) {
      for (const v of values) {
        newPaths.push(p.replace(match[0], v));
      }
    }
    paths = newPaths;
  }

  // Recurse in case multiple vars exist
  const final: string[] = [];
  for (const p of paths) {
    if (p.includes('${')) {
      final.push(...expandTemplateVars(p));
    } else {
      final.push(p);
    }
  }
  return final;
}

describe('Audit 6C: code-to-template reverse reference integrity', () => {
  it('all render() and templates:{} paths in agent code resolve to existing .md files', async () => {
    const tsFiles: string[] = [];
    for (const dir of AGENT_SRC_DIRS) {
      tsFiles.push(...await collectTsFiles(dir));
    }

    const missing: Array<{ file: string; line: number; path: string }> = [];
    const warnings: Array<{ file: string; line: number; path: string }> = [];
    const checked = new Set<string>();

    for (const tsFile of tsFiles) {
      const source = await fs.readFile(tsFile, 'utf8');
      const refs = extractTemplatePaths(source, tsFile);
      const relFile = tsFile.replace(/.*packages\/ant-cli\//, '');

      for (const ref of refs) {
        const cacheKey = ref.path;
        if (checked.has(cacheKey)) continue;
        checked.add(cacheKey);

        const mdPath = join(TEMPLATES_DIR, `${ref.path}.md`);
        if (!existsSync(mdPath)) {
          if (ref.optional) {
            warnings.push({ file: relFile, line: ref.line, path: ref.path });
          } else {
            missing.push({ file: relFile, line: ref.line, path: ref.path });
          }
        }
      }
    }

    if (warnings.length > 0) {
      console.warn(`[6C] Optional template paths not found (try/catch protected):\n${warnings.map(w => `  ${w.path} (${w.file}:${w.line})`).join('\n')}`);
    }

    if (missing.length > 0) {
      const report = missing.map(m => `  ${m.path}\n    at ${m.file}:${m.line}`).join('\n');
      expect.fail(`${missing.length} required template path(s) have no .md file:\n${report}`);
    }
  });

  it('all POLICY_TEMPLATE_MAP values resolve to existing .md files', () => {
    const missing: string[] = [];
    for (const [key, tmplPath] of Object.entries(POLICY_TEMPLATE_MAP)) {
      const fullPath = join(TEMPLATES_DIR, `${tmplPath}.md`);
      if (!existsSync(fullPath)) {
        missing.push(`POLICY_TEMPLATE_MAP['${key}'] -> ${tmplPath}`);
      }
    }
    if (missing.length > 0) {
      expect.fail(`POLICY_TEMPLATE_MAP entries missing .md files:\n  ${missing.join('\n  ')}`);
    }
  });
});

// ============================================
// 6D. AutoInjectionResolver combinatorial path coverage
// ============================================

describe('Audit 6D: AutoInjectionResolver combinatorial path coverage', () => {
  const JOBS = ['code', 'design'] as const;
  const NODES = ['plan', 'execute'] as const;
  const TASK_TYPES = [
    'setup', 'feature', 'ui', 'design-system', 'test-code',
    'error', 'verification', 'explain', 'doc', undefined,
  ] as const;
  const MODES = ['generate', 'refactor', 'explain', undefined] as const;
  const LANGUAGES = ['typescript', 'go'] as const;
  const STACKS = ['frontend', 'backend', 'fullstack', undefined] as const;

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

  it('every path returned by resolve() has a corresponding .md template file', () => {
    const resolver = new AutoInjectionResolver();
    const allPaths = new Map<string, string>();
    const missing: Array<{ path: string; trigger: string }> = [];

    for (const job of JOBS) {
      for (const node of NODES) {
        for (const taskType of TASK_TYPES) {
          for (const mode of MODES) {
            for (const lang of LANGUAGES) {
              for (const stack of STACKS) {
                for (const data of DATA_COMBOS) {
                  const input = {
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
                  };

                  const paths = resolver.resolve(input);
                  const desc = `job=${job} node=${node} task=${taskType ?? '-'} mode=${mode ?? '-'} lang=${lang} stack=${stack ?? '-'} data=${JSON.stringify(data)}`;

                  for (const p of paths) {
                    if (allPaths.has(p)) continue;
                    allPaths.set(p, desc);

                    const mdPath = join(TEMPLATES_DIR, `${p}.md`);
                    if (!existsSync(mdPath)) {
                      missing.push({ path: p, trigger: desc });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (missing.length > 0) {
      const report = missing.map(m => `  ${m.path}\n    triggered by: ${m.trigger}`).join('\n');
      expect.fail(`${missing.length} injection path(s) have no .md file:\n${report}`);
    }
  });

  it('resolve() never returns empty-string or undefined paths', () => {
    const resolver = new AutoInjectionResolver();
    const invalid: string[] = [];

    for (const job of JOBS) {
      for (const node of NODES) {
        for (const taskType of TASK_TYPES) {
          const paths = resolver.resolve({
            job, node, taskType, data: {},
            techTiers: [{ language: 'typescript', stack: 'frontend' }],
          });
          for (const p of paths) {
            if (!p || typeof p !== 'string' || p.trim() === '') {
              invalid.push(`job=${job} node=${node} task=${taskType}: got "${p}"`);
            }
          }
        }
      }
    }

    if (invalid.length > 0) {
      expect.fail(`Invalid paths returned:\n  ${invalid.join('\n  ')}`);
    }
  });

  it('all returned paths follow the jobs/ or infra/ prefix convention', () => {
    const resolver = new AutoInjectionResolver();
    const violations: string[] = [];

    for (const job of JOBS) {
      for (const node of NODES) {
        const paths = resolver.resolve({
          job, node, data: { hasDirective: true, hasMemory: true },
          techTiers: [{ language: 'typescript', stack: 'fullstack' }],
          resolvedAction: { source: 'explicit', mode: 'refactor', hasExplicitFields: true, tech: {} } as any,
        });
        for (const p of paths) {
          if (!p.startsWith('jobs/') && !p.startsWith('infra/')) {
            violations.push(p);
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(`Paths without jobs/ or infra/ prefix:\n  ${violations.join('\n  ')}`);
    }
  });
});

