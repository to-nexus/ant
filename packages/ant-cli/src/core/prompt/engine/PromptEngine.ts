import { AgentJob, JobMode, ProjectContext } from "../../types";
import { PromptPort, ProfilePort, CodebaseAnalyzerPort, GitPort, MemoryPort } from "../../ports";
import { InputNormalizer, NormalizedPromptInput } from "./InputNormalizer";
import { ContextAssembler, AssembledContext } from "./ContextAssembler";
import { ModeController, PromptModeConfig } from "./ModeController";
import { TemplateComposer, ComposedPrompt } from "./TemplateComposer";
import { PolicyInjector } from "./PolicyInjector";
import { PromptFormatter, FormattedPrompt } from "./PromptFormatter";
import { ProjectCodeContext, ReferenceCodeContext } from "../types/CodeContext";
import type { ResolvedActionContext, ResolvedDocument } from "@ant/shared";
/**
 * Dependencies for PromptEngine
 */
export interface PromptEngineDeps {
  promptPort: PromptPort;
  profilePort?: ProfilePort;
  analyzer?: CodebaseAnalyzerPort;
  git?: GitPort;
  memory?: MemoryPort;
  contextLoader?: (job: AgentJob, context: any) => Promise<Partial<AssembledContext>>;
}

/**
 * Prompt build result with metadata
 */
export interface PromptBuildResult {
  formatted: FormattedPrompt;
  composed: ComposedPrompt;
  modeConfig: PromptModeConfig;
  context: AssembledContext;
  metadata: {
    normalized: NormalizedPromptInput;
    buildTime: number;
  };
}

/**
 * PromptEngine - 6-Layer Orchestration System
 * 
 * Orchestrates all layers to build high-quality prompts:
 * 1. InputNormalizer - Standardize inputs
 * 2. ContextAssembler - Gather all context
 * 3. ModeController - Select mode and config
 * 4. TemplateComposer - Build prompt from templates
 * 5. PolicyInjector - Add quality guardrails
 * 6. PromptFormatter - Format for LLM API
 */
export class PromptEngine {
  private normalizer: InputNormalizer;
  private assembler: ContextAssembler;
  private controller: ModeController;
  private composer: TemplateComposer;
  private policyInjector: PolicyInjector;
  private formatter: PromptFormatter;
  
  constructor(public deps: PromptEngineDeps) {
    this.normalizer = new InputNormalizer();
    this.assembler = new ContextAssembler();
    this.controller = new ModeController();
    this.composer = new TemplateComposer(deps.promptPort, deps.profilePort);
    this.policyInjector = new PolicyInjector();
    this.formatter = new PromptFormatter();
  }
  
