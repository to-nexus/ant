import { promises as fs } from "fs";
import { join } from "path";
import { PromptPort } from "../../../core/ports";

/**
 * FilePromptAdapter - File system implementation of PromptPort
 * Loads template files and renders with variable substitution
 */
export class FilePromptAdapter implements PromptPort {
  constructor(private baseDir = join(process.cwd(), "src", "agents", "architect", "prompt", "templates")) {}
  
  async render(templateName: string, vars: Record<string, any>): Promise<string> {
    // 1. Load template from file
    const file = join(this.baseDir, `${templateName}.md`);
    const template = await fs.readFile(file, "utf8");
    
    // 2. Render variables (replace {{key}} with values)
    return Object.keys(vars).reduce((acc, key) => {
      const val = (vars[key] ?? "").toString();
      return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    }, template);
  }
}

