import fs from "fs";
import path from "path";

/**
 * Auto-detect project name from path
 * Example: projects/cross-ramp/... → cross-ramp
 */
export function detectProject(inputPath: string): string {
  const parts = inputPath.split(path.sep);
  const projectsIdx = parts.indexOf("projects");
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    return parts[projectsIdx + 1];
  }
  return "default";
}

/**
 * Find latest directive file in directory with non-empty content
 * Prioritizes: directive-N.md (highest N) > directive.md
 * Returns null if file exists but is empty
 */
export function findLatestDirective(dirPath: string): string | null {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const files = fs.readdirSync(dirPath);
  
  // 1. directive-N.md 파일 찾기 (가장 높은 번호, 내용이 있는 것만)
  const numberedFiles = files
    .filter(f => f.startsWith("directive-") && f.endsWith(".md"))
    .map(f => {
      const match = f.match(/directive-(\d+)\.md$/);
      return match ? { name: f, number: parseInt(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.number - a!.number);

  for (const file of numberedFiles) {
    const filePath = path.join(dirPath, file!.name);
    const content = fs.readFileSync(filePath, "utf8").trim();
    if (content.length > 0) {
      return filePath;
    }
  }

  // 2. directive.md 찾기 (내용이 있는 경우만)
  const defaultFile = files.find(f => f === "directive.md");
  if (defaultFile) {
    const filePath = path.join(dirPath, defaultFile);
    const content = fs.readFileSync(filePath, "utf8").trim();
    if (content.length > 0) {
      return filePath;
    }
  }

  return null;
}

/**
 * Resolve input file based on mode
 * - For arch-learn: finds learn directive
 * - For arch-code: finds latest design + optional code directive
 * - For others: finds latest design
 */
export function resolveInputFile(inputPath: string, mode: string): string {
  const stats = fs.statSync(inputPath);
  
  if (stats.isFile()) {
    return inputPath;
  }
  
  if (stats.isDirectory()) {
    switch (mode) {
      case 'arch-learn': {
        const learnDir = path.join(inputPath, "directives", "learn");
        const directiveFile = findLatestDirective(learnDir);
        
        if (!directiveFile) {
          throw new Error(`No directive files found in: ${learnDir}\nCreate either directive.md or directive-N.md`);
        }
        
        console.log(`📄 Using learn directive: ${directiveFile}`);
        return directiveFile;
      }
      
      case 'arch-code': {
        const designDir = path.join(inputPath, "generated", "design");
        if (!fs.existsSync(designDir)) {
          throw new Error(`No generated/design/ directory found in: ${inputPath}`);
        }
        
        const files = fs.readdirSync(designDir);
        const designFiles = files
          .filter(f => f.startsWith("design-") && f.endsWith(".md"))
          .sort()
          .reverse();
        
        if (designFiles.length === 0) {
          throw new Error(`No design-*.md files found in: ${designDir}`);
        }
        
        const latestDesign = path.join(designDir, designFiles[0]);
        console.log(`📄 Using design file: ${latestDesign}`);
        
        const codeDir = path.join(inputPath, "directives", "code");
        const directiveFile = findLatestDirective(codeDir);
        if (directiveFile) {
          console.log(`📄 Found code directive: ${directiveFile}`);
        }
        
        return latestDesign;
      }
      
      default: {
        const designDir = path.join(inputPath, "generated", "design");
        if (!fs.existsSync(designDir)) {
          throw new Error(`No generated/design/ directory found in: ${inputPath}`);
        }
        
        const files = fs.readdirSync(designDir);
        const designFiles = files
          .filter(f => f.startsWith("design-") && f.endsWith(".md"))
          .sort()
          .reverse();
        
        if (designFiles.length === 0) {
          throw new Error(`No design-*.md files found in: ${designDir}`);
        }
        
        const latestDesign = path.join(designDir, designFiles[0]);
        console.log(`📄 Using design file: ${latestDesign}`);
        return latestDesign;
      }
    }
  }
  
  throw new Error(`Invalid input path: ${inputPath}`);
}

