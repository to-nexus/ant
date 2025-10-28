import { PromptPort } from "../../../core/ports";
import { ProjectContext } from "../types";

export interface TaskInputs {
  directive: string | null;
  currentCode: string | null;
  originalFiles: string | null;
  designDoc: string | null;
  prdSpec: string | null;
  memory: string | null;
}

/**
 * ArchitectPromptor - High-level prompt composition for architect agent
 * Orchestrates 6 modular templates: system, plan-base, plan-rules, code-base, code-rules, examples
 */
export class ArchitectPromptor {
  private systemPromptCache: string | null = null;

  constructor(private promptPort: PromptPort) {}

  /**
   * Load and cache system prompt (shared between plan and code phases)
   */
  private async getSystemPrompt(): Promise<string> {
    if (!this.systemPromptCache) {
      this.systemPromptCache = await this.promptPort.render("system", {});
    }
    return this.systemPromptCache;
  }

  /**
   * Build plan phase prompt by composing: system + plan-base + plan-rules
   */
  async buildUniversalPlanPrompt(context: ProjectContext, inputs: TaskInputs): Promise<string> {
    const system = await this.getSystemPrompt();
    const hasOriginalFiles = inputs.originalFiles && inputs.originalFiles.length > 0;
    
    // Render plan-base with dynamic sections
    const renderedPlanBase = await this.promptPort.render("plan-base", {
      project: context.project,
      
      hasOriginalFilesWarning: hasOriginalFiles 
        ? `
⚠️  CRITICAL: ORIGINAL FILES PROVIDED BELOW ⚠️
You are MODIFYING existing files, NOT creating new ones!
Your output MUST preserve all existing code and only add/change what's needed.
` 
        : '',
      
      directiveSection: inputs.directive 
        ? `📋 DIRECTIVE (User Feedback/Request):\n${inputs.directive}\n`
        : '',
      
      originalFilesSection: inputs.originalFiles
        ? `
📄 ORIGINAL FILES (COMPLETE - from HEAD/last commit):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${inputs.originalFiles}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  These are the COMPLETE files. Copy them as your BASE for modifications.
`
        : '',
      
      currentCodeSection: inputs.currentCode
        ? `💻 CURRENT CHANGES (Git Diff):\n${inputs.currentCode.substring(0, 1000)}${inputs.currentCode.length > 1000 ? '...\n[truncated]' : ''}\n`
        : '',
      
      designDocSection: inputs.designDoc
        ? `📐 DESIGN DOCUMENT:\n${inputs.designDoc.substring(0, 800)}...\n`
        : '',
      
      prdSpecSection: inputs.prdSpec
        ? `📝 PRD/SPEC:\n${inputs.prdSpec.substring(0, 800)}...\n`
        : '',
      
      memorySection: inputs.memory
        ? `🧠 MEMORY:\n${inputs.memory.substring(0, 500)}...\n`
        : ''
    });

    // Load plan-rules (no variables to render)
    const planRules = await this.promptPort.render("plan-rules", {});

    // Compose: system + rendered plan-base + plan-rules
    return `${system}\n\n${renderedPlanBase}\n\n${planRules}`;
  }

  /**
   * Build code phase prompt by composing: system + code-base + code-rules + examples
   */
  async buildUniversalCodePrompt(context: ProjectContext, inputs: TaskInputs, plan: string): Promise<string> {
    const system = await this.getSystemPrompt();
    const hasOriginalFiles = inputs.originalFiles && inputs.originalFiles.length > 0;
    
    // Render code-base with dynamic sections
    const renderedCodeBase = await this.promptPort.render("code-base", {
      project: context.project,
      plan,
      
      modificationMode: hasOriginalFiles 
        ? 'MODIFICATION MODE: Copy original, then modify'
        : 'CREATION MODE: Build from scratch',
      
      originalFilesWarning: hasOriginalFiles
        ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  CRITICAL: YOU ARE MODIFYING EXISTING FILES ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ORIGINAL FILES (COMPLETE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${inputs.originalFiles}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANDATORY INSTRUCTIONS FOR MODIFYING EXISTING FILES:
1. COPY the ENTIRE original file content as your starting point
2. Add/modify ONLY the specific lines needed for your task
3. Keep ALL existing imports, state, hooks, effects, logic, JSX
4. DO NOT simplify, DO NOT delete unrelated code
5. If original = 200 lines, output should be ~205 lines (NOT 20 lines!)
`
        : '',
      
      preOutputCheck: hasOriginalFiles
        ? `
YOU ARE MODIFYING EXISTING FILES!

Before writing ANY code, answer these questions:
Q1: Did I see the ORIGINAL FILES above? (They're shown in full)
Q2: How many lines is the original file? (Count them)
Q3: Am I about to output a similar number of lines?
Q4: Did I copy the ENTIRE original file as my base?

If answer to ANY question is "NO", STOP and go back to read ORIGINAL FILES.

PROCESS:
1. Read ORIGINAL FILES completely
2. Copy ALL content as starting point
3. Add/modify ONLY what's needed
4. Verify line count is similar (200 → ~205, NOT 20)
`
        : '',
      
      directiveSection: inputs.directive
        ? `📋 DIRECTIVE: ${inputs.directive}\n`
        : '',
      
      currentCodeSection: !hasOriginalFiles && inputs.currentCode
        ? `💻 CURRENT CHANGES: ${inputs.currentCode.substring(0, 500)}...\n`
        : ''
    });

    // Render code-rules with response section
    const renderedCodeRules = await this.promptPort.render("code-rules", {
      responseSection: inputs.directive
        ? `=== RESPONSE ===
[Your response to the directive]
=== END RESPONSE ===

`
        : ''
    });

    // Load examples (no variables to render)
    const examples = await this.promptPort.render("examples", {});

    // Compose: system + rendered code-base + rendered code-rules + examples
    return `${system}\n\n${renderedCodeBase}\n\n${renderedCodeRules}\n\n${examples}`;
  }
}
