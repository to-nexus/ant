import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { DIRECTIVE_TYPES, ProjectContext, ArchitectResult } from "../types";
import { getDirectivePath, readDirective, findLatestDesign, generateReport } from "../utils";
import { storeLearnings } from "../storage";
import * as path from "path";
import * as fs from "fs";

const model = new ChatAnthropic({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  modelName: "claude-3-haiku-20240307",
  temperature: 0.2,
  maxTokens: 4000
});

export async function handleDesignMode(context: ProjectContext, spec: string): Promise<ArchitectResult> {
  console.log("\n" + "=".repeat(80));
  console.log("🏗️  ARCHITECTURE DESIGN GENERATION");
  console.log("=".repeat(80));
  console.log(`\n🎯 Project: ${context.project}`);
  console.log(`📂 Feature: ${context.featureFolder || 'default'}`);
  console.log(`📅 Date: ${new Date().toISOString()}`);

  // Find latest design document if exists
  const previousDesign = findLatestDesign(context);
  
  // Try to read design directive
  const directivePath = getDirectivePath(context, DIRECTIVE_TYPES.DESIGN);
  const directive = readDirective(directivePath, DIRECTIVE_TYPES.DESIGN);

  // Analyze directive if exists
  let directiveAnalysis = "";
  if (directive) {
    console.log("\n📋 DESIGN DIRECTIVE RECEIVED");
    console.log("-".repeat(80));
    console.log("\n🎯 Human Directive:");
    console.log(directive);
    console.log("-".repeat(80));
    
    const analysisPrompt = `You are analyzing a human directive for system design.

Directive:
${directive}

Provide a brief analysis:
1. What are the key design requirements?
2. Any specific architectural patterns or approaches required?
3. Any constraints or preferences mentioned?
4. Any assumptions you need to make?

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

  // 컨텍스트 우선순위에 따라 프롬프트 구성
  let contextDescription = "";
  
  if (directive) {
    contextDescription = `
HIGHEST PRIORITY - Latest Directive:
This directive contains the most recent requirements and feedback that MUST be addressed.
${directive}

${previousDesign ? `
PREVIOUS DESIGN CONTEXT:
This design needs to be updated based on the above directive.
${previousDesign}
` : ""}
`;
  } else if (previousDesign) {
    contextDescription = `
EXISTING DESIGN:
This is the current design that should be used as a foundation.
${previousDesign}
`;
  }

  contextDescription += `
REQUIREMENTS (PRD):
${spec}

CODEBASE CONTEXT (via RAG):
${context.memory}
`;

  const prompt = directive ? `
You are reviewing and revising a system design based on human feedback.

**CRITICAL: This directive points out issues with the previous design and commands specific changes.**

Previous Design Document:
================================================================================
${previousDesign}
================================================================================

Feedback and Required Changes (HIGHEST PRIORITY):
================================================================================
${directive}
================================================================================

Your analysis of the feedback:
${directiveAnalysis}

Context for reference:
Project: ${context.project}

Memory Context:
${context.memory}

Original PRD:
${spec}

Your task:
1. This is a REVISION task - the previous design had issues that need to be fixed
2. The directive points out what was wrong and how it should be changed
3. Create an updated design that specifically addresses all points in the directive
4. Maintain the good parts of the previous design while fixing the identified issues
5. Make it clear in your design document what changes were made and why
` : `
You are a senior software architect.
Project: ${context.project}

Memory Context:
${context.memory}

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

Output in markdown format. DO NOT include actual code yet.
`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  const design = typeof response.content === 'string' 
    ? response.content 
    : JSON.stringify(response.content);

  // 1. 디자인 문서 저장
  const designDir = path.join(
    context.workingDir,
    "projects",
    context.project,
    context.featureFolder || "default",
    "generated",
    "design"
  );
  fs.mkdirSync(designDir, { recursive: true });
  
  const designFileName = `design-${context.project}-${Date.now()}.md`;
  const designFilePath = path.join(designDir, designFileName);
  fs.writeFileSync(designFilePath, design, "utf8");

  // 2. 디자인 내용 ChromaDB에 저장
  await storeLearnings(design, context.project, context.featureFolder);

  // 3. 학습 내용 추출 및 저장
  const learningPrompt = `
Based on the design process you just completed, extract key architectural principles and design decisions that should be remembered for future work.

Context:
- Project: ${context.project}
${directive ? `- Design Directive: ${directive}` : ''}
${previousDesign ? '- Previous Design: Available and considered' : ''}
${directiveAnalysis ? `- Directive Analysis: ${directiveAnalysis}` : ''}

Focus on extracting:
1. Architectural patterns and principles applied
2. Design decisions and their rationales
3. Technology choices and their justifications
4. Component organization strategies
5. Integration patterns
6. Any feedback-driven improvements

Output in clear, categorized bullet points.
`;

  const learningResponse = await model.invoke([new HumanMessage(learningPrompt)]);
  const learnings = typeof learningResponse.content === 'string' 
    ? learningResponse.content 
    : JSON.stringify(learningResponse.content);

  // 학습 내용 저장
  await storeLearnings(learnings, context.project, context.featureFolder);

  console.log(`\n📚 Stored in ChromaDB:`);
  console.log("=".repeat(80));
  console.log("Design document + extracted learnings");
  console.log("=".repeat(80));

  console.log(`\n✅ Design document saved: ${designFilePath}`);
  console.log(`📝 Review the design and run 'arch-code' mode when ready.`);

  return {
    success: true,
    mode: 'design',
    reportFile: designFilePath,
    message: `Design document created at ${designFilePath}. Review and approve before generating code.`
  };
}
