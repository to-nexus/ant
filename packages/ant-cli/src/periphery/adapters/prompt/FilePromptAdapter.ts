import { promises as fs } from "fs";
import { join } from "path";
import Handlebars from "handlebars";
import { PromptPort } from "../../../core/ports";
import { WorkspacePathResolver } from "../../../core/config/WorkspacePathResolver";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Handlebars helpers — single source of truth
// TemplateComposer.ts imports Handlebars but does NOT register helpers.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// eslint-disable-next-line eqeqeq
Handlebars.registerHelper("eq", (a: any, b: any) => a == b);
// eslint-disable-next-line eqeqeq
Handlebars.registerHelper("ne", (a: any, b: any) => a != b);

Handlebars.registerHelper("and", function (...args: any[]) {
  const values = args.slice(0, -1);
  return values.every(Boolean);
});

Handlebars.registerHelper("or", function (...args: any[]) {
  const values = args.slice(0, -1);
  return values.some(Boolean);
});

Handlebars.registerHelper("add", (a: any, b: any) => Number(a) + Number(b));

Handlebars.registerHelper("includes", function (haystack: any, needle: any) {
  if (haystack == null || needle == null) return false;
  const h = String(haystack).toLowerCase();
  const n = String(needle).toLowerCase();
  return h.includes(n);
});

Handlebars.registerHelper("gte", (a: any, b: any) => Number(a) >= Number(b));

Handlebars.registerHelper("lower", function (value: any) {
  if (value == null) return '';
  return String(value).toLowerCase();
});

export interface PartialFailure {
  name: string;
  error: Error;
}

/**
 * Recursively discover all .md files under a directory.
 * Returns paths relative to the root (e.g. "jobs/code/base/injections/git-diff.md").
 */
async function discoverMdFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(join(root, prefix), { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...await discoverMdFiles(root, rel));
    } else if (entry.name.endsWith('.md')) {
      results.push(rel);
    }
  }
  return results;
}

/**
 * Auto-discover and register ALL .md files under templates/ as Handlebars partials.
 * Partial name = relative path minus .md extension (e.g. "jobs/code/base/injections/git-diff").
 * No manual list needed — file existence IS the registry.
 */
export async function initPartials(basePath?: string): Promise<{ total: number; failed: PartialFailure[] }> {
  const templatesPath = basePath || WorkspacePathResolver.getPromptTemplatesPath();

  let mdFiles: string[];
  try {
    const allMdFiles = await discoverMdFiles(templatesPath);
    mdFiles = allMdFiles.filter(f => !f.startsWith('basis/'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`📄 [PromptAdapter] Templates directory not accessible: ${templatesPath}`);
    console.error(`   → ${msg}`);
    return { total: 0, failed: [{ name: '(discovery)', error: err as Error }] };
  }
  const failures: PartialFailure[] = [];

  await Promise.all(
    mdFiles.map(async (relativePath) => {
      const name = relativePath.replace(/\.md$/, '');
      try {
        const content = await fs.readFile(join(templatesPath, relativePath), "utf8");
        Handlebars.registerPartial(name, content);
      } catch (err) {
        failures.push({ name, error: err as Error });
      }
    })
  );

  const total = mdFiles.length;

  if (failures.length > 0) {
    console.error(`📄 [PromptAdapter] Partial registration: ${total - failures.length}/${total} succeeded`);
    for (const f of failures) {
      console.error(`   ❌ ${f.name}: ${f.error.message}`);
    }
  } else {
    console.log(`📄 [PromptAdapter] All ${total} partials registered`);
  }

  return { total, failed: failures };
}

/**
 * File system implementation of PromptPort.
 * Loads .md templates and renders with Handlebars.
 */
export interface RenderViolation {
  templateName: string;
  missingVars: string[];
}

/**
 * Recursively collect all Handlebars partial references from a template source.
 * Scans for {{> partialName}} and follows each partial's own source for nested refs.
 */
export function collectResolvedPartials(templateNames: string[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function walk(source: string): void {
    const pattern = /\{\{>\s*([\w/\-]+)\s*\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1];
      if (visited.has(name)) continue;
      visited.add(name);
      result.push(name);
      const partialSrc = Handlebars.partials[name];
      if (typeof partialSrc === 'string') {
        walk(partialSrc);
      }
    }
  }

  for (const tmpl of templateNames) {
    const src = Handlebars.partials[tmpl];
    if (typeof src === 'string') walk(src);
  }

  return result;
}

export class FilePromptAdapter implements PromptPort {
  private baseDir: string;
  private _lastViolations: RenderViolation[] = [];

  constructor(baseDir?: string) {
    this.baseDir = baseDir || WorkspacePathResolver.getPromptTemplatesPath();
  }

  get lastViolations(): RenderViolation[] {
    return this._lastViolations;
  }

  clearViolations(): void {
    this._lastViolations = [];
  }

  async renderRaw(templatePath: string): Promise<string> {
    const file = join(this.baseDir, `${templatePath}.md`);
    return await fs.readFile(file, 'utf8');
  }

  async render(templateName: string, vars: Record<string, any>): Promise<string> {
    const file = join(this.baseDir, `${templateName}.md`);
    const templateSource = await fs.readFile(file, "utf8");

    const template = Handlebars.compile(templateSource, {
      noEscape: true,
      strict: false,
    });

    const usedVarsMatches = templateSource.match(/\{\{[\#\/]?(\w+)[^}]*\}\}/g);
    const usedVars = usedVarsMatches
      ? [...new Set(usedVarsMatches.map(v => {
          const conditionalMatch = v.match(/\{\{#(?:if|unless)\s+(\w+)/);
          if (conditionalMatch) return conditionalMatch[1];
          const match = v.match(/\{\{[\#\/]?(\w+)/);
          return match ? match[1] : null;
        }).filter(Boolean))]
      : [];

    const handlebarsKeywords = ['if', 'unless', 'each', 'with', 'else', 'this'];
    const handlebarsHelpers = ['eq', 'ne', 'and', 'or', 'add', 'includes', 'gte', 'lower'];
    const templateVars = (usedVars as string[]).filter(v =>
      !handlebarsKeywords.includes(v) && !handlebarsHelpers.includes(v)
    );

    const shouldValidate = (varName: string): boolean => {
      const conditionalPattern = new RegExp(`\\{\\{#if\\s+(\\w+)[^}]*\\}\\}[\\s\\S]*?\\{\\{${varName}[^}]*\\}\\}[\\s\\S]*?\\{\\{\\/if\\}\\}`, 'g');
      const conditionalMatch = templateSource.match(conditionalPattern);
      if (!conditionalMatch) return true;
      const conditionMatch = conditionalMatch[0].match(/\{\{#if\s+(\w+)/);
      if (!conditionMatch) return true;
      return !!vars[conditionMatch[1]];
    };

    const missingVars = templateVars.filter(shouldValidate).filter(v => !(v in vars));

    if (missingVars.length > 0) {
      console.warn(`⚠️ [PromptAdapter] Template "${templateName}": missing variables [${missingVars.join(', ')}]`);
      this._lastViolations.push({ templateName, missingVars: [...missingVars] as string[] });
    }

    return template(vars);
  }
}
