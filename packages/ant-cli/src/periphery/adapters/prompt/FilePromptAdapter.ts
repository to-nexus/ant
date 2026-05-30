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

Handlebars.registerHelper("json", (ctx: unknown) => {
  try {
    return new Handlebars.SafeString(JSON.stringify(ctx ?? null));
  } catch {
    return new Handlebars.SafeString('null');
  }
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
 *
 * I4 — Basis Partial Invariant (Phase 1, F-2):
 *   `templates/basis/**` is intentionally EXCLUDED from partial registration.
 *   Files inside `basis/**` are leaf-only Markdown — they MUST NOT use
 *   `{{> }}` includes because the partial names cannot resolve. The
 *   `tests/basis-partial-invariant.test.ts` regression locks this in;
 *   private partials needed by basis content live under
 *   `templates/jobs/.../basis/.../_*-private.md` instead and are
 *   registered via the `jobs/...` namespace.
 */
export async function initPartials(basePath?: string): Promise<{ total: number; failed: PartialFailure[] }> {
  const templatesPath = basePath || WorkspacePathResolver.getPromptTemplatesPath();

  let mdFiles: string[];
  try {
    const allMdFiles = await discoverMdFiles(templatesPath);
    // I4: basis/** files are leaf-only — they cannot host partial includes
    // (and they themselves are loaded through render(path) directly, not
    // through Handlebars partial resolution).
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
 * Scans for {{> partialName [hash="value"...]}} and follows each partial's own
 * source for nested refs. Hash parameters (partial context parameters) are
 * tolerated — only the partial name is captured, any trailing hash pairs are
 * skipped.
 */
export function collectResolvedPartials(templateNames: string[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function walk(source: string): void {
    const pattern = /\{\{>\s*([\w/\-]+)[^}]*\}\}/g;
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

    // Resolve a dot-path against the top-level vars (e.g. `resolvedAction.documents`
    // → `vars.resolvedAction?.documents`). Returns undefined if any intermediate
    // segment is nullish.
    const lookupDotPath = (path: string): unknown => {
      const segments = path.split('.');
      let current: unknown = vars;
      for (const seg of segments) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[seg];
      }
      return current;
    };

    const shouldValidate = (varName: string): boolean => {
      // Capture dot-paths (e.g. `resolvedAction.documents`) so a guard whose
      // discriminator lives on a nested field is evaluated correctly. The
      // legacy `\w+` regex only captured the head segment, treating any
      // truthy parent object as "guard open" — which forced top-level
      // validation of inner-each fields (`label` / `path` / `content`) even
      // when the outer collection itself was undefined.
      const conditionalPattern = new RegExp(`\\{\\{#if\\s+([\\w.]+)[^}]*\\}\\}[\\s\\S]*?\\{\\{${varName}[^}]*\\}\\}[\\s\\S]*?\\{\\{\\/if\\}\\}`, 'g');
      const conditionalMatch = templateSource.match(conditionalPattern);
      if (!conditionalMatch) return true;
      const conditionMatch = conditionalMatch[0].match(/\{\{#if\s+([\w.]+)/);
      if (!conditionMatch) return true;
      return !!lookupDotPath(conditionMatch[1]);
    };

    const missingVars = templateVars.filter(shouldValidate).filter(v => !(v in vars));

    if (missingVars.length > 0) {
      console.warn(`⚠️ [PromptAdapter] Template "${templateName}": missing variables [${missingVars.join(', ')}]`);
      this._lastViolations.push({ templateName, missingVars: [...missingVars] as string[] });
    }

    return template(vars);
  }
}
