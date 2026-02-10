import fs from "fs";
import path from "path";
import { getSessionFilePathByJob } from '../core/utils/sessionPaths';

/**
 * Auto-detect project name from path
 * 
 * Supports multiple path patterns:
 * - workspaces/local/user/<project>/... → project
 * - workspaces/<org>/<user>/<project>/... → project
 * - workspace/<project>/... → project (legacy, deprecated)
 * - projects/<project>/... → project (legacy, deprecated)
 */
export function detectProject(inputPath: string): string {
  const parts = inputPath.split(path.sep);
  
  // ✅ Modern: workspaces/local/user/<project> or workspaces/<org>/<user>/<project>
  const workspacesIdx = parts.indexOf("workspaces");
  if (workspacesIdx >= 0) {
    // Local mode: workspaces/local/user/<project>
    if (parts[workspacesIdx + 1] === "local" && parts[workspacesIdx + 2] === "user" && parts[workspacesIdx + 3]) {
      return parts[workspacesIdx + 3];
    }
    // Cloud mode: workspaces/<org>/<user>/<project>
    if (parts[workspacesIdx + 3]) {
      return parts[workspacesIdx + 3];
    }
  }
  
  // Fallback: workspace/<project> (singular)
  const workspaceIdx = parts.indexOf("workspace");
  if (workspaceIdx >= 0 && workspaceIdx + 1 < parts.length) {
    return parts[workspaceIdx + 1];
  }
  
  // Fallback: projects/<project>
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
 * 
 * ✅ Resume Support: Skips validation if session exists with taskQueue
 */
export function resolveInputFile(inputPath: string, task: 'design' | 'code' | 'learn'): string {
  const stats = fs.statSync(inputPath);
  
  if (stats.isFile()) {
    return inputPath;
  }
  
  if (stats.isDirectory()) {
    // ✅ CRITICAL: Check for resume scenario (session exists with taskQueue OR overrideDirective)
    // If resuming, we don't need design/directive files
    if (task === 'code' || task === 'learn') {
      const sessionPath = getSessionFilePathByJob(inputPath, task);
      if (fs.existsSync(sessionPath)) {
        try {
          const sessionContent = fs.readFileSync(sessionPath, 'utf-8');
          const session = JSON.parse(sessionContent);
          
          // ✅ Check multiple resume scenarios:
          // 1. Session has taskQueue with remaining tasks (work in progress)
          // 2. Session has overrideDirective from chat (new work from chat)
          // 3. Session has directives array (previous work with directive)
          const hasTaskQueue = session.state?.taskQueue && 
                               Array.isArray(session.state.taskQueue) && 
                               session.state.taskQueue.length > 0;
          
          const hasOverrideDirective = session.state?.overrideDirective && 
                                       typeof session.state.overrideDirective === 'string' &&
                                       session.state.overrideDirective.trim().length > 0;
          
          const hasDirectives = session.state?.directives && 
                               Array.isArray(session.state.directives) &&
                               session.state.directives.length > 0;
          
          const hasChatSource = session.state?.chatSource === true;
          
          if (hasTaskQueue || hasOverrideDirective || (hasDirectives && hasChatSource)) {
            console.log(`\n🔄 [Resolver] Resuming ${task} job from session`);
            if (hasTaskQueue) {
              console.log(`   Task queue: ${session.state.taskQueue.length} tasks remaining`);
            }
            if (hasOverrideDirective) {
              console.log(`   Override directive: ${session.state.overrideDirective.substring(0, 50)}...`);
            }
            if (hasDirectives) {
              console.log(`   Directives: ${session.state.directives.length} directive(s)`);
            }
            console.log(`   Completed: ${session.state.completedTasksDetails?.length || session.state.completedTasks?.length || 0} tasks\n`);
            
            // ✅ Return empty string to signal "resume mode" (no file validation needed)
            return '';
          }
        } catch (error) {
          // Session file exists but couldn't parse - continue with normal flow
          console.warn(`⚠️  [Resolver] Failed to parse session file: ${error}`);
        }
      }
    }
    
    switch (task) {
      case 'design': {
        // Design task: PRD must be a single canonical file: prd.md
        const sourcesDir = path.join(inputPath, "inputs", "sources");
        
        if (fs.existsSync(sourcesDir)) {
          const canonical = path.join(sourcesDir, 'prd.md');
          if (fs.existsSync(canonical)) {
            console.log(`📄 Using PRD: prd.md`);
            return canonical;
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

