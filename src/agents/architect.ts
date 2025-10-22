import { ChatAnthropic } from "@langchain/anthropic";
import {
  loadProjectGitConfig,
  getGitInstance,
  createBranch,
  commitAndPush,
  stageOnly,
  openPullRequest
} from "../tools/git";
import { queryMemory, storeMemory } from "../memory/chroma";
import path from "path";
import fs from "fs";

/**
 * ArchitectAgent (Claude 3.5 Sonnet)
 * 
 * Two modes:
 * 1. arch-design: PRD → System design document (saved locally, no Git)
 * 2. arch-code: Design document → Actual code (staged to target repo)
 */

const model = new ChatAnthropic({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-haiku-20240307",
  temperature: 0.2,
  maxTokens: 4000
});

export async function architectAgent(
  spec: string, 
  project: string,
  mode: 'design' | 'code' = 'design',
  inputFile?: string
) {
  const context = await queryMemory("architecture principles", project);
  const config = await loadProjectGitConfig(project);

  if (mode === 'design') {
    // === Stage 1: Generate system design (save to this project, no Git) ===
    
    // Extract feature folder from inputFile
    // Example: projects/cross-ramp/feature-ui-1.2.0/prd/spec.md
    let featureFolder = "";
    if (inputFile) {
      const parts = inputFile.split(path.sep);
      const projectIdx = parts.findIndex(p => p === project);
      if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
        featureFolder = parts[projectIdx + 1]; // feature-ui-1.2.0
      }
    }
    
    // Read existing codebase from target repo
    let existingCode = "";
    try {
      const repoPath = config.localPath;
      
      // Read root package.json for tech stack info
      const pkgJsonPath = path.join(repoPath, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        existingCode += `\n## Current Tech Stack (root package.json):\n`;
        if (pkgJson.dependencies) {
          existingCode += `Dependencies: ${Object.keys(pkgJson.dependencies).slice(0, 20).join(", ")}\n`;
        }
      }
      
      // Helper function to list files recursively
      const listFiles = (dir: string, prefix = "", depth = 0): string[] => {
        if (depth > 3) return []; // Limit depth
        const files: string[] = [];
        try {
          const items = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of items) {
            if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'dist' && item.name !== 'build') {
              files.push(...listFiles(path.join(dir, item.name), `${prefix}${item.name}/`, depth + 1));
            } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js') || item.name.endsWith('.jsx'))) {
              files.push(`${prefix}${item.name}`);
            }
          }
        } catch (err) {
          // Skip directories we can't read
        }
        return files;
      };
      
      // Try different common structures
      const possiblePaths = [
        path.join(repoPath, "src"),
        path.join(repoPath, "apps"),
        path.join(repoPath, "packages"),
        path.join(repoPath, "app"),
      ];
      
      let foundFiles = false;
      for (const srcPath of possiblePaths) {
        if (fs.existsSync(srcPath)) {
          const sourceFiles = listFiles(srcPath);
          if (sourceFiles.length > 0) {
            foundFiles = true;
            existingCode += `\n## Existing Source Files in ${path.basename(srcPath)}/ (${sourceFiles.length} files):\n`;
            existingCode += sourceFiles.slice(0, 50).map(f => `- ${f}`).join("\n");
            if (sourceFiles.length > 50) {
              existingCode += `\n... and ${sourceFiles.length - 50} more files`;
            }
            existingCode += `\n`;
          }
        }
      }
      
      if (!foundFiles) {
        existingCode += `\n⚠️  No source files found in standard locations (src/, apps/, packages/, app/).\n`;
      }
    } catch (error) {
      console.warn("⚠️  Could not read existing codebase:", error);
      existingCode += `\n⚠️  Error reading codebase: ${error}\n`;
    }

    // Assemble the main prompt for the design model
    const prompt = `
You are a senior software architect.
Project: ${project}

Memory Context:
${context}

Existing Codebase:
${existingCode || "No existing codebase found or unable to read."}

Specification (PRD):
${spec}

Please create a comprehensive system design document with:
1. Architecture overview (considering existing structure)
2. Component structure and responsibilities
3. Data flow diagrams
4. Technology stack choices with rationale (use existing stack when appropriate)
5. API design (if applicable)
6. Database schema (if applicable)
7. Integration points with existing codebase

**IMPORTANT: File-Level Implementation Plan**
8. List all files that need to be CREATED or MODIFIED with:
   - Exact file path relative to repo root (e.g., apps/ramp/components/TabMenu.tsx)
   - Whether it's a NEW file or MODIFICATION of existing file
   - Brief description of changes
   
Example:
\`\`\`
## Implementation Files

### New Files:
- apps/ramp/components/TabMenu.tsx - New tab menu component with bg-gray-200 container
- apps/ramp/components/TabMenu.module.css - Styles for tab menu

### Modified Files:
- apps/ramp/app/catalog/page.tsx - Integrate new TabMenu component
- apps/ramp/app/catalog/layout.tsx - Update layout structure
\`\`\`

Output in markdown format. DO NOT include actual code yet.
`;

    console.log("\n" + "=".repeat(80));
    console.log("🏗️  ARCHITECTURE DESIGN GENERATION");
    console.log("=".repeat(80));
    console.log(`\n🎯 Project: ${project}`);
    console.log(`📂 Feature: ${featureFolder || 'default'}`);
    console.log(`📅 Date: ${new Date().toISOString()}`);
    console.log("\n🤖 Generating system design based on PRD...\n");
    
    const response = await model.invoke([{ role: "user", content: prompt }]);
    const design = response.content as string;
    
    // Print design to terminal
    console.log("=".repeat(80));
    console.log("📋 GENERATED SYSTEM DESIGN");
    console.log("=".repeat(80));
    console.log(design);
    console.log("=".repeat(80) + "\n");

    // Save to generated/design folder within feature directory
    const designDir = featureFolder
      ? path.join(process.cwd(), "projects", project, featureFolder, "generated", "design")
      : path.join(process.cwd(), "projects", project, "generated", "design");
    fs.mkdirSync(designDir, { recursive: true });
    
    const fileName = `design-${project}-${Date.now()}.md`;
    const filePath = path.join(designDir, fileName);
    fs.writeFileSync(filePath, design, "utf8");

    console.log(`✅ Design document saved: ${filePath}`);
    console.log(`📝 Review the design and run 'arch-code' mode when ready.`);

    return {
      success: true,
      mode: 'design',
      filePath,
      featureFolder,
      message: `Design document created. Review and approve before generating code.`
    };

  } else {
    // === Stage 2: Generate actual code (commit to target repo) ===
    
    // Extract feature folder from inputFile for branch name
    let featureFolder = "";
    if (inputFile) {
      const parts = inputFile.split(path.sep);
      const projectIdx = parts.findIndex(p => p === project);
      if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
        featureFolder = parts[projectIdx + 1];
      }
    }
    
    // Try to read PRD and code-directive for additional context
    let prdContent = "";
    let codeDirectiveContent = "";
    
    if (featureFolder) {
      // Try to read PRD
      const prdPath = path.join(process.cwd(), "projects", project, featureFolder, "prd");
      if (fs.existsSync(prdPath)) {
        const prdFiles = fs.readdirSync(prdPath).filter(f => f.endsWith(".md"));
        if (prdFiles.length > 0) {
          prdContent = fs.readFileSync(path.join(prdPath, prdFiles[0]), "utf8");
        }
      }
      
      // Try to read latest code-directive
      const directivesPath = path.join(process.cwd(), "projects", project, featureFolder, "directives");
      if (fs.existsSync(directivesPath)) {
        const codeDirectiveFiles = fs.readdirSync(directivesPath)
          .filter(f => f.startsWith("code-directive-") && f.endsWith(".md"))
          .map(f => {
            const match = f.match(/code-directive-(\d+)\.md$/);
            return match ? { name: f, number: parseInt(match[1]) } : null;
          })
          .filter(Boolean)
          .sort((a, b) => b!.number - a!.number);
        
        if (codeDirectiveFiles.length > 0) {
          codeDirectiveContent = fs.readFileSync(
            path.join(directivesPath, codeDirectiveFiles[0]!.name),
            "utf8"
          );
        }
      }
    }
    
    // If directive exists, first analyze it and show AI's understanding
    let directiveAnalysis = "";
    if (codeDirectiveContent) {
      console.log("\n" + "=".repeat(80));
      console.log("📋 DIRECTIVE RECEIVED - AI ANALYSIS");
      console.log("=".repeat(80));
      console.log("\n🎯 Human Directive:");
      console.log("-".repeat(80));
      console.log(codeDirectiveContent);
      console.log("-".repeat(80));
      
      const analysisPrompt = `You are analyzing a human directive for code implementation.

Directive:
${codeDirectiveContent}

Provide a brief analysis:
1. What is the main goal/command?
2. What specific changes are required?
3. Which files will be affected?
4. Any clarifications or assumptions you're making?

Keep it concise (3-5 sentences).`;

      const analysisResponse = await model.invoke([{ role: "user", content: analysisPrompt }]);
      directiveAnalysis = analysisResponse.content as string;
      
      console.log("\n🤖 AI Understanding:");
      console.log("-".repeat(80));
      console.log(directiveAnalysis);
      console.log("-".repeat(80) + "\n");
    }
    
    const prompt = codeDirectiveContent ? `
You are a senior software architect implementing code based on human directive.

**CRITICAL: This directive is your PRIMARY command - it overrides everything else.**

Human Directive (HIGHEST PRIORITY):
================================================================================
${codeDirectiveContent}
================================================================================

Your analysis of this directive:
${directiveAnalysis}

Context for reference only (directive takes precedence):

Project: ${project}

Architectural Context (from past learnings):
${context}

${prdContent ? `Original PRD:
---
${prdContent}
---

