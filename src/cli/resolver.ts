import fs from "fs";
import path from "path";

/**
 * Auto-detect project name from path
 * Example: workspace/test-app/... → test-app
 */
export function detectProject(inputPath: string): string {
  const parts = inputPath.split(path.sep);
  
  // Look for workspace/project-name pattern
  const workspaceIdx = parts.indexOf("workspace");
  if (workspaceIdx >= 0 && workspaceIdx + 1 < parts.length) {
    return parts[workspaceIdx + 1];
  }
  
  // Legacy: projects/project-name pattern
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
 * Resolve input file based on task
 * - For design: finds PRD in inputs/sources/prd.md
 * - For code: finds latest design + optional code directive
 * - For learn: finds learn directive
 */
export function resolveInputFile(inputPath: string, task: 'design' | 'code' | 'learn'): string {
  const stats = fs.statSync(inputPath);
  
  if (stats.isFile()) {
    return inputPath;
  }
  
  if (stats.isDirectory()) {
    switch (task) {
      case 'design': {
        // Design task: automatically find and combine ALL PRD files in sources/
        const sourcesDir = path.join(inputPath, "inputs", "sources");
        
        if (fs.existsSync(sourcesDir)) {
          const files = fs.readdirSync(sourcesDir);
          const mdFiles = files
            .filter(f => f.endsWith('.md') && !f.endsWith('.tmp.md')) // Exclude temporary files
            .sort(); // Alphabetical order for consistency
          
          if (mdFiles.length > 0) {
            // Create a temporary combined PRD file
            const combinedContent: string[] = [];
            
            for (const mdFile of mdFiles) {
              const filePath = path.join(sourcesDir, mdFile);
              const content = fs.readFileSync(filePath, 'utf-8');
              
              // Add file header for multi-file PRDs
              if (mdFiles.length > 1) {
                combinedContent.push(`\n<!-- Source: ${mdFile} -->\n`);
              }
              combinedContent.push(content.trim());
            }
            
            // Write to temporary combined file
            const tmpFile = path.join(sourcesDir, '.combined-prd.tmp.md');
            fs.writeFileSync(tmpFile, combinedContent.join('\n\n'));
            
            console.log(`📄 Using ${mdFiles.length} PRD file(s):`);
            mdFiles.forEach(f => console.log(`   - ${f}`));
            
            return tmpFile;
          }
        }
        
        // If no PRD files, check for design directive
        const designDirPath = path.join(inputPath, "inputs", "directives", "design");
        const directiveFile = findLatestDirective(designDirPath);
        if (directiveFile) {
          console.log(`📄 Using design directive: ${directiveFile}`);
          return directiveFile;
        }
        
        throw new Error(
          `No input found for design task in: ${inputPath}\n` +
          `Expected:\n` +
          `  - At least one .md file in ${path.join(inputPath, "inputs/sources/")}\n` +
          `  - OR a directive in ${path.join(inputPath, "inputs/directives/design/")}`
        );
      }
      
      case 'code': {
        // Code task: look for design document (preferred) or directive (fallback)
        
        // 1. Try to find design document
        const designDir = path.join(inputPath, "outputs", "design");
        if (fs.existsSync(designDir)) {
          const files = fs.readdirSync(designDir);
          const designFiles = files
            .filter(f => f.startsWith("design-") && f.endsWith(".md"))
            .sort()
            .reverse();
          
          if (designFiles.length > 0) {
            const latestDesign = path.join(designDir, designFiles[0]);
            console.log(`📄 Using design file: ${latestDesign}`);
            
            // Optional: check for code directive
            const codeDir = path.join(inputPath, "inputs", "directives", "code");
            const directiveFile = findLatestDirective(codeDir);
            if (directiveFile) {
              console.log(`📄 Found code directive: ${directiveFile}`);
            }
            
            return latestDesign;
          }
        }
        
        // 2. No design found, look for code directive
        const codeDir = path.join(inputPath, "inputs", "directives", "code");
        const directiveFile = findLatestDirective(codeDir);
        if (directiveFile) {
          console.log(`📄 Using code directive: ${directiveFile}`);
          return directiveFile;
        }
        
        // 3. Neither found - error
        throw new Error(
          `No design document or directive found for code task.\n` +
          `Expected:\n` +
          `  - Design file in ${designDir}\n` +
          `  OR\n` +
          `  - Directive in ${codeDir}\n\n` +
          `For new features: Run 'architect design' first.\n` +
          `For modifications: Create directive.md in inputs/directives/code/`
        );
      }
      
      case 'learn': {
        // Learn task: find learn directive
        const learnDir = path.join(inputPath, "inputs", "directives", "learn");
        const directiveFile = findLatestDirective(learnDir);
        
        if (!directiveFile) {
          throw new Error(
            `No directive files found in: ${learnDir}\n` +
            `Create either directive.md or directive-N.md`
          );
        }
        
        console.log(`📄 Using learn directive: ${directiveFile}`);
        return directiveFile;
      }
      
      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }
  
  throw new Error(`Invalid input path: ${inputPath}`);
}

