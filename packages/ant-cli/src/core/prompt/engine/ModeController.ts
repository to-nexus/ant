import { AgentTask, CodeMode, ProjectEnvironment } from "../../types";
import { AssembledContext } from "./ContextAssembler";

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
    // ✅ Use explicit mode only - LLM will infer in detectEnvironment if needed
    const mode: CodeMode | undefined = explicitMode;
    
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
    // ✅ design task uses explicit base-system-design.md and rules-system-design.md
    // ui-design has separate loading logic in docGen.ts (base-ui-design.md, rules-ui-design.md)
    const baseTemplateName = task === 'design' ? 'base-system-design' : 'base';
    const rulesTemplateName = task === 'design' ? 'rules-system-design' : 'rules';
    const templates = {
      base: `${phasePrefix}/${baseTemplateName}`,
      rules: `${phasePrefix}/${rulesTemplateName}`,
      injections: this.selectInjections(task, phase, context, taskType, mode)
    };
    
    // LLM parameters based on task
    const llmParams = this.getLLMParams(task, phase, mode);
    
    // Feature flags
    const flags = {
      // Examples are helpful for feature/error tasks but are counterproductive for setup:
      // they increase the chance the model scaffolds extra files (components/sections) despite setup constraints.
      includeExamples: phase === 'execute' && task === 'code' && context.currentTask?.type !== 'setup',
      // ✅ CRITICAL: Include profiles for BOTH new and existing projects
      // Profile is detected by detectEnvironment node from design doc (new) or existing code (existing)
      // Without this, new projects have no TypeScript/React guidance and generate vanilla JS!
      includeProfiles: phase === 'execute' && task === 'code',
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
    taskType?: string,
    mode?: CodeMode
  ): string[] {
    const commonPrefix = `common/injections`;  // ✅ All jobs (templates/common/injections)
    const taskPrefix = `${task}/base/injections`;  // ✅ Task-specific (templates/{task}/base/injections)
    const phasePrefix = `${task}/phases/${phase}/injections`;  // ✅ Phase-specific
    const injections: string[] = [];
    
    // ✅ SETUP TASK: Add language-specific setup constraints
    if (taskType === 'setup') {
      const language = this.detectLanguage(context);
      if (language) {
        injections.push(`${task}/phases/execute/languages/${language}/setup/constraints`);
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
    
    // ✅ PRD for both design and code jobs (prevents information loss in design transformation)
    if (context.prdSpec) {
      injections.push(`${commonPrefix}/prd-spec`);
    }
    
    // ✅ Optional UI doc (Figma-derived) - pass only when caller decides it's UI-relevant
    if (context.uiDoc) {
      injections.push(`${commonPrefix}/ui-doc`);
    }
    
    // Code job specific injections (moved to code/base/injections)
    if (task === 'code') {
      // Git diff summary
      if (context.projectCodeContext?.gitDiff) {
        injections.push(`${taskPrefix}/git-diff`);
      }
      
      // Retrieved code (from Plan node's RAG - available in Execute phase)
      if (context.projectCodeContext?.files && context.projectCodeContext.files.length > 0) {
        injections.push(`${taskPrefix}/retrieved-code`);
      }
      
      // Reference code (only available in Execute phase after Plan loads it)
      if (context.referenceCodeContexts && context.referenceCodeContexts.length > 0) {
        injections.push(`${taskPrefix}/reference-code`);
      }
      
      // Behavioral debugging (only for refactor mode)
      if (this.isRefactorMode(mode, context)) {
        injections.push(`${taskPrefix}/behavioral-debugging`);
        console.log('[ModeController] Adding behavioral-debugging for refactor mode');
      }
    }
    
    // Phase-specific injections
    if (phase === 'execute') {
      // Environment-specific rules (code job only)
      const language = this.detectLanguage(context);
      const environment = this.detectEnvironment(context);
      
      if (language && task === 'code') {
        const envPath = `${task}/phases/execute/languages/${language}/environments/${environment}/rules`;
        injections.push(envPath);
        console.log(`[ModeController] Adding environment-specific injection: ${envPath}`);
        
        // ✅ NEW: Dev server setup for frontend projects
        if (environment === 'browser' || environment === 'fullstack') {
          injections.push(`${taskPrefix}/dev-server-setup`);
          console.log(`[ModeController] Adding dev-server-setup for frontend environment`);
          // ✅ NEW: Dev server runtime contract (dynamic env injection: API base, ports)
          injections.push(`${taskPrefix}/dev-server-env-contract`);
        }
      }
      
      // ✅ NEW: Compact tool-calling rules (replaces verbose version)
      if (task === 'code') {
        injections.push(`${taskPrefix}/tool-calling-rules-compact`);
        console.log(`[ModeController] Adding compact tool-calling rules`);
        
        // ✅ Port management guide (CRITICAL for run_command safety)
        injections.push(`code/phases/execute/injections/port-management`);
        console.log(`[ModeController] Adding port-management guide`);
      }
      
      // Domain-specific design guides (design job only, execute phase only)
      if (task === 'design') {
        // ✅ Document type-specific guides (api-contract, frontend, backend)
        const targetFile = context.currentTask?.targetFile;
        if (targetFile) {
          if (targetFile.includes('api-contract')) {
            injections.push(`design/base/injections/api-contract-guide`);
            console.log(`[ModeController] Adding api-contract-guide for targetFile: ${targetFile}`);
          } else if (targetFile.includes('fe-system-design') || targetFile.includes('frontend')) {
            injections.push(`design/base/injections/frontend-guide`);
            console.log(`[ModeController] Adding frontend-guide for targetFile: ${targetFile}`);
          } else if (targetFile.includes('be-system-design') || targetFile.includes('backend')) {
            injections.push(`design/base/injections/backend-guide`);
            console.log(`[ModeController] Adding backend-guide for targetFile: ${targetFile}`);
          }
        }
        
        // ✅ Domain-specific guides (game vs service)
        if (context.designDomain === 'game') {
          const gameGuidePath = `design/phases/execute/injections/game-domain-guide`;
          injections.push(gameGuidePath);
          console.log(`[ModeController] Adding game-domain design injection: ${gameGuidePath}`);
        } else if (context.designDomain === 'service') {
          const serviceGuidePath = `design/phases/execute/injections/service-domain-guide`;
          injections.push(serviceGuidePath);
          console.log(`[ModeController] Adding service-domain design injection: ${serviceGuidePath}`);
        }
      }
      
      // Retry context (only on retries)
      if (context.retryContext) {
        injections.push(`code/phases/execute/injections/retry-context`);
      }
      
      // Lessons from previous work
      if (context.lessons && context.lessons.length > 0) {
        injections.push(`code/phases/execute/injections/lessons`);
      }
      
      // Session context (compressed history)
      if (context.sessionContext && context.sessionContext.totalTurns > 0) {
        injections.push(`code/phases/execute/injections/session-context`);
      }
      
      // Missing dependency fix (language-specific)
      if (context.stats.hasMissingDependency && language && task === 'code') {
        injections.push(`code/phases/execute/injections/missing-dependency-fix`);
      }
      
      // Runtime error fix
      if (context.directive && this.containsRuntimeError(context.directive)) {
        injections.push(`code/phases/execute/injections/runtime-error-fix`);
      }
      
      // New project setup (only for setup tasks)
      if (!context.stats.hasProjectCode && task === 'code' && context.currentTask?.type === 'setup' && language) {
        const languageConfigPath = `${task}/phases/execute/languages/${language}/setup/config`;
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
    // 0. ✨ HIGHEST PRIORITY: Use pre-detected environment from detectEnvironment node (LLM-based)
    // This is more accurate than heuristics as it analyzed the full design document
    const preDetected = (context as any).detectedEnvironment;
    if (preDetected) {
      const envMap: Record<string, string> = {
        'frontend': 'browser',
        'backend': 'node-api',
        'fullstack': 'fullstack',
      };
      const mapped = envMap[preDetected];
      if (mapped) {
        console.log(`[ModeController] Using pre-detected environment from LLM: ${preDetected} -> ${mapped}`);
        return mapped;
      }
    }

    // 1. Fallback: Design document file name convention (fe-*, be-*)
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
    // ✅ Language detection is now handled by LLM in detectEnvironment node
    // This function only maps the profile language to template paths
    
    // 1. Check if profile was set by LLM (detectEnvironment node)
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
    
    // 2. Default to TypeScript
    // (LLM should set profile in detectEnvironment, but fallback to TS if not set)
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
   * Check if this is refactor mode (fixing existing code)
   */
  private isRefactorMode(mode: CodeMode | undefined, context: AssembledContext): boolean {
    // Explicit mode takes precedence
    if (mode === 'refactor') {
      return true;
    }
    
    // Fallback: Infer from context
    // If there's existing code and the task is error-related, likely refactor
    if (context.stats.hasProjectCode && context.currentTask?.type === 'error') {
      return true;
    }
    
    return false;
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

