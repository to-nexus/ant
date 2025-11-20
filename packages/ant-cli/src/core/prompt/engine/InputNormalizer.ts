import { AgentTask, CodeMode, ProjectContext } from "../../types";

/**
 * Normalized input structure for prompt engine
 * All user inputs are converted to this standard format
 */
export interface NormalizedPromptInput {
  goal: string;                    // User's primary intent/goal
  task: AgentTask;                 // design, code, learn
  phase: "plan" | "execute";       // Current phase in workflow
  mode?: CodeMode;                 // generate, refactor, explain (code only)
  
  artifacts: {
    directive?: string;            // User instruction
    designDoc?: string;            // Design document
    prdSpec?: string;              // PRD specification
    originalFiles?: string;        // Original code from git
    currentCode?: string;          // Current working code
  };
  
  context: ProjectContext;         // Project metadata
}

/**
 * InputNormalizer - Layer 1
 * Converts raw inputs into standardized NormalizedPromptInput
 * 
 * Responsibilities:
 * - Validate required fields
 * - Extract goal from directive or default to task
 * - Ensure consistent structure
 */
export class InputNormalizer {
  /**
   * Normalize inputs for plan phase
   */
  normalizePlanInput(
    task: AgentTask,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      designDoc?: string;
      prdSpec?: string;
      originalFiles?: string;
      currentCode?: string;
    },
    mode?: CodeMode
  ): NormalizedPromptInput {
    // Extract goal from directive or use default
    const goal = artifacts.directive 
      ? this.extractGoal(artifacts.directive)
      : this.getDefaultGoal(task, "plan");
    
    // Validate task-specific requirements
    this.validateInput(task, "plan", artifacts);
    
    return {
      goal,
      task,
      phase: "plan",
      mode,
      artifacts,
      context
    };
  }
  
  /**
   * Normalize inputs for execute phase
   */
  normalizeExecuteInput(
    task: AgentTask,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      designDoc?: string;
      prdSpec?: string;
      originalFiles?: string;
      currentCode?: string;
    },
    mode?: CodeMode
  ): NormalizedPromptInput {
    const goal = artifacts.directive 
      ? this.extractGoal(artifacts.directive)
      : this.getDefaultGoal(task, "execute");
    
    this.validateInput(task, "execute", artifacts);
    
    return {
      goal,
      task,
      phase: "execute",
      mode,
      artifacts,
      context
    };
  }
  
  /**
   * Extract goal from text (first meaningful sentence)
   */
  private extractGoal(text: string): string {
    // Remove markdown headings
    const cleaned = text.replace(/^#+\s+/gm, '').trim();
    
    // Get first paragraph or sentence
    const firstPara = cleaned.split('\n\n')[0];
    const firstSentence = firstPara.split(/[.!?]\s/)[0];
    
    return firstSentence.trim() || text.substring(0, 100);
  }
  
  /**
   * Get default goal based on task and phase
   */
  private getDefaultGoal(task: AgentTask, phase: "plan" | "execute"): string {
    const goals: Partial<Record<AgentTask, Record<string, string>>> = {
      design: {
        plan: "Analyze requirements and structure system design",
        execute: "Generate comprehensive system design document"
      },
      code: {
        plan: "Plan code implementation strategy",
        execute: "Generate or modify code files"
      },
      learn: {
        plan: "Extract learning patterns from code",
        execute: "Store learning chunks to memory"
      },
      review: {
        plan: "Analyze code changes and identify risks",
        execute: "Generate comprehensive code review"
      },
      plan: {
        plan: "Analyze sprint status and progress",
        execute: "Generate sprint summary and next actions"
      },
      doc: {
        plan: "Identify documentation changes needed",
        execute: "Generate updated documentation"
      }
    };
    
    return goals[task]?.[phase] || `Perform ${task} task (${phase} phase)`;
  }
  
  /**
   * Validate task-specific input requirements
   */
  private validateInput(
    task: AgentTask,
    phase: "plan" | "execute",
    artifacts: NormalizedPromptInput['artifacts']
  ): void {
    // Code task requires either design doc or directive
    if (task === 'code') {
      if (!artifacts.designDoc && !artifacts.directive) {
        throw new Error(
          "Code task requires either design document or directive.\n" +
          "Run 'architect design' first or provide a directive."
        );
      }
    }
    
    // Design task should have PRD or directive
    if (task === 'design' && phase === 'plan') {
      if (!artifacts.prdSpec && !artifacts.directive) {
        console.warn("Design task: No PRD or directive provided. Using empty spec.");
      }
    }
  }
}

