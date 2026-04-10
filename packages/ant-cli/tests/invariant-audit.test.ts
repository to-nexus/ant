/**
 * Audit 6: Invariant Static Verification
 *
 * 6A. injection-manifest integrity + classification
 * 6B. Template legacy variable absence
 * 6C. TemplateComposer getInjectionVars integrity
 * 6D. AssembledContext.stats type contract
 * 6E. documents reference identity
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import '../src/core/prompt/engine/TemplateComposer';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
const MANIFEST_PATH = join(__dirname, '../src/core/prompt/injection-manifest.json');
const MODE_CONTROLLER_PATH = join(__dirname, '../src/core/prompt/engine/ModeController.ts');
const TEMPLATE_COMPOSER_PATH = join(__dirname, '../src/core/prompt/engine/TemplateComposer.ts');
const CONTEXT_ASSEMBLER_PATH = join(__dirname, '../src/core/prompt/engine/ContextAssembler.ts');

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

  it('manifest entry classification: every entry is used as injection OR partial', async () => {
    const mcSource = readFileSync(MODE_CONTROLLER_PATH, 'utf-8');
    const allTemplates = await collectAllTemplates(TEMPLATES_DIR);
    const warnings: string[] = [];

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

        if (!isInjectedByMC && !isUsedAsPartial) {
          warnings.push(`${fullPath} — not found in ModeController or as partial`);
        }
      }
    }

    if (warnings.length > 0) {
      console.warn(`[6A] Unused manifest entries (not necessarily bugs):\n  ${warnings.join('\n  ')}`);
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
// 6C. TemplateComposer getInjectionVars integrity
// ============================================

describe('Audit 6C: TemplateComposer getInjectionVars integrity', () => {
  let composerSource: string;

  beforeAll(() => {
    composerSource = readFileSync(TEMPLATE_COMPOSER_PATH, 'utf-8');
  });

  it('no design-doc/prd-spec/ui-doc keys in varMap', () => {
    expect(composerSource).not.toMatch(/'design-doc'\s*:/);
    expect(composerSource).not.toMatch(/'prd-spec'\s*:/);
    expect(composerSource).not.toMatch(/'ui-doc'\s*:/);
  });

  it('varMap filename keys do not collide across injection paths', () => {
    const mcSource = readFileSync(MODE_CONTROLLER_PATH, 'utf-8');

    const injectionPushPattern = /injections\.push\([`'"](.*?)[`'"]\)/g;
    const allPaths: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = injectionPushPattern.exec(mcSource)) !== null) {
      let path = match[1];
      path = path.replace(/\$\{[^}]+\}/g, 'DYNAMIC');
      allPaths.push(path);
    }

    const filenameMap = new Map<string, string[]>();
    for (const p of allPaths) {
      const filename = p.split('/').pop()!;
      if (filename === 'DYNAMIC' || filename === 'rules' || filename === 'constraints' || filename === 'config' || filename === 'hints') continue;
      if (!filenameMap.has(filename)) filenameMap.set(filename, []);
      filenameMap.get(filename)!.push(p);
    }

    const collisions: string[] = [];
    for (const [filename, paths] of filenameMap) {
      if (paths.length > 1) {
        const uniquePaths = [...new Set(paths)];
        if (uniquePaths.length > 1) {
          collisions.push(`'${filename}' → ${uniquePaths.join(', ')}`);
        }
      }
    }

    if (collisions.length > 0) {
      console.warn(`[6C] Filename collisions (check varMap):\n  ${collisions.join('\n  ')}`);
    }
  });

  it('all RAC injection keys are present in varMap', () => {
    expect(composerSource).toContain("'action-context'");
    expect(composerSource).toContain("'basis-guidance'");
    expect(composerSource).toContain("'refactor-guidance'");
  });

  it('varMap maps action-context, basis-guidance, refactor-guidance to resolvedAction', () => {
    const actionContextBlock = composerSource.match(/'action-context'[\s\S]*?resolvedAction/);
    expect(actionContextBlock).toBeTruthy();
    const basisBlock = composerSource.match(/'basis-guidance'[\s\S]*?resolvedAction/);
    expect(basisBlock).toBeTruthy();
    const refactorBlock = composerSource.match(/'refactor-guidance'[\s\S]*?resolvedAction/);
    expect(refactorBlock).toBeTruthy();
  });
});

// ============================================
// 6D. AssembledContext.stats type contract
// ============================================

describe('Audit 6D: AssembledContext.stats type contract', () => {
  let assemblerSource: string;
  let assemblerInterface: string;

  beforeAll(() => {
    assemblerSource = readFileSync(CONTEXT_ASSEMBLER_PATH, 'utf-8');
    const interfaceMatch = assemblerSource.match(/stats:\s*\{([\s\S]*?)\};/);
    assemblerInterface = interfaceMatch ? interfaceMatch[1] : '';
  });

  it('stats interface declares expected fields', () => {
    expect(assemblerSource).toContain('hasDirective');
    expect(assemblerSource).toContain('hasDesign');
    expect(assemblerSource).toContain('hasProjectCode');
    expect(assemblerSource).toContain('hasReferenceCode');
    expect(assemblerSource).toContain('hasMemory');
    expect(assemblerSource).toContain('codebaseDetected');
    expect(assemblerSource).toContain('hasMissingDependency');
  });

  it('stats computation assigns all declared fields', () => {
    const statsBlock = assemblerSource.match(/const stats = \{([\s\S]*?)\};/);
    expect(statsBlock).toBeTruthy();
    const block = statsBlock![1];

    expect(block).toContain('hasDirective');
    expect(block).toContain('hasDesign');
    expect(block).toContain('hasProjectCode');
    expect(block).toContain('hasReferenceCode');
    expect(block).toContain('hasMemory');
    expect(block).toContain('codebaseDetected');
    expect(block).toContain('hasMissingDependency');
  });

  it('hasSessionHistory declared in type but may not be computed (known gap)', () => {
    const typeDeclaration = assemblerSource.match(/stats:\s*\{[\s\S]*?hasSessionHistory/);
    if (typeDeclaration) {
      const statsBlock = assemblerSource.match(/const stats = \{([\s\S]*?)\};/);
      if (statsBlock && !statsBlock[1].includes('hasSessionHistory')) {
        console.warn('[6D] hasSessionHistory is declared in AssembledContext.stats type but not computed in ContextAssembler');
      }
    }
  });
});

// ============================================
// 6E. documents reference identity
// ============================================

describe('Audit 6E: documents reference identity', () => {
  it('ContextAssembler preserves artifacts.documents and artifacts.resolvedAction', () => {
    const assemblerSource = readFileSync(CONTEXT_ASSEMBLER_PATH, 'utf-8');

    expect(assemblerSource).toContain('assembled.resolvedAction = artifacts.resolvedAction');
    expect(assemblerSource).toContain('assembled.documents = artifacts.documents');
  });

  it('ContextAssembler re-applies artifacts after loader (preserving priority)', () => {
    const assemblerSource = readFileSync(CONTEXT_ASSEMBLER_PATH, 'utf-8');

    const reApplySection = assemblerSource.indexOf('Re-apply ALL artifact values');
    expect(reApplySection).toBeGreaterThan(-1);

    const afterReApply = assemblerSource.substring(reApplySection);
    expect(afterReApply).toContain('artifacts.resolvedAction');
    expect(afterReApply).toContain('artifacts.documents');
  });

  it('ModeController reads hasUiInDocuments from resolvedAction.documents', () => {
    const mcSource = readFileSync(MODE_CONTROLLER_PATH, 'utf-8');
    expect(mcSource).toContain("resolvedAction?.documents");
    expect(mcSource).toMatch(/hasUiInDocuments.*resolvedAction/);
  });

  it('TemplateComposer computes hasUiInDocuments from assembled.documents', () => {
    const composerSource = readFileSync(TEMPLATE_COMPOSER_PATH, 'utf-8');
    expect(composerSource).toContain("assembled.documents");
    expect(composerSource).toMatch(/hasUiInDocuments.*assembled\.documents/);
  });

  it('both ModeController and TemplateComposer use .path?.includes("ui-") check', () => {
    const mcSource = readFileSync(MODE_CONTROLLER_PATH, 'utf-8');
    const composerSource = readFileSync(TEMPLATE_COMPOSER_PATH, 'utf-8');

    expect(mcSource).toMatch(/\.path\?\.includes\(['"]ui-['"]\)/);
    expect(composerSource).toMatch(/\.path\?\.includes\(['"]ui-['"]\)/);
  });
});
