import { AgentTask, CodeMode } from "../../types";
import { AssembledContext } from "./ContextAssembler";
import { inferCodeMode } from "../../modeInference";

/**
 * Prompt mode configuration
 * Defines how prompts should be assembled for each mode
 */
export interface PromptModeConfig {
  task: AgentTask;
  phase: "plan" | "execute";
  mode?: CodeMode;
  
  // Template selection
  templates: {
    base: string;              // Base template path
    rules: string;             // Rules template path
    injections: string[];      // Conditional injection paths
  };
  
  // LLM parameters
  llmParams: {
    temperature: number;
    maxTokens?: number;
    topP?: number;
  };
  
  // Flags
  flags: {
    includeExamples: boolean;
    includeProfiles: boolean;   // Language/framework profiles
    includeMemory: boolean;
    strictValidation: boolean;
  };
}

/**
 * ModeController - Layer 3
 * Selects and configures prompt mode based on task, phase, and context
 * 
 * Responsibilities:
 * - Determine appropriate mode for code task
 * - Select template paths
 * - Configure LLM parameters
 * - Define injection strategy
 */
export class ModeController {
  /**
   * Determine mode configuration for a given input
   */
  determineMode(
    task: AgentTask,
    phase: "plan" | "execute",
    context: AssembledContext,
    explicitMode?: CodeMode
  ): PromptModeConfig {
    // Infer code mode if not provided
    let mode: CodeMode | undefined = explicitMode;
    
    if (task === 'code' && !mode && context.directive) {
      mode = inferCodeMode(
        context.directive,
        context.stats.hasOriginalFiles
      );
    }
    
    // Build mode config based on task and phase
    return this.buildModeConfig(task, phase, mode, context);
  }
  
  /**
   * Build mode configuration
   */
  private buildModeConfig(
    task: AgentTask,
    phase: "plan" | "execute",
    mode: CodeMode | undefined,
    context: AssembledContext
  ): PromptModeConfig {
    // Template paths
    const basePrefix = `${task}/base`;
    const phasePrefix = `${task}/phases/${phase}`;
    
    // Base templates
    const templates = {
      base: `${phasePrefix}/base`,
      rules: `${phasePrefix}/rules`,
      injections: this.selectInjections(task, phase, context)
    };
    
    // LLM parameters based on task
    const llmParams = this.getLLMParams(task, phase, mode);
    
    // Feature flags
    const flags = {
      includeExamples: phase === 'execute' && task === 'code',
      includeProfiles: phase === 'execute' && task === 'code' && context.stats.codebaseDetected,
      includeMemory: context.stats.hasMemory,
      strictValidation: task === 'code'
    };
    
    return {
      task,
      phase,
      mode,
      templates,
      llmParams,
      flags
    };
  }
  
  /**
   * Select appropriate injections based on context
   */
  private selectInjections(
    task: AgentTask,
    phase: "plan" | "execute",
    context: AssembledContext
  ): string[] {
    const basePrefix = `${task}/base/injections`;
    const phasePrefix = `${task}/phases/${phase}/injections`;
    const injections: string[] = [];
    
    // Base injections (common to task)
    if (context.stats.hasDirective) {
      injections.push(`${basePrefix}/directive`);
    }
    
    if (context.stats.hasMemory) {
      injections.push(`${basePrefix}/memory`);
    }
    
    // Session history (short-term context about recent work)
    if (context.stats.hasSessionHistory) {
      injections.push(`${basePrefix}/session-history`);
    }
    
    if (context.designDoc) {
      injections.push(`${basePrefix}/design-doc`);
    }
    
    if (context.prdSpec) {
      injections.push(`${basePrefix}/prd-spec`);
    }
    
    if (context.originalFiles) {
      injections.push(`${basePrefix}/original-files`);
    }
    
    if (context.currentCode && !context.originalFiles) {
      injections.push(`${basePrefix}/current-code`);
    }
    
    // Phase-specific injections
    if (phase === 'plan') {
      // New project setup warning
      if (!context.stats.hasOriginalFiles && task === 'code') {
        injections.push(`${phasePrefix}/new-project-warning`);
      }
      
      // Modification warning for existing code
      if (context.stats.hasOriginalFiles) {
        injections.push(`${phasePrefix}/modification-warning`);
      }
    }
    
    if (phase === 'execute') {
      // Runtime error fix detection (highest priority if directive contains error messages)
      if (context.directive && this.containsRuntimeError(context.directive)) {
        injections.push(`${phasePrefix}/runtime-error-fix`);
      }
      
      // New project setup injection (highest priority for new projects)
      if (!context.stats.hasOriginalFiles && task === 'code') {
        // General setup guide (language-agnostic)
        injections.push(`${phasePrefix}/new-project-setup-general`);
        
        // Language-specific setup details
        const language = this.detectLanguage(context);
        const languageConfigPath = `${task}/languages/${language}/setup/config`;
        injections.push(languageConfigPath);
      }
      
      if (context.stats.hasOriginalFiles) {
        injections.push(`${phasePrefix}/modification-details`);
        injections.push(`${phasePrefix}/pre-output-check`);
      }
      
      if (context.directive) {
        injections.push(`${phasePrefix}/response`);
      }
    }
    
    return injections;
  }
  
