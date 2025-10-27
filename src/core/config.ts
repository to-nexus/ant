import fs from "fs";
import path from "path";

export async function loadProjectConfig(project: string): Promise<any> {
  const configPath = path.join(process.cwd(), "projects", project, "config.json");
  if (!fs.existsSync(configPath)) throw new Error(`No config.json for project: ${project}`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}
