import * as path from "path";
import * as fs from "fs";
import { DirectiveType, DIRECTIVE_TYPES, ProjectContext } from "./types";

export function extractFeatureFolder(inputFile: string | undefined, project: string): string {
  if (!inputFile) return "";
  
  const parts = inputFile.split(path.sep);
  const projectIdx = parts.findIndex(p => p === project);
  if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
    return parts[projectIdx + 1];
  }
  return "";
}

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

export function readDirective(directivesPath: string, type: DirectiveType): string | null {
  if (!fs.existsSync(directivesPath)) return null;

  const files = fs.readdirSync(directivesPath)
    .filter(f => f.startsWith("directive-") && f.endsWith(".md"))
    .map(f => {
      const match = f.match(/directive-(\d+)\.md$/);
      return match ? { name: f, number: parseInt(match[1]) } : null;
    })
    .filter((item): item is {name: string, number: number } => item !== null)
    .sort((a, b) => b.number - a.number);

  if (files.length > 0) {
    return fs.readFileSync(path.join(directivesPath, files[0].name), "utf8");
  }

  const defaultFile = path.join(directivesPath, "directive.md");
  if (fs.existsSync(defaultFile)) {
    return fs.readFileSync(defaultFile, "utf8");
  }

  return null;
}

export function findLatestDesign(context: ProjectContext): string {
  const designPath = path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder || "default",
    "generated",
    "design"
  );
  
  if (!fs.existsSync(designPath)) return "";
  
  const designFiles = fs.readdirSync(designPath)
    .filter(f => f.startsWith("design-") && f.endsWith(".md"))
    .sort()
    .reverse();
  
  if (designFiles.length === 0) return "";
  
  return fs.readFileSync(path.join(designPath, designFiles[0]), "utf8");
}

export function generateReport(
  type: string,
  context: ProjectContext,
  content: string,
  metadata: Record<string, any> = {}
): string {
  const reportDir = path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder || "default",
    "generated",
    "reports"
  );
  fs.mkdirSync(reportDir, { recursive: true });
  
  const reportFile = path.join(reportDir, `${type}-report-${Date.now()}.md`);
  fs.writeFileSync(reportFile, content, "utf8");
  
  return reportFile;
}

export function extractRequiredIntegrationsFromDesign(designMarkdown: string, planMarkdown?: string): string[] {
  const names = new Set<string>();
  const sources = [designMarkdown || '', planMarkdown || ''];

  for (const src of sources) {
    // 1) Backticked identifiers like `TabMenu`, `ErrorBoundary`, `SessionProvider`
    const tickRe = /`([A-Z][A-Za-z0-9]+(?:Provider|Context|Hook)?)`/g;
    let m: RegExpExecArray | null;
    while ((m = tickRe.exec(src)) !== null) {
      names.add(m[1]);
    }

    // 2) JSX-like usage e.g., <TabMenu ...>, <SessionProvider>
    const jsxRe = /<([A-Z][A-Za-z0-9]+)\b/g;
    while ((m = jsxRe.exec(src)) !== null) {
      names.add(m[1]);
    }

    // 3) Import mentions e.g., import { TabMenu } from '...'; import SessionProvider from '...'
    const impRe = /import\s+(?:\{\s*)?([A-Z][A-Za-z0-9]+)(?:\s*,\s*[A-Z][A-Za-z0-9]+)*\s*(?:\}|)\s*from\s*['"][^'"]+['"]/g;
    while ((m = impRe.exec(src)) !== null) {
      names.add(m[1]);
    }

    // 4) Bullet or directive style mentions like: - Use TabMenu component
    const bulletRe = /\bUse\s+([A-Z][A-Za-z0-9]+)\s+(?:component|provider|hook)\b/gi;
    while ((m = bulletRe.exec(src)) !== null) {
      names.add(m[1]);
    }
  }

  return Array.from(names);
}