  /**
   * Detect project language from codebase profile or design document
   */
  private detectLanguage(context: AssembledContext): string {
    // 1. Try to get from codebase profile (existing projects)
    if (context.codebaseProfile?.language) {
      const lang = context.codebaseProfile.language.toLowerCase();
      // Map known languages
      if (lang.includes('typescript') || lang.includes('javascript')) return 'typescript';
      if (lang.includes('go') || lang.includes('golang')) return 'golang';
      if (lang.includes('python')) return 'python';
      if (lang.includes('rust')) return 'rust';
      if (lang.includes('java')) return 'java';
    }
    
    // 2. Try to detect from design document (new projects)
    if (context.designDoc) {
      const doc = context.designDoc.toLowerCase();
      
      // Check for language keywords in order of specificity
      if (doc.includes('typescript') || doc.includes('tsconfig') || doc.includes('@types/')) {
        return 'typescript';
      }
      if (doc.includes('golang') || doc.includes('go.mod') || doc.includes('go 1.')) {
        return 'golang';
      }
      if (doc.includes('python') || doc.includes('pyproject.toml') || doc.includes('requirements.txt') || doc.includes('fastapi') || doc.includes('django')) {
        return 'python';
      }
      if (doc.includes('rust') || doc.includes('cargo.toml')) {
        return 'rust';
      }
      if (doc.includes('java') || doc.includes('maven') || doc.includes('gradle')) {
        return 'java';
      }
      
      // Check for framework indicators
      if (doc.includes('react') || doc.includes('vue') || doc.includes('next.js') || doc.includes('vite')) {
        return 'typescript';  // Most modern frameworks use TS
      }
    }
    
    // 3. Default to TypeScript (most common in current projects)
    console.log('[ModeController] Could not detect language, defaulting to TypeScript');
    return 'typescript';
  }
  
  /**
   * Detect if directive contains runtime error messages or execution feedback
   */
  private containsRuntimeError(directive: string): boolean {
    const errorPatterns = [
      // Error types
      /Error:/i,
      /TypeError/i,
      /ReferenceError/i,
      /SyntaxError/i,
      /RangeError/i,
      /ELIFECYCLE/i,
      /npm ERR!/i,
      
      // Stack traces
      /\s+at\s+\S+\s+\(/i,  // "at functionName (file.js:10:5)"
      /node_modules/i,
      
      // Common error keywords
      /failed to/i,
      /cannot find/i,
      /undefined is not/i,
      /unexpected token/i,
      /module not found/i,
      /command failed/i,
      /compilation error/i,
      
      // Terminal output patterns
      /\$ npm run/i,
      /\$ node /i,
      /Process exited with code/i,
      
      // Test failures
      /test.*failed/i,
      /assertion.*failed/i,
      /expected.*but got/i
    ];
    
    return errorPatterns.some(pattern => pattern.test(directive));
  }
  
  /**
   * Get LLM parameters for mode
   */
  private getLLMParams(
    task: AgentTask,
    phase: "plan" | "execute",
    mode?: CodeMode
  ): PromptModeConfig['llmParams'] {
    // Base parameters
    const base: PromptModeConfig['llmParams'] = {
      temperature: 0.7,
      maxTokens: undefined,
      topP: 0.95
    };
    
    // Adjust for task
    if (task === 'code') {
      base.temperature = 0.3;  // More deterministic for code
      base.maxTokens = 16000;
    } else if (task === 'design') {
      base.temperature = 0.5;
      base.maxTokens = 8000;
    } else if (task === 'learn') {
      base.temperature = 0.4;
    }
    
    // Adjust for phase
    if (phase === 'plan') {
      base.temperature += 0.1;  // Slightly more creative for planning
    }
    
    // Adjust for mode
    if (mode === 'explain') {
      base.temperature = 0.5;  // More flexible for explanations
    } else if (mode === 'refactor') {
      base.temperature = 0.2;  // Very deterministic for refactoring
    }
    
    return base;
  }
}

