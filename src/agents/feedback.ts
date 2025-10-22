import { ChatAnthropic } from "@langchain/anthropic";
import { storeMemory, queryMemory } from "../memory/chroma";
import { loadProjectGitConfig, getGitInstance, stageOnly } from "../tools/git";
import fs from "fs";
import path from "path";

// Helper function to save report
function saveReport(content: string, project: string, featureFolder: string, type: "design" | "code"): string {
  const reportDir = path.join(
    process.cwd(),
    "projects",
    project,
    featureFolder,
    "generated",
    "reports"
  );
  fs.mkdirSync(reportDir, { recursive: true });
  
  const fileName = `${type}-feedback-report-${Date.now()}.md`;
  const filePath = path.join(reportDir, fileName);
  fs.writeFileSync(filePath, content, "utf8");
  
  console.log(`📊 Report saved: ${filePath}`);
  return filePath;
}

/**
 * FeedbackAgent (Unified)
 * 
 * Two modes:
 * 1. Design feedback: Extracts principles from design review
 * 2. Code feedback: Regenerates code based on feedback + extracts coding principles
 */

const model = new ChatAnthropic({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-haiku-20240307",
  temperature: 0.2,
  maxTokens: 4000
});

export async function feedbackAgent(
  designFile: string,
  feedback: string,
  project: string,
  regenerateCode: boolean = false
): Promise<any> {
  // Read the design document
  const design = fs.readFileSync(designFile, "utf8");
  
  // Extract feature folder from designFile path
  const parts = designFile.split(path.sep);
  const projectIdx = parts.findIndex(p => p === project);
  const featureFolder = (projectIdx >= 0 && projectIdx + 1 < parts.length) 
    ? parts[projectIdx + 1] 
    : "default";
  
  // If regenerateCode is false, just extract and store design principles (original behavior)
  if (!regenerateCode) {
    return await processDesignFeedback(design, feedback, project, designFile, featureFolder);
  }
  
  // If regenerateCode is true, regenerate code based on feedback
  return await processCodeFeedback(design, feedback, project, designFile, featureFolder);
}

async function processDesignFeedback(
  design: string,
  feedback: string,
  project: string,
  designFile: string,
  featureFolder: string
): Promise<string> {
  const prompt = `
You are a learning system that extracts architectural principles and best practices from human feedback.

Original Design Document:
${design}

Human Feedback:
${feedback}

First, explain your thinking process about this feedback:
1. What specific issues or improvements does the feedback address?
2. Why are these changes important?
3. How will these principles improve future designs?

Then, extract key learnings and principles that should be applied to future designs. Focus on:
1. Architectural patterns preferred
2. Code organization preferences
3. Technology stack decisions
4. Integration patterns
5. Naming conventions
6. File structure preferences

Output format:
## Thinking Process
[Your analysis here]

## Extracted Principles
[Bullet points, each starting with "PRINCIPLE:"]
`;

  const response = await model.invoke([{ role: "user", content: prompt }]);
  const fullResponse = response.content as string;
  
  // Print thinking process to terminal
  console.log("\n" + "=".repeat(80));
  console.log("📊 DESIGN FEEDBACK ANALYSIS");
  console.log("=".repeat(80));
  console.log(`\n🎯 Project: ${project}`);
  console.log(`📂 Feature: ${featureFolder}`);
  console.log(`📅 Date: ${new Date().toISOString()}\n`);
  console.log("💬 Human Feedback:");
  console.log("-".repeat(80));
  console.log(feedback);
  console.log("-".repeat(80));
  console.log("\n🤖 AI Analysis:");
  console.log("-".repeat(80));
  console.log(fullResponse);
  console.log("-".repeat(80) + "\n");
  
  // Save full report
  const reportContent = `# Design Feedback Report

**Project:** ${project}
**Feature:** ${featureFolder}
**Date:** ${new Date().toISOString()}

## Human Feedback
${feedback}

## AI Analysis
${fullResponse}
`;
  
  saveReport(reportContent, project, featureFolder, "design");
  
  // Extract only principles for storage
  const learnings = fullResponse.split("## Extracted Principles")[1]?.trim() || fullResponse;

  // Store in memory
  await storeMemory(
    learnings,
    {
      type: "design_feedback",
      project,
      designFile,
      timestamp: new Date().toISOString()
    },
    project
  );

  console.log(`✅ Design feedback processed and stored for project "${project}"`);
  
  return learnings;
}

