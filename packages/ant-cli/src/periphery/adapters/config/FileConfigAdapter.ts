import fs from "fs";
import path from "path";
import { ConfigPort } from "../../../core/ports";

/**
 * FileConfigAdapter - File system implementation of ConfigPort
 * Loads project configuration from config.json files
 */
export class FileConfigAdapter implements ConfigPort {
  async load(project: string): Promise<any> {
    // ✅ Require ANT_PROJECT_PATH - no fallback
    const projectPath = process.env.ANT_PROJECT_PATH;
    
    if (!projectPath) {
      throw new Error(
        'ANT_PROJECT_PATH environment variable is required.\n' +
        'This should be set by the HTTP server when spawning CLI processes.\n' +
        'Use WorkspaceResolver.getProjectPath() to generate the correct path.'
      );
    }
    
    const configPath = path.join(projectPath, "config.json");
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`No config.json for project: ${project}\nExpected at: ${configPath}`);
    }
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
}

