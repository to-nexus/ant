import { promises as fs } from "fs";
import { join } from "path";
import Handlebars from "handlebars";
import { PromptPort } from "../../../core/ports";

/**
 * FilePromptAdapter - File system implementation of PromptPort
 * Loads template files and renders with Handlebars template engine
 * 
 * Templates are stored in src/core/prompt/templates/ (domain knowledge)
 * 
 * Supports:
 * - Variable substitution: {{variableName}}
 * - Conditionals: {{#if variable}}...{{else}}...{{/if}}
 * - Iteration: {{#each array}}...{{/each}}
 */
export class FilePromptAdapter implements PromptPort {
  constructor(private baseDir = join(process.cwd(), "src", "core", "prompt", "templates")) {}
  
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