` : ''}Design Document:
${spec}

Your task: Implement ONLY what the directive commands. The directive is the absolute priority - if it conflicts with the design document, follow the directive.

**Output Format (CRITICAL):**

To CREATE or MODIFY a file:
=== FILE: path/to/file.tsx ===
[Full file content here]
=== END FILE ===

To DELETE a file:
=== DELETE: path/to/file.tsx ===

Examples:
=== FILE: apps/web/page.tsx ===
export default function Page() { ... }
=== END FILE ===

=== DELETE: apps/web/old-component.tsx ===

Requirements:
- PRIORITIZE the human directive above all else - it is a COMMAND, not a suggestion
- Use DELETE directive to remove unnecessary files completely
- Use proper imports, types, and comments
- Follow existing project conventions
- For MODIFIED files, provide the COMPLETE updated file content
- For NEW files, provide full implementation
- Use exact file paths from the design document or directive
` : `
You are a senior software architect.
Project: ${project}

Architectural Context (from past feedback):
${context}

${prdContent ? `Original PRD:
---
${prdContent}
---

` : ''}Design Document:
${spec}

Based on the design document${prdContent ? ' and PRD' : ''}, generate production-ready code for EACH file listed in "Implementation Files" section.

**Output Format (CRITICAL):**

To CREATE or MODIFY a file:
=== FILE: path/to/file.tsx ===
[Full file content here]
=== END FILE ===

To DELETE a file:
=== DELETE: path/to/file.tsx ===

Requirements:
- Use DELETE directive to remove unnecessary files completely
- Use proper imports, types, and comments
- Follow existing project conventions
- For MODIFIED files, provide the COMPLETE updated file content
- For NEW files, provide full implementation
- Use exact file paths from the design document
`;

    console.log("\n" + "=".repeat(80));
    console.log("💻 CODE GENERATION FROM DESIGN");
    console.log("=".repeat(80));
    console.log(`\n🎯 Project: ${project}`);
    console.log(`📂 Feature: ${featureFolder || 'default'}`);
    console.log(`📅 Date: ${new Date().toISOString()}`);
    console.log("\n📚 Context Used:");
    console.log(`  ✅ Architectural Principles: ${context ? 'Yes (from ChromaDB)' : 'None'}`);
    console.log(`  ${prdContent ? '✅' : '⚠️ '} Original PRD: ${prdContent ? 'Loaded' : 'Not found'}`);
    console.log(`  ✅ Design Document: Loaded`);
    console.log(`  ${codeDirectiveContent ? '✅' : '⚠️ '} Code Directive: ${codeDirectiveContent ? 'Loaded (latest)' : 'None'}`);
    console.log("\n🤖 Generating code from design document...\n");
    
    const response = await model.invoke([{ role: "user", content: prompt }]);
    const output = response.content as string;
    
    console.log("=".repeat(80));
    console.log("📦 AI CODE GENERATION OUTPUT");
    console.log("=".repeat(80));
    console.log(output);
    console.log("=".repeat(80) + "\n");

    // Parse multi-file output
    const fileRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
    const deleteRegex = /=== DELETE: (.+?) ===/g;
    const files: Array<{ path: string; content: string }> = [];
    const filesToDelete: string[] = [];
    let match;
    
    // Parse file modifications/creations
    while ((match = fileRegex.exec(output)) !== null) {
      files.push({
        path: match[1].trim(),
        content: match[2].trim()
      });
    }
    
    // Parse file deletions
    while ((match = deleteRegex.exec(output)) !== null) {
      filesToDelete.push(match[1].trim());
    }

    if (files.length === 0 && filesToDelete.length === 0) {
      throw new Error("No files parsed from AI output. Check output format.");
    }

    console.log(`\n📝 Parsed ${files.length} file(s) to modify, ${filesToDelete.length} file(s) to delete`);

    // Git operations - branch creation only (no staging/commit)
    const git = await getGitInstance(project, config);
    const branch = featureFolder ? `feature/${featureFolder}` : `feature/${project}-arch-${Date.now()}`;
    await createBranch(git, branch, config.branchBase);

    // Write/modify files directly (no staging)
    const baseDir = await git.revparse(['--show-toplevel']);
    for (const file of files) {
      const fullPath = path.join(baseDir.trim(), file.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, "utf8");
      console.log(`✏️  Modified: ${file.path}`);
    }
    
    // Delete files
    for (const filePath of filesToDelete) {
      const fullPath = path.join(baseDir.trim(), filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`🗑️  Deleted: ${filePath}`);
      } else {
        console.log(`⚠️  File not found (skipped): ${filePath}`);
      }
    }

    const totalChanges = files.length + filesToDelete.length;
    console.log(`\n✅ ${totalChanges} file(s) changed on branch "${branch}" (${files.length} modified, ${filesToDelete.length} deleted)`);
    console.log(`💡 Review changes with 'git diff' and commit when ready.`);
    
    // Extract learnings and store in ChromaDB
    console.log("\n🧠 Extracting coding principles for future learning...\n");
    
    const learningPrompt = `
Based on the code generation process you just completed, extract general coding principles and architectural decisions that should be remembered for future work on this project.

Context:
- Project: ${project}
- Design used: ${spec.substring(0, 500)}...
${codeDirectiveContent ? `- Directive applied: ${codeDirectiveContent}` : ''}

What patterns, conventions, or principles should be remembered? Focus on:
1. Code structure and organization patterns
2. Naming conventions
3. Error handling approaches
4. Component design patterns
5. Any feedback-driven improvements

Output in concise bullet points.
`;

    const learningResponse = await model.invoke([{ role: "user", content: learningPrompt }]);
    const learnings = learningResponse.content as string;
    
    // Print learnings to terminal
    console.log("=".repeat(80));
    console.log("📚 EXTRACTED CODING PRINCIPLES");
    console.log("=".repeat(80));
    console.log(learnings);
    console.log("=".repeat(80) + "\n");
    
    // Store in ChromaDB
    await storeMemory(
      learnings,
      {
        type: "code_generation",
        project,
        feature: featureFolder,
        hasDirective: !!codeDirectiveContent,
        timestamp: new Date().toISOString()
      },
      project
    );
    
    // Generate report
    const reportContent = `# Code Generation Report
**Project:** ${project}
**Feature:** ${featureFolder || 'default'}
**Date:** ${new Date().toISOString()}
**Branch:** ${branch}

## Context Used
- ✅ Architectural Principles: ${context ? 'Yes (from ChromaDB)' : 'None'}
- ${prdContent ? '✅' : '⚠️'} Original PRD: ${prdContent ? 'Loaded' : 'Not found'}
- ✅ Design Document: Loaded
- ${codeDirectiveContent ? '✅' : '⚠️'} Code Directive: ${codeDirectiveContent ? 'Loaded (latest)' : 'None'}

## Generated Files (${files.length})
${files.map(f => `- ${f.path}`).join('\n')}

## AI Thinking Process

### Code Generation Output
\`\`\`
${output}
\`\`\`

## Extracted Learnings
${learnings}

---
*This report was automatically generated by the AI architecture agent.*
`;

    const reportDir = path.join(
      process.cwd(),
      "projects",
      project,
      featureFolder || "default",
      "generated",
      "reports"
    );
    fs.mkdirSync(reportDir, { recursive: true });
    const reportFile = path.join(reportDir, `code-generation-report-${Date.now()}.md`);
    fs.writeFileSync(reportFile, reportContent, "utf8");
    
    console.log(`📊 Report saved: ${reportFile}\n`);
    
    return {
      success: true,
      mode: 'code',
      branch,
      filesCreated: files.length,
      filesDeleted: filesToDelete.length,
      files: files.map(f => f.path),
      deletedFiles: filesToDelete,
      reportFile,
      message: `${totalChanges} files changed (${files.length} modified, ${filesToDelete.length} deleted). Review with 'git diff' and commit when ready.`
    };
  }
}
