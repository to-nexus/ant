import { promises as fs } from "fs";
import { join } from "path";
import { PromptLoader } from "../../../core/ports";

/**
 * FilePromptAdapter - File system implementation of PromptLoader port
 * Loads prompt template files from the filesystem
 */
export class FilePromptAdapter implements PromptLoader {
  constructor(private baseDir = join(process.cwd(), "src", "agents", "architect", "prompt", "templates")) {}
  
  async load(name: string): Promise<string> {
    const file = join(this.baseDir, `${name}.md`);
    return await fs.readFile(file, "utf8");
  }
}

