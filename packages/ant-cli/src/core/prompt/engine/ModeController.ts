import { AgentTask, CodeMode, ProjectEnvironment } from "../../types";
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
    explicitMode?: CodeMode,
    taskType?: string  // 'setup' | 'feature' | 'error'
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
    return this.buildModeConfig(task, phase, mode, context, taskType);
  }
  
  /**
   * Build mode configuration
   */
  private buildModeConfig(
    task: AgentTask,
    phase: "plan" | "execute",
    mode: CodeMode | undefined,
    context: AssembledContext,
    taskType?: string
  ): PromptModeConfig {
    // Template paths
    const basePrefix = `${task}/base`;
    const phasePrefix = `${task}/phases/${phase}`;
    
    // Base templates
    const templates = {
      base: `${phasePrefix}/base`,
      rules: `${phasePrefix}/rules`,
      injections: this.selectInjections(task, phase, context, taskType)
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
    context: AssembledContext,
    taskType?: string
  ): string[] {
    const commonPrefix = `base/injections`;  // ✅ All jobs (templates/base/injections)
    const taskPrefix = `${task}/base/injections`;  // ✅ Task-specific (templates/{task}/base/injections)
    const phasePrefix = `${task}/phases/${phase}/injections`;  // ✅ Phase-specific
    const injections: string[] = [];
    
    // ✅ SETUP TASK: Add language-specific setup constraints
    if (taskType === 'setup') {
      const language = this.detectLanguage(context);
      if (language) {
        injections.push(`${task}/languages/${language}/setup/constraints`);
      }
    }
    
    // ✅ Common injections (used by ALL jobs - code, design, learn)
    if (context.stats.hasDirective) {
      injections.push(`${commonPrefix}/directive`);
    }
    
    if (context.stats.hasMemory) {
      injections.push(`${commonPrefix}/memory`);
    }
    
    if (context.designDoc) {
      injections.push(`${commonPrefix}/design-doc`);
    }
    
    if (context.prdSpec) {
      injections.push(`${commonPrefix}/prd-spec`);
    }
    
    if (context.originalFiles) {
      injections.push(`${commonPrefix}/original-files`);
    }
    
    if (context.currentCode && !context.originalFiles) {
      injections.push(`${commonPrefix}/current-code`);
    }
    
    // Phase-specific injections
    if (phase === 'plan') {
      // New project setup warning (ONLY for setup tasks!)
      if (!context.stats.hasOriginalFiles && task === 'code' && context.currentTask?.type === 'setup') {
        injections.push(`${phasePrefix}/new-project-warning`);
      }
      
      // Modification warning for existing code
      if (context.stats.hasOriginalFiles) {
        injections.push(`${phasePrefix}/modification-warning`);
      }
    }
    
    if (phase === 'execute') {
      // Environment-specific rules
      const language = this.detectLanguage(context);
      const environment = this.detectEnvironment(context);
      
      if (language && task === 'code') {
        const envPath = `${task}/languages/${language}/environments/${environment}/rules`;
        injections.push(envPath);
        console.log(`[ModeController] Adding environment-specific injection: ${envPath}`);
      }
      
      // ✅ NEW: Compact tool-calling rules (replaces verbose version)
      if (task === 'code') {
        injections.push(`${taskPrefix}/tool-calling-rules-compact`);
        console.log(`[ModeController] Adding compact tool-calling rules`);
      }
      
      // Markdown file streaming format
      if (task === 'code') {
        injections.push(`${commonPrefix}/output-format-markdown`);
        console.log(`[ModeController] Adding markdown streaming format injection`);
      }
      
      // Retry context (only on retries)
      if (context.retryContext) {
        injections.push(`${phasePrefix}/injections/retry-context`);
      }
      
      // Lessons from previous work
      if (context.lessons && context.lessons.length > 0) {
        injections.push(`${phasePrefix}/injections/lessons`);
      }
      
      // Session context (compressed history)
      if (context.sessionContext && context.sessionContext.totalTurns > 0) {
        injections.push(`${phasePrefix}/injections/session-context`);
      }
      
      // Missing dependency fix (language-specific)
      if (context.stats.hasMissingDependency && language && task === 'code') {
        injections.push(`${task}/languages/${language}/execute/missing-dependency-fix`);
      }
      
      // Runtime error fix
      if (context.directive && this.containsRuntimeError(context.directive)) {
        injections.push(`${phasePrefix}/injections/runtime-error-fix`);
      }
      
      // New project setup (only for setup tasks)
      if (!context.stats.hasOriginalFiles && task === 'code' && context.currentTask?.type === 'setup') {
        const languageConfigPath = `${task}/languages/${language}/setup/config`;
        injections.push(languageConfigPath);
      }
      
      
    }
    
    return injections;
  }
  
  /**
   * Detect project environment from codebase profile or design document
   * Always returns an inferred environment (never null)
   */
  private detectEnvironment(context: AssembledContext): string {
    // 0. ✨ HIGHEST PRIORITY: Design document file name convention (fe-*, be-*)
    if (context.designDocPath) {
      const fileName = context.designDocPath.toLowerCase();
      
      // Frontend design document
      if (fileName.includes('fe-system-design') || 
          fileName.includes('frontend-design') ||
          fileName.includes('fe-design')) {
        console.log(`[ModeController] Detected environment from file name (${context.designDocPath}): browser`);
        return 'browser';
      }
      
      // Backend design document
      if (fileName.includes('be-system-design') || 
          fileName.includes('backend-design') ||
          fileName.includes('be-design') ||
          fileName.includes('api-design')) {
        console.log(`[ModeController] Detected environment from file name (${context.designDocPath}): node-api`);
        return 'node-api';
      }
      
      // Fullstack design document
      if (fileName.includes('fullstack-design') || 
          fileName.includes('fs-design')) {
        console.log(`[ModeController] Detected environment from file name (${context.designDocPath}): fullstack`);
        return 'fullstack';
      }
    }
    
    // 1. Try to get from codebase profile (existing projects)
    const env = context.codebaseProfile?.environment;
    if (env) {
      // Map ProjectEnvironment to directory name
      switch (env.primary) {
        case ProjectEnvironment.BROWSER:
          return 'browser';
        case ProjectEnvironment.NODE_API:
          return 'node-api';
        case ProjectEnvironment.NODE_CLI:
          return 'node-cli';
        case ProjectEnvironment.FULLSTACK:
          return 'fullstack';
        case ProjectEnvironment.CONFIG:
          return 'config';
        default:
          console.log(`[ModeController] Unknown environment type: ${env.primary}, defaulting to: browser`);
          return 'browser';
      }
    }
    
    // 2. Try to infer from design document content (new projects)
    if (context.designDoc) {
      const doc = context.designDoc.toLowerCase();
      
      // Fullstack frameworks (highest priority)
      if (doc.includes('next.js') || doc.includes('nextjs') || doc.includes('next app router')) {
        console.log('[ModeController] Inferred environment from design doc: fullstack (Next.js)');
        return 'fullstack';
      }
      if (doc.includes('remix') || doc.includes('@remix-run')) {
        console.log('[ModeController] Inferred environment from design doc: fullstack (Remix)');
        return 'fullstack';
      }
      if (doc.includes('sveltekit') || doc.includes('svelte kit')) {
        console.log('[ModeController] Inferred environment from design doc: fullstack (SvelteKit)');
        return 'fullstack';
      }
      if (doc.includes('nuxt')) {
        console.log('[ModeController] Inferred environment from design doc: fullstack (Nuxt)');
        return 'fullstack';
      }
      
      // Backend API indicators
      const isBackendAPI = 
        doc.includes('api server') ||
        doc.includes('backend api') ||
        doc.includes('rest api') ||
        doc.includes('graphql api') ||
        doc.includes('express') ||
        doc.includes('fastify') ||
        doc.includes('nestjs') ||
        doc.includes('koa') ||
        doc.includes('hapi') ||
        doc.includes('database') && (doc.includes('prisma') || doc.includes('typeorm') || doc.includes('mongoose')) ||
        doc.includes('microservice');
      
      if (isBackendAPI) {
        console.log('[ModeController] Inferred environment from design doc: node-api');
        return 'node-api';
      }
      
      // Browser SPA indicators
      const isBrowserSPA = 
        doc.includes('single page application') ||
        doc.includes('spa') && !doc.includes('spa ') || // "SPA" but not "spa ce"
        doc.includes('react app') ||
        doc.includes('vue app') ||
        doc.includes('angular app') ||
        doc.includes('frontend') && (doc.includes('react') || doc.includes('vue') || doc.includes('angular')) ||
        doc.includes('vite') && (doc.includes('react') || doc.includes('vue')) ||
        doc.includes('web app') && (doc.includes('react') || doc.includes('vue'));
      
      if (isBrowserSPA) {
        console.log('[ModeController] Inferred environment from design doc: browser');
        return 'browser';
      }
      
      // CLI tool indicators
      const isCLI = 
        doc.includes('cli tool') ||
        doc.includes('command-line') ||
        doc.includes('command line tool') ||
        doc.includes('cli application') ||
        doc.includes('terminal tool') ||
        doc.includes('npm package') && doc.includes('bin') ||
        doc.includes('commander') ||
        doc.includes('inquirer');
      
      if (isCLI) {
        console.log('[ModeController] Inferred environment from design doc: node-cli');
        return 'node-cli';
      }
    }
    
    // 3. Infer from language and context (no design doc or unclear indicators)
    const language = this.detectLanguage(context);
    
    // If TypeScript/JavaScript without clear indicators, default to browser (most common)
    if (language === 'typescript' || language === 'javascript') {
      console.log('[ModeController] No clear environment indicators, defaulting to: browser');
      return 'browser';
    }
    
    // For backend languages, default to node-api
    if (language === 'golang' || language === 'python' || language === 'rust' || language === 'java') {
      console.log(`[ModeController] Backend language (${language}), defaulting to: node-api`);
      return 'node-api';
    }
    
    // Ultimate fallback: browser (safest for web projects)
    console.log('[ModeController] Ultimate fallback, defaulting to: browser');
    return 'browser';
  }
  
  /**
   * Detect project language from codebase profile or design document
   */
  private detectLanguage(context: AssembledContext): string {
    // 1. Try to get from codebase profile (existing projects)
    if (context.codebaseProfile?.language) {
      const lang = context.codebaseProfile.language.toLowerCase();
      // Map known languages
      if (lang.includes('typescript') || lang.includes('javascript')) {
        return 'typescript';
      }
      if (lang.includes('go') || lang.includes('golang')) {
        return 'golang';
      }
      if (lang.includes('python')) {
        return 'python';
      }
      if (lang.includes('rust')) {
        return 'rust';
      }
      if (lang.includes('java')) {
        return 'java';
      }
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
    return 'typescript';
  }
  
  // ✅ REMOVED: containsTypeScriptError
  // TypeScript errors are now handled by:
  // 1. diagnostics/languages/typescript.ts (549 lines of patterns)
  // 2. ErrorParserFactory (structured error parsing)
  // 3. enforce node provides structured violations with suggestedFix
  // 4. LLM's native TypeScript error fixing capability
  // No need for 278-line typescript-error-fix.md injection!
  
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

