import { AgentJob, JobMode, ProjectEnvironment } from "../../types";
import { AssembledContext } from "./ContextAssembler";
import type { ResolvedActionContext } from "@ant/shared";

/**
 * Prompt mode configuration
 * Defines how prompts should be assembled for each mode
 */
export interface PromptModeConfig {
  job: AgentJob;
  phase: "plan" | "execute";
  mode?: JobMode;
  
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
 * Selects and configures prompt mode based on job, phase, and context
 * 
 * Responsibilities:
 * - Determine appropriate mode for code job
 * - Select template paths
 * - Configure LLM parameters
 * - Define injection strategy
 */
export class ModeController {
  /**
   * Determine mode configuration for a given input
   */
  determineMode(
    job: AgentJob,
    phase: "plan" | "execute",
    context: AssembledContext,
    explicitMode?: JobMode,
    taskType?: string,  // 'setup' | 'feature' | 'test-code' | 'doc' | 'error'
    resolvedAction?: ResolvedActionContext,
  ): PromptModeConfig {
    const mode: JobMode | undefined = explicitMode;
    return this.buildModeConfig(job, phase, mode, context, taskType, resolvedAction);
  }
  
  /**
   * Build mode configuration
   */
  private buildModeConfig(
    job: AgentJob,
    phase: "plan" | "execute",
    mode: JobMode | undefined,
    context: AssembledContext,
    taskType?: string,
    resolvedAction?: ResolvedActionContext,
  ): PromptModeConfig {
    // Template paths
    const basePrefix = `${job}/base`;
    const phasePrefix = `${job}/phases/${phase}`;
    
    // Base templates
    // ✅ design job uses explicit base-system-design.md and rules-system-design.md
    // ui-design has separate loading logic in docGen.ts (base-ui-design.md, rules-ui-design.md)
    // ✅ verification, error, and test-code tasks use dedicated templates (lean, focused)
    const isVerification = taskType === 'verification';
    const isError = taskType === 'error';
    const isTestCode = taskType === 'test-code';
    const isDoc = taskType === 'doc';
    const executeTasksPrefix = `${job}/phases/execute/tasks`;
    const verifyPhasePrefix = `${executeTasksPrefix}/verification`;
    const errorPhasePrefix = `${executeTasksPrefix}/error`;
    const testCodePhasePrefix = `${executeTasksPrefix}/test-code`;
    const docgenPhasePrefix = `${executeTasksPrefix}/docgen`;
    const baseTemplateName = job === 'design' ? 'base-system-design' : 'base';
    const rulesTemplateName = job === 'design' ? 'rules-system-design' : 'rules';
    
    let templateBase: string;
    let templateRules: string;
    if (isVerification) {
      templateBase = `${verifyPhasePrefix}/base`;
      templateRules = `${verifyPhasePrefix}/rules`;
    } else if (isError) {
      templateBase = `${errorPhasePrefix}/base`;
      templateRules = `${errorPhasePrefix}/rules`;
    } else if (isTestCode) {
      templateBase = `${testCodePhasePrefix}/base`;
      templateRules = `${testCodePhasePrefix}/rules`;
    } else if (isDoc) {
      templateBase = `${docgenPhasePrefix}/base`;
      templateRules = `${docgenPhasePrefix}/rules`;
    } else {
      templateBase = `${phasePrefix}/${baseTemplateName}`;
      templateRules = `${phasePrefix}/${rulesTemplateName}`;
    }
    
    const templates = {
      base: templateBase,
      rules: templateRules,
      injections: this.selectInjections(job, phase, context, taskType, mode, resolvedAction)
    };
    
    // LLM parameters based on job
    const llmParams = this.getLLMParams(job, phase, mode);
    
    // Feature flags
    const skipHeavyContext = isVerification || isTestCode || isDoc || isError;
    const flags = {
      includeExamples: phase === 'execute' && job === 'code' && context.currentTask?.type !== 'setup' && !skipHeavyContext,
      includeProfiles: (phase === 'execute' || phase === 'plan') && job === 'code',
      includeMemory: context.stats.hasMemory,
      strictValidation: job === 'code'
    };
    
    return {
      job,
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
    job: AgentJob,
    phase: "plan" | "execute",
    context: AssembledContext,
    taskType?: string,
    mode?: JobMode,
    resolvedAction?: ResolvedActionContext,
  ): string[] {
    const commonPrefix = `common/injections`;  // ✅ All jobs (templates/common/injections)
    const jobPrefix = `${job}/base/injections`;  // ✅ Job-specific (templates/{job}/base/injections)
    const phasePrefix = `${job}/phases/${phase}/injections`;  // ✅ Phase-specific
    const injections: string[] = [];
    
    // ✅ SETUP TASK: Add language-specific setup constraints
    if (taskType === 'setup') {
      const language = this.detectLanguage(context);
      if (language) {
        injections.push(`${job}/phases/execute/languages/${language}/setup/constraints`);
      }
    }
    
    // ✅ Verification, test-code, doc tasks skip static policy injections.
    const isVerification = taskType === 'verification';
    const isError = taskType === 'error';
    const isTestCode = taskType === 'test-code';
    const isDoc = taskType === 'doc';
    const isExplicit = resolvedAction?.source === 'explicit';
    const hasDocuments = (resolvedAction?.documents?.length ?? 0) > 0;
    const detectedEnv = (isExplicit && resolvedAction?.tech?.environment)
      || (context as any).detectedEnvironment as string | undefined;

    // visual-source-authority: static policy, independent of documents
    const skipStaticPolicy = isVerification || isTestCode || isDoc;

    // ✅ Common injections (used by ALL jobs - code, design, learn)
    if (context.stats.hasDirective) {
      injections.push(`${commonPrefix}/directive`);
    }
    
    if (context.stats.hasMemory) {
      injections.push(`${commonPrefix}/memory`);
    }
    
    // ✅ Visual source authority principles — always for frontend projects
    if (!skipStaticPolicy && detectedEnv !== 'backend') {
      injections.push(`${commonPrefix}/visual-source-authority`);
    }
    // ✅ UI design policy — static rules when documents contain UI spec
    const hasUiInDocuments = (resolvedAction?.documents || []).some(d => d.path?.includes('ui-'));
    if (hasUiInDocuments && !skipStaticPolicy && detectedEnv !== 'backend') {
      injections.push(`${commonPrefix}/ui-design-policy`);
    }
    
    // Code job specific injections (moved to code/base/injections)
    if (job === 'code') {
      // Git diff summary
      if (context.projectCodeContext?.gitDiff) {
        injections.push(`${jobPrefix}/git-diff`);
      }
      
      // Retrieved code (from Plan node's RAG - available in Execute phase)
      if (context.projectCodeContext?.files && context.projectCodeContext.files.length > 0) {
        injections.push(`${jobPrefix}/retrieved-code`);
      }
      
      // Reference code (only available in Execute phase after Plan loads it)
      if (context.referenceCodeContexts && context.referenceCodeContexts.length > 0) {
        injections.push(`${jobPrefix}/reference-code`);
      }
      
      // Behavioral debugging (only for refactor mode)
      if ((isExplicit && resolvedAction?.mode === 'refactor') || this.isRefactorMode(mode, context)) {
        injections.push(`${jobPrefix}/behavioral-debugging`);
        console.log('[ModeController] Adding behavioral-debugging for refactor mode');
      }
    }
    
    // Phase-specific injections
    if (phase === 'execute') {
      const language = (isExplicit && resolvedAction?.tech?.language)
        || this.detectLanguage(context);
      const environment = (isExplicit && this.resolveEnvironmentFromRAC(resolvedAction, language))
        || this.detectEnvironment(context, language);
      
      // Diagnostic (verification/error) and test-code tasks use dedicated templates.
      // Environment-specific rules (e.g. go-api/rules.md) contain "Do NOT run build commands"
      // which contradicts diagnostic tasks' purpose. tool-calling-rules-compact is
      // already included via Handlebars partial in verify/rules.md and error/rules.md.
      if (!isVerification && !isError && !isTestCode && !isDoc) {
        if (language && job === 'code') {
          if (environment === 'fullstack') {
            // Fullstack = browser + backend + fullstack-specific rules.
            // Inject all three so the LLM has actual rules for both contexts,
            // not just verbal pointers saying "follow browser/backend rules".
            const backendEnv = language === 'go' ? 'go-api' : 'node-api';
            const browserPath = `${job}/phases/execute/languages/${language}/environments/browser/rules`;
            const backendPath = `${job}/phases/execute/languages/${language}/environments/${backendEnv}/rules`;
            const fullstackPath = `${job}/phases/execute/languages/${language}/environments/fullstack/rules`;
            injections.push(browserPath);
            injections.push(backendPath);
            injections.push(fullstackPath);
            console.log(`[ModeController] Adding fullstack composite injection: ${browserPath}, ${backendPath}, ${fullstackPath}`);
          } else {
            const envPath = `${job}/phases/execute/languages/${language}/environments/${environment}/rules`;
            injections.push(envPath);
            console.log(`[ModeController] Adding environment-specific injection: ${envPath}`);
          }
          
          if (environment === 'browser' || environment === 'fullstack') {
            injections.push(`${jobPrefix}/preview-setup`);
            console.log(`[ModeController] Adding preview-setup for frontend environment`);
          }
        }

        if (job === 'code') {
          injections.push(`${jobPrefix}/tool-calling-rules-compact`);
          console.log(`[ModeController] Adding compact tool-calling rules`);
        }
      }

      // preview-setup is also needed for error tasks in browser/fullstack environments.
      // Error tasks may modify next.config / vite.config and must know the basePath
      // requirements even though they skip environment-specific rules.
      if (isError && (environment === 'browser' || environment === 'fullstack')) {
        injections.push(`${jobPrefix}/preview-setup`);
        console.log(`[ModeController] Adding preview-setup for error task in frontend environment`);
      }

      // Verification language hints are now injected into the plan verification prompt
      // (buildVerificationPlanPrompt) where build/test execution actually happens.
      // execute only applies code fixes — it doesn't need build system hints.
      
      // Test-code: inject language-specific hints (test frameworks, mock patterns)
      if (isTestCode && language && job === 'code') {
        const hintsPath = `${job}/phases/execute/tasks/test-code/languages/${language}/hints`;
        injections.push(hintsPath);
        console.log(`[ModeController] Adding test-code language hints: ${hintsPath}`);
      }
      
      // Backend safety: common safety principles for backend/fullstack environments.
      // Included for execute AND test-code phases — test-code needs safety context to generate security test cases.
      if (job === 'code' && !isVerification && !isDoc) {
        if (detectedEnv === 'backend' || detectedEnv === 'fullstack') {
          injections.push(`code/phases/execute/injections/backend-safety`);
          console.log(`[ModeController] Adding backend-safety for env: ${detectedEnv}`);
        }
      }
      
      // preview-env-contract and port-management: needed for code tasks that produce
      // application code (setup, feature, error, verification). Testgen/doc only write non-app files.
      if (job === 'code' && !isTestCode && !isDoc) {
        injections.push(`${jobPrefix}/preview-env-contract`);
        console.log(`[ModeController] Adding preview-env-contract`);
        
        injections.push(`code/phases/execute/injections/port-management`);
        console.log(`[ModeController] Adding port-management guide`);
      }
      
      // Domain-specific design guides (design job only, execute phase only)
      if (job === 'design') {
        injections.push('design/base/injections/document-language');
        
        // ✅ Document type-specific guides (api-contract, frontend, backend)
        const targetFile = context.currentTask?.targetFile;
        
        if (targetFile) {
          if (targetFile.includes('api-contract')) {
            injections.push(`design/base/injections/api-contract-guide`);
            console.log(`[ModeController] Adding api-contract-guide for targetFile: ${targetFile}`);
          } else if (targetFile.includes('fe-system-') || targetFile.includes('frontend')) {
            injections.push(`design/base/injections/frontend-guide`);
            console.log(`[ModeController] Adding frontend-guide for targetFile: ${targetFile}`);
          } else if (targetFile.includes('be-system-') || targetFile.includes('backend')) {
            injections.push(`design/base/injections/backend-guide`);
            console.log(`[ModeController] Adding backend-guide for targetFile: ${targetFile}`);
          }
        }
        
        // ✅ Framework-aware augmentations (directory structure principles)
        const frameworkAugmentation = (isExplicit && this.resolveFrameworkFromRAC(resolvedAction, targetFile))
          || this.detectFrameworkAugmentation(context, targetFile);
        if (frameworkAugmentation) {
          injections.push(frameworkAugmentation);
          console.log(`[ModeController] Adding framework augmentation: ${frameworkAugmentation}`);
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
      if (context.sessionContext && context.sessionContext.totalRuns > 0) {
        injections.push(`code/phases/execute/injections/session-context`);
      }
      
      // Missing dependency fix (language-specific)
      if (context.stats.hasMissingDependency && language && job === 'code') {
        injections.push(`code/phases/execute/injections/missing-dependency-fix`);
      }
      
      // Runtime error fix
      if (context.directive && this.containsRuntimeError(context.directive)) {
        injections.push(`code/phases/execute/injections/runtime-error-fix`);
      }
      
      // New project setup (only for setup tasks)
      if (!context.stats.hasProjectCode && job === 'code' && context.currentTask?.type === 'setup' && language) {
        const languageConfigPath = `${job}/phases/execute/languages/${language}/setup/config`;
        injections.push(languageConfigPath);
      }
      
      
    }

    // RAC-only injections (R1-R3): additional injections when resolvedAction is present
    if (resolvedAction) {
      // R1: action-context — always inject when RAC exists
      injections.push('common/injections/action-context');
      // R2: refactor-guidance — when mode is refactor (both explicit and infer)
      if (resolvedAction.mode === 'refactor') {
        injections.push('common/injections/refactor-guidance');
      }
      // R3: explain-guidance — when mode is explain (read-only Q&A)
      if (resolvedAction.mode === 'explain') {
        injections.push('common/injections/explain-guidance');
      }
    }
    
    return injections;
  }
  
  /**
   * Resolve environment from RAC.tech for explicit path.
   * Maps abstract Environment → concrete template directory name.
   */
  private resolveEnvironmentFromRAC(
    rac?: ResolvedActionContext, language?: string
  ): string | undefined {
    if (!rac?.tech?.environment) return undefined;
    const env = rac.tech.environment;
    if (env === 'fullstack') return 'fullstack';
    if (env === 'frontend') return 'browser';
    if (env === 'backend') return language === 'go' ? 'go-api' : 'node-api';
    return undefined;
  }

  /**
   * Resolve framework augmentation from RAC.tech for explicit path.
   * Filters by targetFile so that frontend augmentations only apply to frontend documents.
   */
  private resolveFrameworkFromRAC(
    rac?: ResolvedActionContext, targetFile?: string
  ): string | undefined {
    const fw = rac?.tech?.framework;
    const isFE = !targetFile || targetFile.includes('fe-system-') || targetFile.includes('frontend');
    const isBE = !targetFile || targetFile.includes('be-system-') || targetFile.includes('backend');
    if (fw && (fw === 'nextjs' || fw === 'nuxt') && isFE) {
      return 'design/phases/execute/injections/nextjs-augmentation';
    }
    if (rac?.tech?.language === 'go' && isBE) {
      return 'design/phases/execute/injections/go-api-augmentation';
    }
    return undefined;
  }

  /**
   * Detect project environment from codebase profile or design document
   * Always returns an inferred environment (never null)
   */
  private detectEnvironment(context: AssembledContext, language?: string): string {
    // 0. ✨ HIGHEST PRIORITY: Use pre-detected environment from detectEnvironment node (LLM-based)
    // This is more accurate than heuristics as it analyzed the full design document
    const preDetected = (context as any).detectedEnvironment;
    if (preDetected) {
      // ✅ Language-aware backend environment mapping
      // Go projects use 'go-api' instead of 'node-api' for correct template path resolution
      const backendEnv = language === 'go' ? 'go-api' : 'node-api';
      const envMap: Record<string, string> = {
        'frontend': 'browser',
        'backend': backendEnv,
        'fullstack': 'fullstack',
      };
      const mapped = envMap[preDetected];
      if (mapped) {
        console.log(`[ModeController] Using pre-detected environment from LLM: ${preDetected} -> ${mapped} (language: ${language || 'unknown'})`);
        return mapped;
      }
    }

    // 1. Fallback: Design document file name convention (fe-*, be-*)
    if (context.designDocPath) {
      const fileName = context.designDocPath.toLowerCase();
      
      // Frontend design document
      if (fileName.includes('fe-system-') || 
          fileName.includes('frontend-design') ||
          fileName.includes('fe-design')) {
        console.log(`[ModeController] Detected environment from file name (${context.designDocPath}): browser`);
        return 'browser';
      }
      
      // Backend design document
      if (fileName.includes('be-system-') || 
          fileName.includes('backend-design') ||
          fileName.includes('be-design') ||
          fileName.includes('api-design')) {
        const backendEnv = language === 'go' ? 'go-api' : 'node-api';
        console.log(`[ModeController] Detected environment from file name (${context.designDocPath}): ${backendEnv}`);
        return backendEnv;
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
    
    // 2. Try to infer from documents[] content (new projects)
    const docTexts = (context.documents || []).map(d => d.content).join(' ');
    if (docTexts) {
      const doc = docTexts.toLowerCase();
      
      // SSR frameworks — these are "browser" environment (frontend with optional server-side rendering),
      // NOT "fullstack" (which is reserved for separate BE + FE monorepos like Express + React).
      // browser/rules.md already covers SSR dual-context (Server Components, API Routes, etc.).
      if (doc.includes('next.js') || doc.includes('nextjs') || doc.includes('next app router')) {
        console.log('[ModeController] Inferred environment from documents: browser (Next.js SSR)');
        return 'browser';
      }
      if (doc.includes('remix') || doc.includes('@remix-run')) {
        console.log('[ModeController] Inferred environment from documents: browser (Remix SSR)');
        return 'browser';
      }
      if (doc.includes('sveltekit') || doc.includes('svelte kit')) {
        console.log('[ModeController] Inferred environment from documents: browser (SvelteKit SSR)');
        return 'browser';
      }
      if (doc.includes('nuxt')) {
        console.log('[ModeController] Inferred environment from documents: browser (Nuxt SSR)');
        return 'browser';
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
        doc.includes('gin') && doc.includes('go') ||  // Go: Gin framework
        doc.includes('database') && (doc.includes('prisma') || doc.includes('typeorm') || doc.includes('mongoose') || doc.includes('gorm') || doc.includes('sqlx')) ||
        doc.includes('microservice');
      
      if (isBackendAPI) {
        const backendEnv = language === 'go' ? 'go-api' : 'node-api';
        console.log(`[ModeController] Inferred environment from documents: ${backendEnv}`);
        return backendEnv;
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
        console.log('[ModeController] Inferred environment from documents: browser');
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
        doc.includes('inquirer') ||
        doc.includes('cobra') ||  // Go: Cobra CLI framework
        doc.includes('urfave/cli');  // Go: urfave/cli framework
      
      if (isCLI) {
        const cliEnv = language === 'go' ? 'go-cli' : 'node-cli';
        console.log(`[ModeController] Inferred environment from documents: ${cliEnv}`);
        return cliEnv;
      }
    }
    
    // 3. Infer from language and context (no design doc or unclear indicators)
    const resolvedLanguage = language ?? this.detectLanguage(context);
    
    // If TypeScript/JavaScript without clear indicators, default to browser (most common)
    if (resolvedLanguage === 'typescript' || resolvedLanguage === 'javascript') {
      console.log('[ModeController] No clear environment indicators, defaulting to: browser');
      return 'browser';
    }
    
    // For backend languages, default to language-specific API environment
    if (resolvedLanguage === 'go') {
      console.log(`[ModeController] Backend language (${resolvedLanguage}), defaulting to: go-api`);
      return 'go-api';
    }
    if (resolvedLanguage === 'python' || resolvedLanguage === 'rust' || resolvedLanguage === 'java') {
      console.log(`[ModeController] Backend language (${resolvedLanguage}), defaulting to: node-api`);
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
    // 2. Fallback: Check detectionReport.profile (secondary source, same data via different path)
    const profileLanguage = context.codebaseProfile?.language
      || (context as any).detectionReportProfile?.language;
    
    if (profileLanguage) {
      const lang = profileLanguage.toLowerCase();
      
      // Map known languages
      if (lang.includes('typescript') || lang.includes('javascript')) {
        return 'typescript';
      }
      if (lang.includes('go') || lang.includes('golang')) {
        return 'go';
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
    
    // 3. Default to TypeScript
    // ⚠️ WARNING: If we reach here, language detection failed — this may cause
    // incorrect environment-specific rules injection (e.g., node-api for Go projects)
    const detectedEnv = (context as any).detectedEnvironment;
    if (detectedEnv && detectedEnv !== 'frontend') {
      console.warn(`⚠️  [ModeController] detectLanguage: No codebaseProfile.language available (detectedEnvironment=${detectedEnv}). Defaulting to 'typescript'. This may inject wrong language rules.`);
    }
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
   * Detect framework-specific augmentation for design job.
   * Infers framework from codebase profile, PRD, or design document content.
   * Filters by targetFile so that frontend augmentations only apply to frontend
   * documents and backend augmentations only apply to backend documents.
   */
  private detectFrameworkAugmentation(context: AssembledContext, targetFile?: string): string | undefined {
    const isFrontendDoc = !targetFile || targetFile.includes('fe-system-') || targetFile.includes('frontend');
    const isBackendDoc = !targetFile || targetFile.includes('be-system-') || targetFile.includes('backend');

    // Priority 0: Task-level structured profile (from design job decompose)
    const taskProfile = context.currentTask?.profile;
    if (taskProfile) {
      const fw = taskProfile.framework?.toLowerCase();
      const lang = taskProfile.language?.toLowerCase();
      if ((fw?.includes('next') || fw?.includes('nextjs')) && isFrontendDoc) {
        console.log(`[ModeController] Framework augmentation from task profile: nextjs (${targetFile})`);
        return 'design/phases/execute/injections/nextjs-augmentation';
      }
      if ((lang === 'go' || lang === 'golang') && isBackendDoc) {
        console.log(`[ModeController] Framework augmentation from task profile: go-api (${targetFile})`);
        return 'design/phases/execute/injections/go-api-augmentation';
      }
      // Profile exists but no matching augmentation → skip text search (deterministic)
      return undefined;
    }

    // Priority 1: Check codebase profile (existing projects, Code Job)
    const framework = context.codebaseProfile?.framework?.toLowerCase();
    const language = context.codebaseProfile?.language?.toLowerCase();
    
    if (framework) {
      if ((framework.includes('next') || framework.includes('nextjs')) && isFrontendDoc) {
        return 'design/phases/execute/injections/nextjs-augmentation';
      }
    }
    
    if ((language?.includes('go') || language?.includes('golang')) && isBackendDoc) {
      const preDetected = (context as any).detectedEnvironment;
      if (!preDetected || preDetected === 'backend' || preDetected === 'fullstack') {
        return 'design/phases/execute/injections/go-api-augmentation';
      }
    }
    
    // Priority 2: Infer from documents[] content (fallback for legacy/no-profile cases)
    const textSources = [
      ...(context.documents || []).map(d => d.content),
      context.directive,
    ].filter(Boolean);
    const combined = textSources.join(' ').toLowerCase();
    
    if (!combined) return undefined;
    
    if ((combined.includes('next.js') || combined.includes('nextjs') || combined.includes('next app router')) && isFrontendDoc) {
      return 'design/phases/execute/injections/nextjs-augmentation';
    }
    
    if ((combined.includes('go ') || combined.includes('golang')) && 
        (combined.includes('api') || combined.includes('server') || combined.includes('backend')) && isBackendDoc) {
      return 'design/phases/execute/injections/go-api-augmentation';
    }
    
    return undefined;
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
   * Check if this is refactor mode (fixing existing code)
   */
  private isRefactorMode(mode: JobMode | undefined, context: AssembledContext): boolean {
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
    job: AgentJob,
    phase: "plan" | "execute",
    mode?: JobMode
  ): PromptModeConfig['llmParams'] {
    // Base parameters
    const base: PromptModeConfig['llmParams'] = {
      temperature: 0.7,
      maxTokens: undefined,
      topP: 0.95
    };
    
    // Adjust for job
    if (job === 'code') {
      base.temperature = 0.3;  // More deterministic for code
      base.maxTokens = 16000;
    } else if (job === 'design') {
      base.temperature = 0.5;
      base.maxTokens = 8000;
    } else if (job === 'learn') {
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

