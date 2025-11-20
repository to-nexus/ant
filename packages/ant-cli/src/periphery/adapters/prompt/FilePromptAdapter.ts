import { promises as fs } from "fs";
import { join, dirname } from "path";
import Handlebars from "handlebars";
import { PromptPort } from "../../../core/ports";

// ✅ Register helpers once (top-level, not per render call)
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("ne", (a, b) => a !== b);
Handlebars.registerHelper("and", (a, b) => a && b);
Handlebars.registerHelper("or", (a, b) => a || b);

// ✅ Register base partials (shared templates)
const basePartialsPath = join(__dirname, "../../../core/prompt/templates/base");
Promise.all([
  fs.readFile(join(basePartialsPath, "output-format-markdown.md"), "utf8")
    .then(content => Handlebars.registerPartial("base/output-format-markdown", content))
    .catch(() => {}),  // Graceful degradation
  fs.readFile(join(basePartialsPath, "text-response-format.md"), "utf8")
    .then(content => Handlebars.registerPartial("base/text-response-format", content))
    .catch(() => {}),  // Graceful degradation
  fs.readFile(join(basePartialsPath, "tool-calling-rules.md"), "utf8")
    .then(content => Handlebars.registerPartial("base/tool-calling-rules", content))
    .catch(() => {}),  // Graceful degradation
  fs.readFile(join(basePartialsPath, "architect-role.md"), "utf8")
    .then(content => Handlebars.registerPartial("base/architect-role", content))
    .catch(() => {})   // Graceful degradation
]);

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
          // Extract variable name from {{var}}, {{#if var}}, {{/if}}, etc.
          const match = v.match(/\{\{[\#\/]?(\w+)/);
          return match ? match[1] : null;
        }).filter(Boolean))]
      : [];
    
    // 4. Validate variables (filter out Handlebars keywords)
    const handlebarsKeywords = ['if', 'unless', 'each', 'with', 'else'];
    const templateVars = (usedVars as string[]).filter(v => !handlebarsKeywords.includes(v));
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

