import fs from "fs";
import path from "path";
import { ConfigPort } from "../../../core/ports";
import { getDefaultWorkspaceConfig } from "../../../core/types/workspace";

/**
 * FileConfigAdapter - File system implementation of ConfigPort
 * Loads project configuration from config.json files.
 * Merges user config with defaults so that newly added model/settings
 * entries are always available even in legacy project configs.
 */
export class FileConfigAdapter implements ConfigPort {
  async load(project: string): Promise<any> {
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

    const userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const defaults = getDefaultWorkspaceConfig(userConfig.projectName || project);
    return deepMergeConfig(defaults, userConfig);
  }
}

/**
 * Recursively merge two config objects. User values override defaults.
 * - Primitives / arrays: user value wins when present
 * - Objects: recursively merged so partial overrides work
 *   e.g. user sets llmModels.visual.sketch only → render still gets default
 * - null / undefined in user config are skipped (treated as "not set")
 */
function deepMergeConfig(defaults: any, user: any): any {
  if (user === null || user === undefined) return defaults;
  if (defaults === null || defaults === undefined) return user;

  if (typeof defaults !== 'object' || typeof user !== 'object') return user;
  if (Array.isArray(defaults) || Array.isArray(user)) return user;

  const merged: any = { ...defaults };
  for (const key of Object.keys(user)) {
    const uVal = user[key];
    if (uVal === null || uVal === undefined) continue;
    merged[key] = deepMergeConfig(defaults[key], uVal);
  }
  return merged;
}