  /**
   * @deprecated Dead code — planGeneration.ts calls buildTaskPlanPrompt() directly.
   * Plan phase does NOT go through 6-layer pipeline / ModeController.
   * Retained for reference; will be removed in a future cleanup.
   */
  async buildPlanPrompt(
    job: AgentJob,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      previousDesign?: string;
      projectCodeContext?: ProjectCodeContext;
      currentTask?: {
        name: string;
        type: string;
        priority: number;
        description: string;
      };
    },
    mode?: JobMode,
    taskType?: string
  ): Promise<PromptBuildResult> {
    const startTime = Date.now();
    
    // Layer 1: Normalize inputs
    const normalized = this.normalizer.normalizePlanInput(
      job,
      context,
      artifacts,
      mode,
      taskType
    );
    
    // Layer 2: Assemble context
    const assembled = await this.assembler.assemble(
      job,
      context,
      {
        git: this.deps.git,
        analyzer: this.deps.analyzer
      },
      this.deps.contextLoader,
      artifacts  // ✅ Pass artifacts to assembler!
    );
    
    // Layer 3: Determine mode configuration
    const modeConfig = this.controller.determineMode(
      job,
      "plan",
      assembled,
      mode,
      taskType,
      assembled.resolvedAction,
    );
    
    // Layer 4: Compose prompt from templates
    const composed = await this.composer.compose(
      modeConfig,
      context,
      assembled
    );
    
    // Layer 5: Inject policies
    const policySection = this.policyInjector.buildPolicySection(modeConfig);
    const guardrailSection = this.policyInjector.buildGuardrailSection(modeConfig);
    
    // Assemble with policies
    const promptWithPolicies = [
      guardrailSection,
      this.composer.assembleFinal(composed, context.userLanguage),  // ✅ Pass userLanguage (plan phase)
      policySection
    ].join('\n\n');
    
    // Layer 6: Format for LLM
    const formatted = this.formatter.format(promptWithPolicies, modeConfig);
    
    const buildTime = Date.now() - startTime;
    
    return {
      formatted,
      composed,
      modeConfig,
      context: assembled,
      metadata: {
        normalized,
        buildTime
      }
    };
  }
  
  /**
   * Build prompt for execute phase
   */
  async buildExecutePrompt(
    job: AgentJob,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      currentCode?: string;
      uiAssets?: any;           // ✅ Optional UI assets index (text-only manifest)
      lastSectionNumber?: number;
      sectionPattern?: string;  // ✅ 'top-level' or 'nested' structure pattern
      isLastTaskForDocument?: boolean;  // ✅ If true, don't output metadata
      sectionScope?: string;  // ✅ Pre-rendered ASSIGNED/FORBIDDEN section scope block
      filteredCatalog?: string;  // ✅ Pre-filtered catalog containing only assigned sections' guides
      previousDesign?: string;
      projectCodeContext?: ProjectCodeContext;
      referenceCodeContexts?: ReferenceCodeContext[];
      lessons?: Array<{
        content: string;
        score: number;
        relatedFiles: string[];
        tags: string[];
        timestamp: string;
        directive?: string;
      }>;
      sessionContext?: {
        recentRuns: Array<{
          runId: number;
          directive: string;
          mode: string;
          output: string;
        }>;
        summary?: string;
        totalRuns: number;
        currentRun: number;
        currentMode: string;
        windowSize: number;
        compressionRatio: number;
      };
      referenceRequests?: Array<{
        project: string;
        branch?: string;
      }>;
      currentTask?: {
        name: string;
        type: string;
        priority: number;
        description: string;
      };
      designDomain?: 'game' | 'service';
      isSpecDriven?: boolean;
      figmaAvailable?: boolean;
      figmaStartNodeId?: string;
      resolvedAction?: ResolvedActionContext;
      documents?: ResolvedDocument[];
    },
    mode?: JobMode,
    taskType?: string
  ): Promise<PromptBuildResult> {
    const startTime = Date.now();
    
    // Layer 1: Normalize inputs
    const normalized = this.normalizer.normalizeExecuteInput(
      job,
      context,
      artifacts,
      mode,
      taskType
    );
    
    // Layer 2: Assemble context
    const assembled = await this.assembler.assemble(
      job,
      context,
      {
        git: this.deps.git,
        analyzer: this.deps.analyzer
      },
      this.deps.contextLoader,
      artifacts  // ✅ Pass artifacts to assembler!
    );
    
    // Layer 3: Determine mode configuration
    const modeConfig = this.controller.determineMode(
      job,
      "execute",
      assembled,
      mode,
      taskType,
      assembled.resolvedAction,
    );
    
    // Layer 4: Compose prompt from templates
    const composed = await this.composer.compose(
      modeConfig,
      context,
      assembled
    );
    
    // Layer 5: Inject policies
    const policySection = this.policyInjector.buildPolicySection(modeConfig);
    const guardrailSection = this.policyInjector.buildGuardrailSection(modeConfig);
    
    // Assemble with policies
    const promptWithPolicies = [
      guardrailSection,
      this.composer.assembleFinal(composed, context.userLanguage),  // ✅ Pass userLanguage (execute phase)
      policySection
    ].join('\n\n');
    
    // Layer 6: Format for LLM
    const formatted = this.formatter.format(promptWithPolicies, modeConfig);
    
    const buildTime = Date.now() - startTime;
    
    return {
      formatted,
      composed,
      modeConfig,
      context: assembled,
      metadata: {
        normalized,
        buildTime
      }
    };
  }
  
  /**
   * Build enforcement prompt (for retry after validation failure)
   */
  async buildEnforcementPrompt(
    originalResult: PromptBuildResult,
    violationMessage: string
  ): Promise<FormattedPrompt> {
    const originalPrompt = this.composer.assembleFinal(originalResult.composed);
    
    return this.formatter.formatEnforcement(
      originalPrompt,
      violationMessage,
      originalResult.modeConfig
    );
  }
  
  /**
   * Extract prompt text for logging/debugging
   */
  extractPromptText(result: PromptBuildResult): string {
    return this.formatter.extractText(result.formatted);
  }

  /**
   * Build prompt for DetectEnvironment node (code graph)
   * Determines: jobMode + intentId (lightweight router)
   */
  async buildDetectEnvironmentPrompt(
    directive: string,
    artifactAvailability?: string,
    workspaceHints?: { hasDesignDoc?: boolean; hasSpecDocs?: boolean },
  ): Promise<string> {
    return await this.deps.promptPort.render('code/phases/detect/base', {
      directive,
      artifactAvailability: artifactAvailability || '',
      hasDesignDoc: workspaceHints?.hasDesignDoc || false,
      hasSpecDocs: workspaceHints?.hasSpecDocs || false,
    });
  }

  /**
   * Build prompt for Design Work Type + Domain Detection (design graph)
   * - First classifies work type: "design-ui" vs "design-system"
   * - For system-design: classifies domain (game/service) and environment (frontend/backend/fullstack)
   * - Uses directive, PRD, and optional references/assets info
   * - ✅ NEW: Document completion status determines next phase
   */
  async buildDesignDomainPrompt(args: {
    directive: string;
    hasReferences?: boolean;
    hasAssets?: boolean;
    referencesList?: string;
    assetsList?: string;
    hasUiDocs?: boolean;
    hasUiTokens?: boolean;
    hasUiAssets?: boolean;
    hasUiSpec?: boolean;
    hasSystemDocs?: boolean;
    hasSystemDesign?: boolean;
    hasApiContract?: boolean;
    hasFeSystemDesign?: boolean;
    hasBeSystemDesign?: boolean;
    systemDesignFiles?: string[];
    figmaPopulated?: boolean;
  }): Promise<string> {
    return await this.deps.promptPort.render('design/phases/detect/base', {
      directive: args.directive,
      hasReferences: args.hasReferences || false,
      hasAssets: args.hasAssets || false,
      referencesList: args.referencesList || '',
      assetsList: args.assetsList || '',
      figmaPopulated: args.figmaPopulated || false,
      hasUiDocs: args.hasUiDocs || false,
      hasUiTokens: args.hasUiTokens || false,
      hasUiAssets: args.hasUiAssets || false,
      hasUiSpec: args.hasUiSpec || false,
      hasSystemDocs: args.hasSystemDocs || false,
      hasSystemDesign: args.hasSystemDesign || false,
      hasApiContract: args.hasApiContract || false,
      hasFeSystemDesign: args.hasFeSystemDesign || false,
      hasBeSystemDesign: args.hasBeSystemDesign || false,
      systemDesignFiles: args.systemDesignFiles || [],
    });
  }

  /**
   * Build prompt for Decompose node
   */
  async buildDecomposePrompt(context: {
    directive: string;
    documents?: ResolvedDocument[];
    hasDocuments?: boolean;
    specDoc?: string;
    specApiContract?: string;
    mode: string;
    profile: any;
    designDocsMeta?: string;
    specDocsMeta?: string;
    codebaseFilePaths?: string[];
    hasProjectCode?: boolean;
    hasErrorInDirective?: boolean;
    uiSectionsSummary?: string;
    runtimeAssetsIndex?: {
      count: number;
      files: string[];
    };
    jobConversation?: import('../../types/session').ConversationEntry[];
    hasJobHistory?: boolean;
    needsBoundaryClassification?: boolean;
  }): Promise<{ system: string; user: string }> {
    const hasExistingCode = context.hasProjectCode ?? 
                           (context.codebaseFilePaths && context.codebaseFilePaths.length > 0);
    
    const fileList = (context.codebaseFilePaths && context.codebaseFilePaths.length > 0)
      ? context.codebaseFilePaths.map(f => `- ${f}`).join('\n')
      : '';
    
    const uiHint = context.uiSectionsSummary
      ? `\n\n${context.uiSectionsSummary}\n`
      : '';

    const assetsHint =
      context.runtimeAssetsIndex && context.runtimeAssetsIndex.count > 0
        ? `\n\n## Runtime Assets Available (inputs/assets)\n` +
          `There are ${context.runtimeAssetsIndex.count} runtime asset file(s) under inputs/assets.\n` +
          `These are NOT auto-copied. You MUST add a task to copy them into the correct static asset root for the target app (monorepo-aware).\n` +
          `Copy rule: preserve relative paths under inputs/assets.\n` +
          `Placement rule by format:\n` +
          `- SVG (.svg) → <app>/src/assets/ (source tree, for SVGR import)\n` +
          `- Raster (png, jpg, webp) → <app>/public/ (static serving)\n` +
          `Examples:\n` +
          `- inputs/assets/icons/x.svg -> <app>/src/assets/icons/x.svg\n` +
          `- inputs/assets/bg/hero.webp -> <app>/public/bg/hero.webp\n` +
          `Asset file list (first 50):\n` +
          `${context.runtimeAssetsIndex.files.slice(0, 50).map(f => `- ${f}`).join('\n')}\n`
        : '';
    
    const enrichedContext = {
      ...context,
      hasExistingCode,
      fileList,
      fileCount: context.codebaseFilePaths?.length || 0,
      hasErrorInDirective: context.hasErrorInDirective || false,
      hasUiDocs: Boolean(context.uiSectionsSummary),
      hasSpecDocs: Boolean(context.specDocsMeta),
      documents: context.documents || [],
      hasDocuments: context.hasDocuments || false,
      uiHint,
      assetsHint,
      jobConversation: context.jobConversation,
      hasJobHistory: context.hasJobHistory,
      needsBoundaryClassification: context.needsBoundaryClassification,
    };
    
    const system = await this.deps.promptPort.render('code/phases/decompose/rules', enrichedContext);

    let envContract = '';
    try {
      envContract = await this.deps.promptPort.render('code/base/injections/preview-env-contract', {});
      console.log(`📋 [PromptEngine] Injected preview-env-contract into decompose prompt`);
    } catch {
      // Template not found — skip injection
    }

    const fullSystem = envContract
      ? `${system}\n\n---\n\n${envContract}`
      : system;

    const user = await this.deps.promptPort.render('code/phases/decompose/base', enrichedContext);
    
    return { system: fullSystem, user };
  }

  /**
   * Build prompt for Plan node (task keyword generation)
   */
  async buildTaskKeywordsPrompt(
    task: {
      name: string;
      description: string;
    },
    directive: string,  // ✅ Original directive for ground truth
    profile: any,
    mode: string,
    referenceProjects?: Array<{project: string}>,
    directoryTree?: string
  ): Promise<string> {
    // ✅ Uses base-keyword.md for keyword generation
    return await this.deps.promptPort.render('code/phases/plan/base-keyword', {
      taskName: task.name,
      taskDescription: task.description,
      directive: directive,  // ✅ Pass original directive
      language: profile?.language || 'unknown',
      framework: profile?.framework || 'unknown',
      mode: mode || 'unknown',
      hasReferences: referenceProjects && referenceProjects.length > 0,
      referenceProjects: referenceProjects?.map(r => `- ${r.project}`).join('\n') || '',
      directoryTree: directoryTree || '',
      hasDirectoryTree: !!directoryTree,
    });
  }

  /**
   * Build prompt for Revise node (task queue revision on resume with new directive)
   */
  async buildRevisePrompt(
    job: 'code' | 'design',
    context: {
      completedCount: number;
      totalTasks: number;
      currentTask?: { id: string; name: string; type: string; description: string };
      remainingTasks: Array<{ id: string; name: string; type: string; priority: number; description: string; index: number }>;
      completedTasksList: Array<{ id: string; name: string; type: string; description: string }>;
      originalDirective: string;
      newDirective: string;
      directives: Array<{ index: number; content: string; isLatest: boolean; isOriginal: boolean }>;
      context?: any;
    }
  ): Promise<string> {
    return await this.deps.promptPort.render(`${job}/phases/revise/base`, context);
  }

  /**
   * Build prompt for Plan node (task plan generation)
   */
  async buildTaskPlanPrompt(
    task: {
      id: string;
      name: string;
      description: string;
      type: string;
    },
    directive: string,
    documents: ResolvedDocument[],
    projectCodeContext: any,
    violationsText?: string,
    profile?: { language: string; [key: string]: any },
    remainingTasks?: Array<{ id: string; name: string; description: string; priority: number }>,
    options?: { hasTools?: boolean },
    designDocUnknownPackages?: string[],
    isSpecDriven?: boolean,
    resolvedAction?: ResolvedActionContext,
  ): Promise<string> {
    let formattedCodeContext = '';
    if (projectCodeContext?.files && Array.isArray(projectCodeContext.files) && projectCodeContext.files.length > 0) {
      const pathList = projectCodeContext.files.map((f: any) => `- \`${f.path}\``).join('\n');
      formattedCodeContext = `**Retrieved Files** (${projectCodeContext.files.length} files):\n\n${pathList}`;
    }
    
    const directoryTree = projectCodeContext?.directoryTree || '';
    
    let setupConstraints = '';
    if (task.type === 'setup' && profile?.language) {
      const language = this.mapLanguageToTemplatePath(profile.language);
      const templatePath = `code/phases/execute/languages/${language}/setup/constraints`;
      try {
        setupConstraints = await this.deps.promptPort.render(templatePath, {});
        console.log(`📋 [PromptEngine] Injected setup constraints for language: ${language}`);
      } catch {
        console.log(`📋 [PromptEngine] No setup constraints template for language: ${language}`);
      }
    }
    
    // documents param (planDocs from the calling node) takes precedence for display.
    // resolvedAction provides metadata (intent, target) but its documents
    // are replaced by the node-determined planDocs when available.
    let effectiveResolvedAction = resolvedAction;
    if (documents.length > 0) {
      effectiveResolvedAction = {
        ...(resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
        documents,
      };
    }

    const allDocs = effectiveResolvedAction?.documents ?? [];
    const hasDesignDoc = allDocs.some(
      d => d.role === 'ref' && (d.label === 'Design Specification' || d.label === 'Feature Specification')
    );

    return await this.deps.promptPort.render('code/phases/plan/base', {
      taskName: task.name,
      taskDescription: task.description,
      directive: directive,
      taskType: task.type,
      documents: documents,
      hasDocuments: allDocs.length > 0,
      isSpecDriven: isSpecDriven || false,
      projectCodeContext: formattedCodeContext,
      directoryTree: directoryTree,
      hasProjectCodeContext: !!formattedCodeContext,
      violationsText: violationsText,
      isRetry: !!violationsText,
      setupConstraints: setupConstraints,
      hasSetupConstraints: !!setupConstraints,
      remainingTasks: remainingTasks,
      hasRemainingTasks: remainingTasks && remainingTasks.length > 0,
      hasTools: options?.hasTools ?? false,
      designDocUnknownPackages: designDocUnknownPackages,
      hasDesignDocUnknownPackages: designDocUnknownPackages && designDocUnknownPackages.length > 0,
      resolvedAction: effectiveResolvedAction,
      hasDesignDoc,
    });
  }
  
  /**
   * Build prompt for diagnostic plan (verification/error tasks).
   * Unlike feature plans, this focuses on build/test execution and error analysis.
   */
  async buildVerificationPlanPrompt(
    task: { id: string; name: string; description: string; type: string },
    directive: string,
    projectCodeContext: any,
    violationsText?: string,
    options?: { hasTools?: boolean },
    profile?: { language: string; [key: string]: any },
    dependencyStatus?: string,
    resolvedAction?: ResolvedActionContext,
  ): Promise<string> {
    let formattedCodeContext = '';
    if (projectCodeContext?.files && Array.isArray(projectCodeContext.files) && projectCodeContext.files.length > 0) {
      const pathList = projectCodeContext.files.map((f: any) => `- \`${f.path}\``).join('\n');
      formattedCodeContext = `**Retrieved Files** (${projectCodeContext.files.length} files):\n\n${pathList}`;
    }
    
    const directoryTree = projectCodeContext?.directoryTree || '';
    const isErrorTask = task.type === 'error';
    const runTests = task.type === 'verification';
    
    // Load language-specific hints for build/test execution guidance
    let languageHints = '';
    if (profile?.language) {
      const language = this.mapLanguageToTemplatePath(profile.language);
      try {
        languageHints = await this.deps.promptPort.render(`code/phases/plan/tasks/verification/languages/${language}/hints`, {});
        console.log(`📋 [PromptEngine] Injected diagnostic language hints for: ${language}`);
      } catch {
        // No hints template for this language — skip
      }
    }
    
    return await this.deps.promptPort.render('code/phases/plan/tasks/verification/base', {
      taskId: task.id,
      taskName: task.name,
      taskDescription: task.description,
      directive: directive,
      isErrorTask,
      runTests,
      projectCodeContext: formattedCodeContext,
      directoryTree: directoryTree,
      violationsText: violationsText,
      isRetry: !!violationsText,
      hasTools: options?.hasTools ?? false,
      languageHints: languageHints,
      hasLanguageHints: !!languageHints,
      dependencyStatus: dependencyStatus,
      resolvedAction: resolvedAction,
    });
  }

  /**
   * Build prompt for error task plan.
   * Unlike verification plans, this focuses on code analysis from user-reported errors,
   * with optional build/typecheck as diagnostic aids rather than mandatory first steps.
   */
  async buildErrorPlanPrompt(
    task: { id: string; name: string; description: string; type: string },
    directive: string,
    projectCodeContext: any,
    violationsText?: string,
    options?: { hasTools?: boolean },
    profile?: { language: string; [key: string]: any },
    resolvedAction?: ResolvedActionContext,
  ): Promise<string> {
    let formattedCodeContext = '';
    if (projectCodeContext?.files && Array.isArray(projectCodeContext.files) && projectCodeContext.files.length > 0) {
      const pathList = projectCodeContext.files.map((f: any) => `- \`${f.path}\``).join('\n');
      formattedCodeContext = `**Retrieved Files** (${projectCodeContext.files.length} files):\n\n${pathList}`;
    }
    
    const directoryTree = projectCodeContext?.directoryTree || '';

    let languageHints = '';
    if (profile?.language) {
      const language = this.mapLanguageToTemplatePath(profile.language);
      try {
        languageHints = await this.deps.promptPort.render(`code/phases/plan/tasks/verification/languages/${language}/hints`, {});
      } catch {
        // No hints template for this language — skip
      }
    }
    
    return await this.deps.promptPort.render('code/phases/plan/tasks/error/base', {
      taskId: task.id,
      taskName: task.name,
      taskDescription: task.description,
      directive: directive,
      projectCodeContext: formattedCodeContext,
      directoryTree: directoryTree,
      violationsText: violationsText,
      isRetry: !!violationsText,
      hasTools: options?.hasTools ?? false,
      languageHints: languageHints,
      hasLanguageHints: !!languageHints,
      resolvedAction: resolvedAction,
    });
  }

  /**
   * Map profile language string to template directory name.
   * Mirrors ModeController.detectLanguage() mapping logic.
   */
  private mapLanguageToTemplatePath(language: string): string {
    const lang = language.toLowerCase();
    if (lang.includes('go')) return 'go';
    if (lang.includes('typescript') || lang.includes('javascript')) return 'typescript';
    if (lang.includes('python')) return 'python';
    if (lang.includes('rust')) return 'rust';
    if (lang.includes('java')) return 'java';
    return 'typescript';
  }
}

