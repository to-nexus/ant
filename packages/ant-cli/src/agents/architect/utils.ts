/**
 * Architect Utilities
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations (not fs directly)
 * - All functions accept gitPort parameter
 */

import * as path from "path";
import { ProjectContext, DirectiveType, AgentTask } from "./types";
import { GitPort } from "../../core/ports";

export function extractFeatureFolder(inputFile: string | undefined, project: string): string {
  if (!inputFile) return "";
  
  const parts = inputFile.split(path.sep);
  const projectIdx = parts.findIndex(p => p === project);
  if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
    return parts[projectIdx + 1];
  }
  return "";
}

/**
 * Get directive for a specific task
 * Priority: directive.md > directive-nnn.md (latest)
 */
export async function getDirective(context: ProjectContext, task: AgentTask, gitPort: GitPort): Promise<string | null> {
  const directiveDir = path.join(
    "workspace",
    context.project,
    context.featureFolder,
    "inputs/directives",
    task
  );

  const exists = await gitPort.fileExists(directiveDir);
  if (!exists) {
    return null;
  }

  // 1. Check directive.md (default)
  const defaultPath = path.join(directiveDir, "directive.md");
  const defaultExists = await gitPort.fileExists(defaultPath);
  if (defaultExists) {
    const content = await gitPort.readFile(defaultPath);
    if (content && content.trim().length > 0) {
      return content.trim();
    }
  }

  // 2. Find latest directive-nnn.md
  const entries = await gitPort.readDirectory(directiveDir);
  const files = entries
    .filter(e => !e.isDirectory && /^directive-\d+\.md$/.test(e.name))
    .map(e => {
      const match = e.name.match(/^directive-(\d+)\.md$/);
      return match ? { name: e.name, number: parseInt(match[1]) } : null;
    })
    .filter((item): item is { name: string; number: number } => item !== null)
    .sort((a, b) => b.number - a.number);

  if (files.length > 0) {
    const content = await gitPort.readFile(path.join(directiveDir, files[0].name));
    if (content && content.trim().length > 0) {
      return content.trim();
    }
  }

  return null;
}

// Legacy support - will be removed after migration
export function getDirectivePath(context: ProjectContext, type: DirectiveType): string {
  return path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder,
    "directives",
    type
  );
}

export async function readDirective(directivesPath: string, type: DirectiveType, gitPort: GitPort): Promise<string | null> {
  const exists = await gitPort.fileExists(directivesPath);
  if (!exists) return null;

  const entries = await gitPort.readDirectory(directivesPath);
  const files = entries
    .filter(e => !e.isDirectory && e.name.startsWith("directive-") && e.name.endsWith(".md"))
    .map(e => {
      const match = e.name.match(/directive-(\d+)\.md$/);
      return match ? { name: e.name, number: parseInt(match[1]) } : null;
    })
    .filter((item): item is {name: string, number: number } => item !== null)
    .sort((a, b) => b.number - a.number);

  if (files.length > 0) {
    const content = await gitPort.readFile(path.join(directivesPath, files[0].name));
    if (content && content.trim().length > 0) {
      return content.trim();
    }
  }

  const defaultFile = path.join(directivesPath, "directive.md");
  const defaultExists = await gitPort.fileExists(defaultFile);
  if (defaultExists) {
    const content = await gitPort.readFile(defaultFile);
    if (content && content.trim().length > 0) {
      return content.trim();
    }
  }

  return null;
}

/**
 * Get source materials (PRD + all resources)
 * Shared by all tasks (design, code, learn)
 */
export async function getSource(context: ProjectContext, gitPort: GitPort): Promise<{
  prd?: string;
  figmaLink?: string;
  figmaData?: any;
  wireframes?: string[];
}> {
  const result: any = {};
  const sourceDir = path.join("workspace", context.project, context.featureFolder, "inputs/sources");
  
  const sourceDirExists = await gitPort.fileExists(sourceDir);
  if (!sourceDirExists) {
    return result;
  }

  // Load PRD
  const prdPath = path.join(sourceDir, "prd.md");
  const prdExists = await gitPort.fileExists(prdPath);
  if (!prdExists) {
    return result;
  }
  const prd = await gitPort.readFile(prdPath);
  if (!prd) {
    return result;
  }
  result.prd = prd;

  // Load Figma link
  const figmaPath = path.join(sourceDir, "figma.link");
  const figmaExists = await gitPort.fileExists(figmaPath);
  if (figmaExists) {
    const link = await gitPort.readFile(figmaPath);
    if (link) {
      result.figmaLink = link.trim();
    }
  }

  // Load Figma export data
  const figmaExportPath = path.join(sourceDir, "figma-export.json");
  const figmaExportExists = await gitPort.fileExists(figmaExportPath);
  if (figmaExportExists) {
    const data = await gitPort.readFile(figmaExportPath);
    if (data) {
      result.figmaData = JSON.parse(data);
    }
  }

  // Load wireframes
  const wireframesDir = path.join(sourceDir, "wireframes");
  const wireframesDirExists = await gitPort.fileExists(wireframesDir);
  if (wireframesDirExists) {
    const entries = await gitPort.readDirectory(wireframesDir);
    result.wireframes = entries
      .filter(e => !e.isDirectory && /\.(png|jpg|jpeg|svg)$/i.test(e.name))
      .map(e => e.name);
  }

  return result;
}

/**
 * Find latest design document
 */
export async function findLatestDesign(context: ProjectContext, gitPort: GitPort): Promise<string | null> {
  const designPath = path.join("workspace", context.project, context.featureFolder, "outputs/design");

  const exists = await gitPort.fileExists(designPath);
  if (!exists) return "";

  const entries = await gitPort.readDirectory(designPath);
  const designFiles = entries
    .filter(e => !e.isDirectory && e.name.startsWith("design-") && e.name.endsWith(".md"))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (designFiles.length === 0) return "";

  const content = await gitPort.readFile(path.join(designPath, designFiles[0].name));
  return content || "";
}

/**
 * Write report file
 */
export async function writeReportFile(
  context: ProjectContext,
  fileName: string,
  content: string,
  gitPort: GitPort
): Promise<string> {
  const reportDir = path.join("workspace", context.project, context.featureFolder, "outputs/reports");
  await gitPort.createDirectory(reportDir);
  
  const reportFile = path.join(reportDir, fileName);
  await gitPort.writeFile(reportFile, content);
  
  return reportFile;
}
