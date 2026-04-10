import { AgentJob, JobMode, ProjectContext } from "../../types";
import type { ResolvedDocument } from "@ant/shared";

/**
 * Normalized input structure for prompt engine
 * All user inputs are converted to this standard format
 */
export interface NormalizedPromptInput {
  goal: string;                    // User's primary intent/goal
  job: AgentJob;                   // design, code, learn
  phase: "plan" | "execute";       // Current phase in workflow
  mode?: JobMode;                  // generate, refactor, explain
  
  artifacts: {
    directive?: string;
    currentCode?: string;
    documents?: ResolvedDocument[];
  };
  
  context: ProjectContext;         // Project metadata
}

/**
 * InputNormalizer - Layer 1
 * Converts raw inputs into standardized NormalizedPromptInput
 * 
 * Responsibilities:
 * - Validate required fields
 * - Extract goal from directive or default to job
 * - Ensure consistent structure
 */
export class InputNormalizer {
  /**
   * Normalize inputs for plan phase
   */
  normalizePlanInput(
    job: AgentJob,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      currentCode?: string;
      documents?: ResolvedDocument[];
    },
    mode?: JobMode,
    taskType?: string
  ): NormalizedPromptInput {
    // Extract goal from directive or use default
    const goal = artifacts.directive 
      ? this.extractGoal(artifacts.directive)
      : this.getDefaultGoal(job, "plan");
    
    // Validate job-specific requirements
    this.validateInput(job, "plan", artifacts, taskType);
    
    return {
      goal,
      job,
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
    job: AgentJob,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      currentCode?: string;
      documents?: ResolvedDocument[];
    },
    mode?: JobMode,
    taskType?: string
  ): NormalizedPromptInput {
    const goal = artifacts.directive 
      ? this.extractGoal(artifacts.directive)
      : this.getDefaultGoal(job, "execute");
    
    this.validateInput(job, "execute", artifacts, taskType);
    
    return {
      goal,
      job,
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
   * Get default goal based on job and phase
   */
  private getDefaultGoal(job: AgentJob, phase: "plan" | "execute"): string {
    const goals: Partial<Record<AgentJob, Record<string, string>>> = {
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
    
    return goals[job]?.[phase] || `Perform ${job} job (${phase} phase)`;
  }
  
  /**
   * Validate job-specific input requirements
   */
  private validateInput(
    job: AgentJob,
    phase: "plan" | "execute",
    artifacts: NormalizedPromptInput['artifacts'],
    taskType?: string
  ): void {
    // Code job requires either design doc or directive
    // Verification, test-code, doc, error, UI, and design-system tasks don't require a directive or documents
    const designDocExempt = ['verification', 'test-code', 'doc', 'error', 'ui', 'design-system'];
    if (job === 'code' && !designDocExempt.includes(taskType || '')) {
      if (!(artifacts.documents?.length) && !artifacts.directive) {
        throw new Error(
          "Code job requires either design document or directive.\n" +
          "Run 'architect design' first or provide a directive."
        );
      }
    }
    
    // Design job should have documents or directive
    if (job === 'design' && phase === 'plan') {
      if (!(artifacts.documents?.length) && !artifacts.directive) {
        console.warn("Design job: No documents or directive provided. Using empty spec.");
      }
    }
  }
}

