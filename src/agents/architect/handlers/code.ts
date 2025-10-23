import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import * as path from "path";
import * as fs from "fs";
import { getGitInstance, createBranch } from "../../../tools/git";
import { DIRECTIVE_TYPES, ProjectContext, ArchitectResult } from "../types";
import { getDirectivePath, readDirective, findLatestDesign, generateReport } from "../utils";
import { storeLearnings } from "../storage";

const model = new ChatAnthropic({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  modelName: "claude-3-haiku-20240307",
  temperature: 0.2,
  maxTokens: 4000
});

export async function handleCodeMode(context: ProjectContext, spec: string): Promise<ArchitectResult> {
  console.log("\n" + "=".repeat(80));
  console.log("💻 CODE GENERATION");
  console.log("=".repeat(80));
  console.log(`\n🎯 Project: ${context.project}`);
  console.log(`📂 Feature: ${context.featureFolder || 'default'}`);
  console.log(`📅 Date: ${new Date().toISOString()}`);

  // 1. 현재 상태 파악
  const latestDesign = findLatestDesign(context);
  if (!latestDesign) {
    throw new Error("No design document found. Run arch-design first.");
  }
  console.log("📄 Found latest design document");

  // Git 정보 수집
  const git = await getGitInstance(context.project, context.config);
  const changes = await git.diff();
  const hasChanges = changes.length > 0;
  if (hasChanges) {
    console.log("📝 Found uncommitted changes from previous run");
  }

  // 2. 디렉티브 확인
  const directivePath = getDirectivePath(context, DIRECTIVE_TYPES.CODE);
  const directive = readDirective(directivePath, DIRECTIVE_TYPES.CODE);

  // Analyze directive if exists
  let directiveAnalysis = "";
  if (directive) {
    console.log("\n📋 DIRECTIVE RECEIVED - AI ANALYSIS");
    console.log("-".repeat(80));
    console.log("\n🎯 Human Directive:");
    console.log(directive);
    console.log("-".repeat(80));
    
    const analysisPrompt = `You are analyzing a human directive for code implementation.

Directive:
${directive}

Provide a brief analysis:
1. What is the main goal/command?
2. What specific changes are required?
3. Which files will be affected?
4. Any clarifications or assumptions you're making?

Keep it concise (3-5 sentences).`;

    const analysisResponse = await model.invoke([new HumanMessage(analysisPrompt)]);
    directiveAnalysis = typeof analysisResponse.content === 'string' 
      ? analysisResponse.content 
      : JSON.stringify(analysisResponse.content);
    
    console.log("\n🤖 AI Understanding:");
    console.log("-".repeat(80));
    console.log(directiveAnalysis);
    console.log("-".repeat(80) + "\n");
  }

  // 3. 컨텍스트 우선순위에 따라 프롬프트 구성
  let contextDescription = "";
  
  // 1. 최신 디렉티브 (최우선)
  if (directive) {
    contextDescription = `
HIGHEST PRIORITY - Latest Directive:
This directive contains the most recent requirements and feedback that MUST be addressed.
${directive}

Your analysis of the requirements:
${directiveAnalysis}
`;
  }

  // 2. 변경된 파일들 (AI의 이전 작업)
  if (hasChanges) {
    contextDescription += `
CURRENT CHANGES (Your Previous Work):
These are your previous implementation attempts that need to be reviewed/corrected.
${changes}
`;
  }

  // 3. 디자인 문서
  contextDescription += `
DESIGN DOCUMENT:
Follow these architectural decisions and patterns.
${latestDesign}
`;

  // 4. PRD
  contextDescription += `
REQUIREMENTS (PRD):
${spec}
`;

  // 5. 코드베이스 컨텍스트 (RAG)
  contextDescription += `
CODEBASE CONTEXT (via RAG):
Use these patterns and structures as reference.
${context.memory}
`;

  let prompt = "";
  if (directive && hasChanges) {
    // Case 1: 디렉티브 있고 changes 있음 → 이전 AI 작업에 대한 피드백
    prompt = `
You are reviewing and fixing your previous code implementation based on feedback.

**CRITICAL: This directive points out issues with your previous implementation.**

Your Previous Implementation (that had issues):
================================================================================
${changes}
================================================================================

Feedback and Required Changes (HIGHEST PRIORITY):
================================================================================
${directive}
================================================================================

Your analysis of what went wrong:
${directiveAnalysis}

Context (in priority order):
${contextDescription}

Your task:
1. This is a REVISION task - your previous implementation had issues that need to be fixed
2. Understand why you made those mistakes and learn from them
3. Implement the corrections according to the directive (HIGHEST PRIORITY)
4. Ensure the new implementation aligns with the latest design and PRD
5. Make it clear in your code comments what changes were made and why
`;
  } else if (directive) {
    // Case 2: 디렉티브만 있음 → 처음부터 디렉티브 고려한 구현
    prompt = `
You are implementing code with specific requirements.

**CRITICAL: This directive provides specific implementation requirements that must be followed.**

Implementation Requirements (HIGHEST PRIORITY):
================================================================================
${directive}
================================================================================

Your analysis of the requirements:
${directiveAnalysis}

Context (in priority order):
${contextDescription}

Your task:
1. Implement the code according to the directive's requirements (HIGHEST PRIORITY)
2. Ensure the implementation aligns with the latest design and PRD
3. Use clear code comments to explain your implementation decisions
`;
  } else {
    // Case 3: 디렉티브 없음 → 순수하게 design/prd 기반 구현
    prompt = `
You are implementing code based on the design document.

Context (in priority order):
${contextDescription}

Your task:
1. Implement the code exactly as specified in the design document
2. Follow all architectural patterns and conventions from the design
3. Ensure full alignment with the PRD requirements
4. Use clear code comments to explain your implementation decisions
`;
  }

  prompt += `
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

  console.log("\n📚 Context Used:");
  console.log(`  ✅ Memory: ${context.memory ? 'Yes (from ChromaDB)' : 'None'}`);
  console.log(`  ✅ Design Document: Loaded`);
  console.log(`  ${directive ? '✅' : '⚠️'} Code Directive: ${directive ? 'Loaded' : 'None'}`);
  console.log(`  ${hasChanges ? '✅' : '⚠️'} Previous Changes: ${hasChanges ? 'Found' : 'None'}`);
  console.log("\n🤖 Generating code...\n");
  
  // AI 사고 과정을 먼저 출력
  const thinkingPrompt = `${prompt}

**IMPORTANT: Before generating code, explain your thinking process:**
1. What changes are you planning to make and why?
2. How does this address the requirements/directive?
3. What are the key decisions you're making?
4. Any concerns or trade-offs?

Format:
=== THINKING ===
[Your thought process here]
=== END THINKING ===

Then generate the code files as instructed.`;

  const response = await model.invoke([new HumanMessage(thinkingPrompt)]);
  const output = typeof response.content === 'string' 
    ? response.content 
    : JSON.stringify(response.content);

  // Extract and display thinking process
  const thinkingMatch = output.match(/=== THINKING ===\n([\s\S]*?)\n=== END THINKING ===/);
  if (thinkingMatch) {
    console.log("\n💭 AI's Thinking Process:");
    console.log("=".repeat(80));
    console.log(thinkingMatch[1].trim());
    console.log("=".repeat(80));
    console.log();
  }

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

  // Git operations - branch creation only (no staging/commit)
  const branch = context.featureFolder 
    ? `feature/${context.featureFolder}` 
    : `feature/${context.project}-arch-${Date.now()}`;
  await createBranch(git, branch, context.config.branchBase);

  // Write/modify files
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
  console.log(`\n✅ ${totalChanges} file(s) changed on branch "${branch}"`);
  console.log(`💡 Review changes with 'git diff' and commit when ready.`);

  // Extract learnings
  console.log("\n🧠 Extracting coding principles for future learning...\n");
  
  const learningPrompt = `
Based on the code generation process you just completed, extract general coding principles and architectural decisions that should be remembered for future work on this project.

Context:
- Project: ${context.project}
- Design used: ${latestDesign.substring(0, 500)}...
${directive ? `- Directive applied: ${directive}` : ''}
${hasChanges ? `- Previous implementation analyzed and corrected` : ''}

What patterns, conventions, or principles should be remembered? Focus on:
1. Code structure and organization patterns
2. Naming conventions
3. Error handling approaches
4. Component design patterns
5. Any feedback-driven improvements

Output in concise bullet points.
`;

  const learningResponse = await model.invoke([new HumanMessage(learningPrompt)]);
  const learnings = typeof learningResponse.content === 'string' 
    ? learningResponse.content 
    : JSON.stringify(learningResponse.content);

  // Store learnings in ChromaDB
  await storeLearnings(learnings, context.project, context.featureFolder);

  // Generate report
  const reportContent = `# Code Generation Report
**Project:** ${context.project}
**Feature:** ${context.featureFolder || 'default'}
**Date:** ${new Date().toISOString()}
**Branch:** ${branch}

## Context Used
- Memory: ${context.memory ? 'Yes (from ChromaDB)' : 'None'}
- Latest Design: Loaded
- Code Directive: ${directive ? 'Yes' : 'No'}
- Previous Changes: ${hasChanges ? 'Yes' : 'No'}

${thinkingMatch ? `## AI's Thinking Process
${thinkingMatch[1].trim()}

` : ''}## Generated Files (${files.length})
${files.map(f => `- ${f.path}`).join('\n')}

## Deleted Files (${filesToDelete.length})
${filesToDelete.map(f => `- ${f}`).join('\n')}

## Code Generation Output
\`\`\`
${output}
\`\`\`

## Extracted Learnings
${learnings}

---
*This report was automatically generated by the AI architecture agent.*
`;

  const reportFile = generateReport("code-generation", context, reportContent);
  
  return {
    success: true,
    mode: 'code',
    reportFile,
    filesAnalyzed: totalChanges,
    message: `${totalChanges} files changed. Review with 'git diff' and commit when ready.`
  };
}
