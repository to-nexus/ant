import { promises as fs } from "fs";
import { join } from "path";
import { PromptPort } from "../../../core/ports";

/**
 * FilePromptAdapter - File system implementation of PromptPort
 * Loads template files and renders with variable substitution
 */
export class FilePromptAdapter implements PromptPort {
  constructor(private baseDir = join(process.cwd(), "src", "agents", "architect", "prompts")) {}
  
  async render(templateName: string, vars: Record<string, any>): Promise<string> {
    // 1. Load template from file
    const file = join(this.baseDir, `${templateName}.md`);
    const template = await fs.readFile(file, "utf8");
    
    // 2. Extract variables used in template
    const usedVarsMatches = template.match(/\{\{(\w+)\}\}/g);
    const usedVars = usedVarsMatches 
      ? [...new Set(usedVarsMatches.map(v => v.replace(/[{}]/g, '')))]
      : [];
    
    // 3. Validate variables
    const missingVars = usedVars.filter(v => !(v in vars));
    const providedVars = Object.keys(vars);
    const unusedVars = providedVars.filter(v => !usedVars.includes(v));
    
    // 4. Log warnings for maintenance
    if (missingVars.length > 0) {
      console.warn(`[PromptAdapter] Template "${templateName}": Missing variables [${missingVars.join(', ')}]`);
    }
    if (unusedVars.length > 0) {
      console.warn(`[PromptAdapter] Template "${templateName}": Unused variables [${unusedVars.join(', ')}]`);
    }
    
    // 5. Render variables (replace {{key}} with values)
    return usedVars.reduce((acc, key) => {
      const val = (vars[key] ?? "").toString();
      return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    }, template);
  }
}

