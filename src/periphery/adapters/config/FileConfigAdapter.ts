import fs from "fs";
import path from "path";
import { ConfigPort } from "../../../core/ports";

/**
 * FileConfigAdapter - File system implementation of ConfigPort
 * Loads project configuration from config.json files
 */
export class FileConfigAdapter implements ConfigPort {
  async load(project: string): Promise<any> {
    const configPath = path.join(process.cwd(), "workspace", project, "config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(`No config.json for project: ${project}\nExpected at: ${configPath}`);
    }
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
}

