/**
 * Audit 6: Invariant Static Verification
 *
 * 6A. injection-manifest integrity + classification
 * 6B. Template legacy variable absence
 * 6C. TemplateComposer getInjectionVars integrity → SKIPPED (TemplateComposer removed)
 * 6D. AssembledContext.stats type contract → SKIPPED (ContextAssembler removed)
 * 6E. documents reference identity → SKIPPED (ContextAssembler/PromptResolver removed)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
const MANIFEST_PATH = join(__dirname, '../src/core/prompt/injection-manifest.json');
const AUTO_INJECTION_RESOLVER_PATH = join(__dirname, '../src/core/prompt/builder/AutoInjectionResolver.ts');

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
    const mcSource = readFileSync(AUTO_INJECTION_RESOLVER_PATH, 'utf-8');
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
          warnings.push(`${fullPath} — not found in AutoInjectionResolver or as partial`);
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

