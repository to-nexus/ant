import { promises as fs } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";

// ✅ ESM-compatible __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { PromptPort } from "../../../core/ports";

// ✅ Register helpers once (top-level, not per render call)
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("ne", (a, b) => a !== b);
Handlebars.registerHelper("and", (a, b) => a && b);
Handlebars.registerHelper("or", (a, b) => a || b);
Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));

// ✅ Register base partials (always included for all agents/phases)
const basePartialsPath = join(__dirname, "../../../core/prompt/templates/base");
const baseInjectionsPath = join(__dirname, "../../../core/prompt/templates/base/injections");
Promise.all([
  fs.readFile(join(basePartialsPath, "architect-role.md"), "utf8")
    .then(content => Handlebars.registerPartial("base/architect-role", content))
    .catch(() => {}),
  // ✅ NEW: Register git-diff template (base injections)
  fs.readFile(join(baseInjectionsPath, "git-diff.md"), "utf8")
    .then(content => Handlebars.registerPartial("base/injections/git-diff", content))
    .catch(() => {})
]).catch(() => {});

// ✅ Register code-specific base injections (conditionally used by code templates)
const codeBaseInjectionsPath = join(__dirname, "../../../core/prompt/templates/code/base/injections");
Promise.all([
  fs.readFile(join(codeBaseInjectionsPath, "text-format-compact.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/text-format-compact", content))
    .catch(() => {}),
  fs.readFile(join(codeBaseInjectionsPath, "tool-calling-rules-compact.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/tool-calling-rules-compact", content))
    .catch(() => {}),
  fs.readFile(join(codeBaseInjectionsPath, "design-document-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/design-document-guide", content))
    .catch(() => {}),
  fs.readFile(join(codeBaseInjectionsPath, "output-format-markdown.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/output-format-markdown", content))
    .catch(() => {})
]).catch(() => {});

/**
 * FilePromptAdapter - File system implementation of PromptPort
 * Loads template files and renders with Handlebars template engine
 * 
 * Templates are stored relative to this file's location:
 * - Development (src/): ../../../core/prompt/templates
 * - Production (dist/): ../../../core/prompt/templates (same relative path)
 * 
 * Supports:
 * - Variable substitution: {{variableName}}
 * - Conditionals: {{#if variable}}...{{else}}...{{/if}}
 * - Iteration: {{#each array}}...{{/each}}
 */
export class FilePromptAdapter implements PromptPort {
  constructor(
    // ✅ Use __dirname for correct path resolution in both src/ and dist/
    // __dirname points to the directory of THIS file (adapters/prompt/)
    // Templates are at: ../../../core/prompt/templates (relative to this file)
    private baseDir = join(__dirname, "../../../core/prompt/templates")
  ) {}
  
  async render(templateName: string, vars: Record<string, any>): Promise<string> {
    // 1. Load template from file
    const file = join(this.baseDir, `${templateName}.md`);
    const templateSource = await fs.readFile(file, "utf8");
    
    // 2. Compile template with Handlebars
    const template = Handlebars.compile(templateSource, {
      noEscape: true,  // Don't HTML-escape (we're generating text/markdown, not HTML)
      strict: false,   // Allow undefined variables (return empty string)
    });
    
    // 3. Extract variables used in template for validation
    const usedVarsMatches = templateSource.match(/\{\{[\#\/]?(\w+)[^}]*\}\}/g);
    const usedVars = usedVarsMatches 
      ? [...new Set(usedVarsMatches.map(v => {
          // ✅ FIX: Extract actual variable name from conditionals
          // {{#if hasExistingCode}} → extract "hasExistingCode", not "if"
          // {{hasExistingCode}} → extract "hasExistingCode"
          
          // First, check if it's a conditional ({{#if varName}} or {{#unless varName}})
          const conditionalMatch = v.match(/\{\{#(?:if|unless)\s+(\w+)/);
          if (conditionalMatch) {
            return conditionalMatch[1];  // Return the condition variable
          }
          
          // Otherwise, extract first word after {{ or {{#
          const match = v.match(/\{\{[\#\/]?(\w+)/);
          return match ? match[1] : null;
        }).filter(Boolean))]
      : [];
    
    // 4. Validate variables (filter out Handlebars keywords and helpers)
    const handlebarsKeywords = ['if', 'unless', 'each', 'with', 'else'];
    const handlebarsHelpers = ['eq', 'ne', 'and', 'or', 'add'];  // ✅ Registered helpers
    const templateVars = (usedVars as string[]).filter(v => 
      !handlebarsKeywords.includes(v) && !handlebarsHelpers.includes(v)
    );
    const missingVars = templateVars.filter(v => !(v in vars));
    const providedVars = Object.keys(vars);
    const unusedVars = providedVars.filter(v => !templateVars.includes(v));
    
    // 5. Log warnings for maintenance
    if (missingVars.length > 0) {
      console.warn(`[PromptAdapter] Template "${templateName}": Missing variables [${missingVars.join(', ')}]`);
    }
    if (unusedVars.length > 0) {
      console.warn(`[PromptAdapter] Template "${templateName}": Unused variables [${unusedVars.join(', ')}]`);
    }
    
    // 6. Render template with Handlebars
    return template(vars);
  }
}