async function processCodeFeedback(
  design: string,
  feedback: string,
  project: string,
  designFile: string,
  featureFolder: string
): Promise<any> {
  const context = await queryMemory("architecture principles", project);
  const config = await loadProjectGitConfig(project);
  const git = await getGitInstance(project, config);

  // Get staged files from git
  const status = await git.status();
  const stagedFiles = [...status.staged, ...status.modified];

  if (stagedFiles.length === 0) {
    throw new Error("No staged files found. Run arch-code first.");
  }

  console.log(`📝 Found ${stagedFiles.length} staged files`);

  // Read content of staged files
  const baseDir = await git.revparse(['--show-toplevel']);
  const stagedContent = stagedFiles.map(filePath => {
    const fullPath = path.join(baseDir.trim(), filePath);
    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
    return `=== FILE: ${filePath} ===\n${content}\n=== END FILE ===`;
  }).join("\n\n");

  // Generate improved code with feedback
  const codePrompt = `
You are a senior software architect improving code based on human feedback.
Project: ${project}

Architectural Context:
${context}

Original Design Document:
${design}

Current Staged Code:
${stagedContent}

Human Feedback:
${feedback}

Based on the feedback, regenerate ONLY the files that need changes. Apply the feedback while maintaining consistency with the design document.

**Output Format (CRITICAL):**
For each file that needs changes, output in this exact format:

=== FILE: path/to/file.tsx ===
[Full improved file content here]
=== END FILE ===

=== FILE: path/to/another-file.ts ===
[Full improved file content here]
=== END FILE ===

Only include files that need changes based on the feedback. Maintain proper imports, types, and comments.
`;

  console.log("\n🤖 Regenerating code based on feedback...\n");
  
  const codeResponse = await model.invoke([{ role: "user", content: codePrompt }]);
  const output = codeResponse.content as string;
  
  console.log("=".repeat(80));
  console.log("🔄 CODE REGENERATION OUTPUT");
  console.log("=".repeat(80));
  console.log(output);
  console.log("=".repeat(80) + "\n");

  // Parse multi-file output
  const fileRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
  const files: Array<{ path: string; content: string }> = [];
  let match;
  
  while ((match = fileRegex.exec(output)) !== null) {
    files.push({
      path: match[1].trim(),
      content: match[2].trim()
    });
  }

  if (files.length === 0) {
    console.log("⚠️  No files changed based on feedback");
    return {
      success: true,
      filesChanged: 0,
      message: "No changes needed based on feedback"
    };
  }

  console.log(`\n📝 Regenerated ${files.length} files with feedback applied`);

  // Re-stage improved files
  for (const file of files) {
    console.log(`📝 Re-staging improved: ${file.path}`);
    await stageOnly(git, file.path, file.content);
  }

  console.log(`✅ ${files.length} improved files re-staged`);
  console.log(`💡 Review the changes and commit when ready.`);
  
  // Extract general coding principles from feedback for future use
  const learningPrompt = `
Extract general coding principles from this feedback that should be applied to future code generation:

Feedback: ${feedback}

First, explain your thinking process about this code feedback:
1. What specific code issues does the feedback address?
2. Why are these improvements important?
3. How will these principles improve future code generation?

Then, extract reusable patterns like:
- Naming conventions
- Error handling patterns
- Code organization preferences
- Best practices mentioned

Output format:
## Thinking Process
[Your analysis here]

## Extracted Principles
[Bullet points, each starting with "PRINCIPLE:"]
If no general principles can be extracted, output "No general principles extracted."
`;

  const learningResponse = await model.invoke([{ role: "user", content: learningPrompt }]);
  const fullLearnings = learningResponse.content as string;
  
  // Print thinking process to terminal
  console.log("\n" + "=".repeat(80));
  console.log("📊 CODE FEEDBACK ANALYSIS");
  console.log("=".repeat(80));
  console.log(`\n🎯 Project: ${project}`);
  console.log(`📂 Feature: ${featureFolder}`);
  console.log(`📅 Date: ${new Date().toISOString()}\n`);
  console.log("💬 Human Feedback:");
  console.log("-".repeat(80));
  console.log(feedback);
  console.log("-".repeat(80));
  console.log("\n📝 Files Changed:");
  files.forEach(f => console.log(`  - ${f.path}`));
  console.log("\n🤖 AI Analysis:");
  console.log("-".repeat(80));
  console.log(fullLearnings);
  console.log("-".repeat(80) + "\n");
  
  // Save full report
  const reportContent = `# Code Feedback Report

**Project:** ${project}
**Feature:** ${featureFolder}
**Date:** ${new Date().toISOString()}

## Human Feedback
${feedback}

## Files Changed
${files.map(f => `- ${f.path}`).join('\n')}

## AI Analysis
${fullLearnings}
`;
  
  saveReport(reportContent, project, featureFolder, "code");
  
  // Extract only principles for storage
  const learnings = fullLearnings.split("## Extracted Principles")[1]?.trim() || fullLearnings;

  if (!learnings.includes("No general principles extracted")) {
    await storeMemory(
      learnings,
      {
        type: "code_feedback",
        project,
        designFile,
        timestamp: new Date().toISOString()
      },
      project
    );
    console.log(`📚 General coding principles extracted and stored`);
  }
  
  return {
    success: true,
    filesChanged: files.length,
    files: files.map(f => f.path),
    message: `${files.length} files improved and re-staged based on feedback.`
  };
}


