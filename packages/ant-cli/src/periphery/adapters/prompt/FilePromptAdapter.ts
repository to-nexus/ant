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

// ✅ Register common partials (shared across all jobs)
const commonPartialsPath = join(__dirname, "../../../core/prompt/templates/common");
const commonInjectionsPath = join(__dirname, "../../../core/prompt/templates/common/injections");
Promise.all([
  fs.readFile(join(commonPartialsPath, "architect-role.md"), "utf8")
    .then(content => Handlebars.registerPartial("common/architect-role", content))
    .catch(() => {}),
  fs.readFile(join(commonPartialsPath, "rules.md"), "utf8")
    .then(content => Handlebars.registerPartial("common/rules", content))
    .catch(() => {}),
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
  // ✅ Code job specific injections (RAG results)
  fs.readFile(join(codeBaseInjectionsPath, "retrieved-code.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/retrieved-code", content))
    .catch(() => {}),
  fs.readFile(join(codeBaseInjectionsPath, "reference-code.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/reference-code", content))
    .catch(() => {}),
  fs.readFile(join(codeBaseInjectionsPath, "git-diff.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/base/injections/git-diff", content))
    .catch(() => {})
]).catch(() => {});

// ✅ Register common injections (shared across all jobs)
Promise.all([
  fs.readFile(join(commonInjectionsPath, "text-format-compact.md"), "utf8")
    .then(content => Handlebars.registerPartial("common/injections/text-format-compact", content))
    .catch(() => {})
]).catch(() => {});

// ✅ Register phase-specific rules (decompose, detect, plan, etc.)
const codePhaseRulesBase = join(__dirname, "../../../core/prompt/templates/code/phases");
Promise.all([
  // Decompose rules
  fs.readFile(join(codePhaseRulesBase, "decompose/rules.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/decompose/rules", content))
    .catch(() => {}),
  // Decompose sub-modules (modularized for clarity)
  fs.readFile(join(codePhaseRulesBase, "decompose/mode-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/decompose/mode-guide", content))
    .catch(() => {}),
  fs.readFile(join(codePhaseRulesBase, "decompose/error-or-general.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/decompose/error-or-general", content))
    .catch(() => {}),
  fs.readFile(join(codePhaseRulesBase, "decompose/existing-code-check.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/decompose/existing-code-check", content))
    .catch(() => {}),
  fs.readFile(join(codePhaseRulesBase, "decompose/design-doc-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/decompose/design-doc-guide", content))
    .catch(() => {}),
  // Detect rules (detectEnvironment node)
  fs.readFile(join(codePhaseRulesBase, "detect/rules.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/detect/rules", content))
    .catch(() => {}),
  // Plan rules - keyword generation
  fs.readFile(join(codePhaseRulesBase, "plan/rules-keyword.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/plan/rules-keyword", content))
    .catch(() => {}),
  // Plan rules - plan generation
  fs.readFile(join(codePhaseRulesBase, "plan/rules-plan.md"), "utf8")
    .then(content => Handlebars.registerPartial("code/phases/plan/rules-plan", content))
    .catch(() => {}),
]).catch(() => {});

// ✅ Register design/phases/decompose partials (System Design and UI Design)
const designDecomposePath = join(__dirname, "../../../core/prompt/templates/design/phases/decompose");
Promise.all([
  fs.readFile(join(designDecomposePath, "rules-system-design.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/decompose/rules-system-design", content))
    .catch(() => {}),
  fs.readFile(join(designDecomposePath, "rules-ui-design.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/decompose/rules-ui-design", content))
    .catch(() => {}),
]).catch(() => {});

// ✅ Register design/phases/execute partials (UI design and system design)
const designExecutePath = join(__dirname, "../../../core/prompt/templates/design/phases/execute");
Promise.all([
  // Rules partials
  fs.readFile(join(designExecutePath, "rules-ui-design.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/rules-ui-design", content))
    .catch(() => {}),
  fs.readFile(join(designExecutePath, "rules-system-design.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/rules-system-design", content))
    .catch(() => {}),
  // UI design injections
  fs.readFile(join(designExecutePath, "injections/ui-tokens-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/injections/ui-tokens-guide", content))
    .catch(() => {}),
  fs.readFile(join(designExecutePath, "injections/ui-assets-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/injections/ui-assets-guide", content))
    .catch(() => {}),
  fs.readFile(join(designExecutePath, "injections/ui-spec-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/injections/ui-spec-guide", content))
    .catch(() => {}),
  // System design injections (existing)
  fs.readFile(join(designExecutePath, "injections/game-domain-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/injections/game-domain-guide", content))
    .catch(() => {}),
  fs.readFile(join(designExecutePath, "injections/service-domain-guide.md"), "utf8")
    .then(content => Handlebars.registerPartial("design/phases/execute/injections/service-domain-guide", content))
    .catch(() => {}),
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
    const handlebarsKeywords = ['if', 'unless', 'each', 'with', 'else', 'this'];  // ✅ 'this' is special keyword in {{#each}} blocks
    const handlebarsHelpers = ['eq', 'ne', 'and', 'or', 'add'];  // ✅ Registered helpers
    const templateVars = (usedVars as string[]).filter(v => 
      !handlebarsKeywords.includes(v) && !handlebarsHelpers.includes(v)
    );
    
    // ✅ Only validate variables that would actually be rendered
    // To avoid false positives from conditional blocks, only warn if:
    // 1. Variable is used outside conditionals, OR
    // 2. The condition for that variable is true in provided vars
    const shouldValidate = (varName: string): boolean => {
      // Check if variable is inside a conditional block
      const conditionalPattern = new RegExp(`\\{\\{#if\\s+(\\w+)[^}]*\\}\\}[\\s\\S]*?\\{\\{${varName}[^}]*\\}\\}[\\s\\S]*?\\{\\{\\/if\\}\\}`, 'g');
      const conditionalMatch = templateSource.match(conditionalPattern);
      
      if (!conditionalMatch) {
        // Not in conditional, should validate
        return true;
      }
      
      // Extract condition variable
      const conditionMatch = conditionalMatch[0].match(/\{\{#if\s+(\w+)/);
      if (!conditionMatch) return true;
      
      const conditionVar = conditionMatch[1];
      // Only validate if condition is true in provided vars
      return !!vars[conditionVar];
    };
    
    const varsToValidate = templateVars.filter(shouldValidate);
    const missingVars = varsToValidate.filter(v => !(v in vars));
    const providedVars = Object.keys(vars);
    const unusedVars = providedVars.filter(v => !templateVars.includes(v));
    
    // 5. Log warnings for maintenance (only for actually missing vars)
    if (missingVars.length > 0) {
      console.warn(`[PromptAdapter] Template "${templateName}": Missing variables [${missingVars.join(', ')}]`);
    }
    // ✅ Don't warn about unused vars - they might be for other conditional branches
    // if (unusedVars.length > 0) {
    //   console.warn(`[PromptAdapter] Template "${templateName}": Unused variables [${unusedVars.join(', ')}]`);
    // }
    
    // 6. Render template with Handlebars
    return template(vars);
  }
}

