import { promises as fs } from "fs";
import { join } from "path";
import { ProfilePort } from "../../../core/ports";

/**
 * FileProfileAdapter - File system implementation of ProfilePort
 * 
 * Loads language and framework profiles from markdown files in periphery/profiles/
 * Returns empty string if profile not found (graceful degradation)
 */
export class FileProfileAdapter implements ProfilePort {
  constructor(
    private baseDir = join(process.cwd(), "src", "periphery", "profiles")
  ) {}
  
  /**
   * Load language profile from file
   * Returns empty string if not found (graceful degradation)
   */
  async loadLanguage(language: string): Promise<string> {
    try {
      const filePath = join(this.baseDir, "languages", `${language}.md`);
      const content = await fs.readFile(filePath, "utf8");
      return content;
    } catch (error) {
      // Profile not found - return empty string for graceful degradation
      console.warn(`[ProfileAdapter] Language profile not found: ${language}`);
      return '';
    }
  }
  
  /**
   * Load framework profile from file
   * Returns empty string if not found (graceful degradation)
   */
  async loadFramework(framework: string): Promise<string> {
    try {
      const filePath = join(this.baseDir, "frameworks", `${framework}.md`);
      const content = await fs.readFile(filePath, "utf8");
      return content;
    } catch (error) {
      // Profile not found - return empty string for graceful degradation
      console.warn(`[ProfileAdapter] Framework profile not found: ${framework}`);
      return '';
    }
  }
}

