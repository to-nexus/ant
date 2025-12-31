import { promises as fs } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ProfilePort } from "../../../core/ports";

/**
 * FileProfileAdapter - File system implementation of ProfilePort
 * 
 * Loads language and framework profiles from markdown files in periphery/profiles/
 * Returns empty string if profile not found (graceful degradation)
 */
export class FileProfileAdapter implements ProfilePort {
  private baseDir: string;
  
  constructor(baseDir?: string) {
    if (baseDir) {
      this.baseDir = baseDir;
    } else {
      // ✅ Resolve path relative to THIS file
      // From adapters/profile/ go up to periphery/profiles/
      // Works in both src/ (development) and dist/ (production)
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      this.baseDir = join(__dirname, "..", "..", "profiles");
    }
  }
  
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

