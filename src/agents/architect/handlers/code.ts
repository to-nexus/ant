import { HumanMessage } from "@langchain/core/messages";
import * as path from "path";
import * as fs from "fs";
import { getGitInstance, createBranch, getChangedFiles, getFileFromHead } from "../../../tools/git";
import { ProjectContext, ArchitectResult, DIRECTIVE_TYPES } from "../types";
import { getDirectivePath, readDirective, findLatestDesign, generateReport } from "../utils";
import { storeLearnings } from "../storage";
import { createModel } from "../llm/createModel";
import { ArchitectPromptor, TaskInputs } from "../prompt/ArchitectPromptor";

export async function handleCodeMode(context: ProjectContext, spec: string): Promise<ArchitectResult> {
  console.log("\n" + "=".repeat(80));
  console.log("💻 CODE GENERATION");
  console.log("=".repeat(80));
  console.log(`\n🎯 Project: ${context.project}`);
  console.log(`📂 Feature: ${context.featureFolder || 'default'}`);
  console.log(`📅 Date: ${new Date().toISOString()}`);

  const { model, modelName, provider, temperature, maxTokens } = createModel("architect");

  // Inputs
  const latestDesign = findLatestDesign(context);
  if (!latestDesign) {
    throw new Error("No design document found. Run arch-design first.");
  }

  const git = await getGitInstance(context.project, context.config);
  const changes = await git.diff();
  const hasChanges = changes.length > 0;

  const directivePath = getDirectivePath(context, DIRECTIVE_TYPES.CODE);
  const directive = readDirective(directivePath, DIRECTIVE_TYPES.CODE) || "";

  // ---------- Get Original Files from HEAD ----------
  let originalFilesContext = "";
  if (hasChanges) {
    console.log("\n📄 Loading original files from HEAD...");
    const changedFiles = await getChangedFiles(git);
    const originalFiles: Array<{ path: string; content: string }> = [];
    
    for (const filePath of changedFiles) {
      const content = await getFileFromHead(git, filePath);
      if (content !== null) {
        originalFiles.push({ path: filePath, content });
        console.log(`  ✓ ${filePath}`);
      } else {
        console.log(`  ⊕ ${filePath} (new file)`);
      }
    }
    
    if (originalFiles.length > 0) {
      originalFilesContext = originalFiles.map(f => 
        `FILE: ${f.path}\n${f.content}`  // Show COMPLETE file content
      ).join('\n\n---\n\n');
      console.log(`  📊 Loaded ${originalFiles.length} file(s) with ${originalFilesContext.length} characters`);
    }
  }

  // ---------- Phase 1: ALWAYS Plan First (Universal) ----------
  console.log("\n🧠 PHASE 1: Planning");
  
  const inputs = {
    directive: directive || null,
    currentCode: hasChanges ? changes : null,
    originalFiles: originalFilesContext || null,
    designDoc: latestDesign || null,
    prdSpec: spec || null,
    memory: context.memory || null,
  };

  const planPrompt = ArchitectPromptor.buildUniversalPlanPrompt(context, inputs);
  const planResp = await model.invoke([new HumanMessage(planPrompt)]);
  const planText = typeof planResp.content === "string" ? planResp.content : JSON.stringify(planResp.content);
  console.log("✅ Plan complete\n");

  // Augment original files based on files referenced in the plan
  try {
    const referencedPaths = Array.from(new Set(
      (planText.match(/[\w@\-/.]+\.(?:tsx|ts|jsx|js)/g) || [])
        .filter(p => p.includes('/'))
    ));
    if (referencedPaths.length) {
      console.log(`📄 Loading originals from plan (${referencedPaths.length})...`);
      const augmented: Array<{ path: string; content: string }> = [];
      for (const p of referencedPaths) {
        try {
          const content = await getFileFromHead(git, p);
          if (content) {
            augmented.push({ path: p, content });
            console.log(`  ✓ (plan) ${p}`);
          }
        } catch {}
      }
      if (augmented.length) {
        const block = augmented.map(f => `FILE: ${f.path}\n${f.content}`).join('\n\n---\n\n');
        inputs.originalFiles = inputs.originalFiles
          ? `${inputs.originalFiles}\n\n---\n\n${block}`
          : block;
      }
    }
  } catch {}

  // ---------- Phase 2: Execute Plan with Code ----------
  console.log("💻 PHASE 2: Implementation");
  let codePrompt = ArchitectPromptor.buildUniversalCodePrompt(context, inputs, planText);
  let codeResp = await model.invoke([new HumanMessage(codePrompt)]);
  let raw = typeof codeResp.content === "string" ? codeResp.content : JSON.stringify(codeResp.content);

  // DEBUG: Log raw output to check if AI is following instructions
  console.log("\n🔍 DEBUG - First 500 chars of AI response:");
  console.log(raw.substring(0, 500));
  console.log("\n🔍 DEBUG - Has RESPONSE block:", raw.includes("=== RESPONSE ==="));
  console.log("🔍 DEBUG - Has FILE block:", raw.includes("=== FILE:"));

  // ---------- Parse RESPONSE / FILE / DELETE blocks ----------
  const responseRegex = /=== RESPONSE ===\n([\s\S]*?)\n=== END RESPONSE ===/;
  const fileRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
  const deleteRegex = /=== DELETE: (.+?) ===/g;
  
  let responseMatch = responseRegex.exec(raw);
  let directiveResponse = responseMatch ? responseMatch[1].trim() : null;
  
  let files: Array<{ path: string; content: string }> = [];
  let filesToDelete: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = fileRegex.exec(raw)) !== null) {
    const filePath = m[1].trim();
    let fileContent = m[2].trim();
    
    // Remove ONLY leading/trailing markdown code blocks
    // Safe: only removes wrapping backticks, not ones inside actual code
    fileContent = fileContent
      .replace(/^```[\w]*\s*\n/, '')     // Remove opening ```language\n
      .replace(/\n```\s*$/, '');          // Remove closing \n```
    
    files.push({ path: filePath, content: fileContent });
  }
  while ((m = deleteRegex.exec(raw)) !== null) {
    filesToDelete.push(m[1].trim());
  }

  // ---------- Validate outputs; retry once on violation ----------
  const forbiddenEllipsis = /\.{3}|\/\/\s*\.\.\.|\{\s*\/\*.*\.\.\..*\*\/\s*\}/s;
  const violations: string[] = [];
  for (const f of files) {
    try {
      const original = await getFileFromHead(git, f.path);
      if (original) {
        const origLines = original.split('\n').length;
        const newLines = f.content.split('\n').length;
        if (newLines < Math.floor(origLines * 0.7)) {
          violations.push(`${f.path}: excessive deletion (${newLines}/${origLines} lines)`);
        }
      }
    } catch {}
    if (forbiddenEllipsis.test(f.content)) {
      violations.push(`${f.path}: contains ellipsis or skipped code`);
    }
  }

  if (violations.length) {
    console.warn("⚠️  Violations detected, retrying with stricter instructions:\n" + violations.join('\n'));
    const violationHeader = `\n\nVIOLATION DETECTED\n${violations.map(v => `- ${v}`).join('\n')}\n\nYou MUST regenerate COMPLETE files by COPYING the ENTIRE original content first, then applying minimal changes only. NO ellipsis, NO skipped code, preserve all existing logic.\n`;
    codePrompt = violationHeader + codePrompt;
    codeResp = await model.invoke([new HumanMessage(codePrompt)]);
    raw = typeof codeResp.content === "string" ? codeResp.content : JSON.stringify(codeResp.content);

    // Re-parse after retry
    responseMatch = responseRegex.exec(raw);
    directiveResponse = responseMatch ? responseMatch[1].trim() : null;
    files = [];
    filesToDelete = [];
    while ((m = fileRegex.exec(raw)) !== null) {
      const filePath = m[1].trim();
      let fileContent = m[2].trim();
      fileContent = fileContent.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');
      files.push({ path: filePath, content: fileContent });
    }
    while ((m = deleteRegex.exec(raw)) !== null) {
      filesToDelete.push(m[1].trim());
    }
  }

  let branch = '';
  let totalChanges = 0;

  if (files.length > 0 || filesToDelete.length > 0) {
    branch = context.featureFolder 
      ? `feature/${context.featureFolder}` 
      : `feature/${context.project}-arch-${Date.now()}`;
    await createBranch(git, branch, context.config.branchBase);

    const baseDir = await git.revparse(['--show-toplevel']);
    for (const f of files) {
      const fullPath = path.join(baseDir.trim(), f.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content, "utf8");
      console.log(`✏️  Modified: ${f.path}`);
    }
    for (const p of filesToDelete) {
      const fullPath = path.join(baseDir.trim(), p);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`🗑️  Deleted: ${p}`);
      }
    }
    totalChanges = files.length + filesToDelete.length;
    console.log(`\n✅ ${totalChanges} file(s) changed on branch "${branch}"`);
  } else {
    console.log("\n💬 No file changes were produced.");
  }

  // ---------- Extract learnings ----------
  const learningPrompt = `
From the plan and generated code, extract reusable coding/architecture principles for future work.
Focus on structure, naming, error handling, and patterns.
Output concise bullet points.
`;
  const learnResp = await model.invoke([new HumanMessage(learningPrompt)]);
  const learnings = typeof learnResp.content === "string" ? learnResp.content : JSON.stringify(learnResp.content);
  await storeLearnings(learnings, context.project, context.featureFolder || "default");

  // ---------- Report ----------
  const report = `# Code Generation Report
**Project:** ${context.project}
**Feature:** ${context.featureFolder || 'default'}
**Date:** ${new Date().toISOString()}
${branch ? `**Branch:** ${branch}` : '**Type:** Consultation/Discussion'}

## Model
- Provider: ${provider}
- Model: ${modelName}
- Temperature: ${temperature}
- Max Tokens: ${maxTokens}

${directiveResponse ? `## Directive Response\n${directiveResponse}\n` : ''}
## Plan (truncated)
${planText.substring(0, 1200)}...

## Files (${files.length})
${files.map(f => `- ${f.path}`).join('\n')}

## Deleted (${filesToDelete.length})
${filesToDelete.map(p => `- ${p}`).join('\n')}

## Learnings
${learnings}
`;

  const reportFile = generateReport("code-generation", context, report);
  return {
    success: true,
    mode: "code",
    reportFile,
    filesAnalyzed: totalChanges,
    message: totalChanges > 0
      ? `${totalChanges} files changed. Review with 'git diff' and commit when ready.`
      : `No code changes generated. See report for plan and learnings.`
  };
}
