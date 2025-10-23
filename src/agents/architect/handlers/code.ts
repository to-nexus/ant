import { HumanMessage } from "@langchain/core/messages";
import * as path from "path";
import * as fs from "fs";
import { getGitInstance, createBranch } from "../../../tools/git";
import { DIRECTIVE_TYPES, ProjectContext, ArchitectResult } from "../types";
import { getDirectivePath, readDirective, findLatestDesign, generateReport } from "../utils";
import { storeLearnings } from "../storage";
import { createModel } from "../model";

const modelInfo = createModel('architect');
const model = modelInfo.model;

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
  
  // 디렉티브가 질문/설명 요청인지 확인
  const isQuestionOrExplanation = directive && (
    directive.includes('왜') || 
    directive.includes('이유') ||
    directive.includes('설명') ||
    directive.includes('why') ||
    directive.toLowerCase().includes('explain') ||
    directive.includes('?') ||
    directive.includes('어떻게')
  );

  // AI 사고 과정을 먼저 출력
  const thinkingPrompt = isQuestionOrExplanation ? `${prompt}

**IMPORTANT: The directive contains questions or requests for explanation. Please:**
1. **Answer each question directly and thoroughly**
2. Explain your reasoning and past decisions if asked
3. Provide context and examples where helpful
4. If code changes are also requested, explain them after answering the questions

Format:
=== THINKING ===
[Your answers and explanations here]
=== END THINKING ===

Then generate the code files if instructed.` : `${prompt}

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

  console.log("\n💭 AI's Thinking Process:");
  console.log("=".repeat(80));
  
  let output = '';
  let thinkingContent = '';
  let isInThinking = false;
  let hasStartedThinking = false;
  let fullOutput = ''; // 전체 출력 캡처용
  
  // Stream the response
  const stream = await model.stream([new HumanMessage(thinkingPrompt)]);
  
  for await (const chunk of stream) {
    const content = typeof chunk.content === 'string' ? chunk.content : '';
    output += content;
    fullOutput += content;
    
    // Check if we're in the THINKING section
    if (content.includes('=== THINKING ===')) {
      isInThinking = true;
      hasStartedThinking = true;
      process.stdout.write('\n');
      continue;
    }
    if (content.includes('=== END THINKING ===')) {
      isInThinking = false;
      process.stdout.write('\n');
      console.log("=".repeat(80));
      console.log();
      continue;
    }
    
    // Print ALL content in real-time (thinking or not)
    if (isInThinking) {
      process.stdout.write(content);
      thinkingContent += content;
    } else if (!content.includes('=== FILE:') && !content.includes('=== DELETE:')) {
      // 파일 생성 섹션이 아니면 모두 출력 (답변으로 간주)
      process.stdout.write(content);
      if (!hasStartedThinking) {
        thinkingContent += content;
      }
    }
  }
  
  // 출력이 있었으면 닫기
  if (thinkingContent || fullOutput) {
    console.log("\n" + "=".repeat(80));
    console.log();
  }

  // Extract thinking for report - 우선순위: 정규식 매칭 > 실시간 캡처 > 전체 출력
  let thinkingMatch = output.match(/=== THINKING ===\n([\s\S]*?)\n=== END THINKING ===/);
  let thinkingForReport = '';
  
  if (thinkingMatch && thinkingMatch[1]) {
    thinkingForReport = thinkingMatch[1].trim();
  } else if (thinkingContent.trim()) {
    thinkingForReport = thinkingContent.trim();
  } else if (hasStartedThinking) {
    // THINKING 태그는 있었지만 내용이 캡처 안된 경우 - 전체 출력에서 추출 시도
    const lines = output.split('\n');
    const startIdx = lines.findIndex(l => l.includes('=== THINKING ==='));
    const endIdx = lines.findIndex(l => l.includes('=== END THINKING ==='));
    if (startIdx >= 0 && endIdx > startIdx) {
      thinkingForReport = lines.slice(startIdx + 1, endIdx).join('\n').trim();
    }
  }
  
  // 파일 생성 없이 순수 답변만 있는 경우 - 전체 출력을 답변으로 간주
  if (!thinkingForReport && fullOutput.trim()) {
    // FILE 섹션 제거하고 나머지를 답변으로 사용
    const fileStartIdx = fullOutput.indexOf('=== FILE:');
    if (fileStartIdx >= 0) {
      thinkingForReport = fullOutput.substring(0, fileStartIdx).trim();
    } else {
      thinkingForReport = fullOutput.trim();
    }
  }
  
  console.log(`\n[DEBUG] Captured thinking content length: ${thinkingForReport.length}`);

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

  let branch = '';
  let totalChanges = 0;

  if (files.length > 0 || filesToDelete.length > 0) {
    // Git operations - branch creation only (no staging/commit)
    branch = context.featureFolder 
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

    totalChanges = files.length + filesToDelete.length;
    console.log(`\n✅ ${totalChanges} file(s) changed on branch "${branch}"`);
    console.log(`💡 Review changes with 'git diff' and commit when ready.`);
  } else {
    console.log(`\n💬 No code changes generated - this was a consultation/discussion.`);
    console.log(`📝 The AI's thinking process and learnings have been captured.`);
  }

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
${branch ? `**Branch:** ${branch}` : '**Type:** Consultation/Discussion'}

## AI Model Used
- Provider: ${modelInfo.provider}
- Model: ${modelInfo.modelName}
- Temperature: ${modelInfo.temperature}
- Max Tokens: ${modelInfo.maxTokens}

## Context Used
- Memory: ${context.memory ? 'Yes (from ChromaDB)' : 'None'}
- Latest Design: Loaded
- Code Directive: ${directive ? 'Yes' : 'No'}
- Previous Changes: ${hasChanges ? 'Yes' : 'No'}

${thinkingForReport ? `## AI's Thinking Process
${thinkingForReport}

` : ''}## Generated Files (${files.length})
${files.map(f => `- ${f.path}`).join('\n')}

## Deleted Files (${filesToDelete.length})
${filesToDelete.map(f => `- ${f}`).join('\n')}

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
    message: totalChanges > 0 
      ? `${totalChanges} files changed. Review with 'git diff' and commit when ready.`
      : `Consultation completed. No code changes generated. Check report for AI's thinking process and learnings.`
  };
}
