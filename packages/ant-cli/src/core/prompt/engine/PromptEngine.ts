import { AgentTask, CodeMode, ProjectContext } from "../../types";
import { PromptPort, ProfilePort, CodebaseAnalyzerPort, GitPort, MemoryPort } from "../../ports";
import { InputNormalizer, NormalizedPromptInput } from "./InputNormalizer";
import { ContextAssembler, AssembledContext } from "./ContextAssembler";
import { ModeController, PromptModeConfig } from "./ModeController";
import { TemplateComposer, ComposedPrompt } from "./TemplateComposer";
import { PolicyInjector } from "./PolicyInjector";
import { PromptFormatter, FormattedPrompt } from "./PromptFormatter";
import { ProjectCodeContext, ReferenceCodeContext } from "../types/CodeContext";

/**
 * Dependencies for PromptEngine
 */
export interface PromptEngineDeps {
  promptPort: PromptPort;
  profilePort?: ProfilePort;
  analyzer?: CodebaseAnalyzerPort;
  git?: GitPort;
  memory?: MemoryPort;
  contextLoader?: (task: AgentTask, context: any) => Promise<Partial<AssembledContext>>;
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
  
  constructor(private deps: PromptEngineDeps) {
    this.normalizer = new InputNormalizer();
    this.assembler = new ContextAssembler();
    this.controller = new ModeController();
    this.composer = new TemplateComposer(deps.promptPort, deps.profilePort);
    this.policyInjector = new PolicyInjector();
    this.formatter = new PromptFormatter();
  }
  
  /**
   * Build prompt for plan phase
   */
  async buildPlanPrompt(
    task: AgentTask,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      designDoc?: string;
      previousDesign?: string;
      projectCodeContext?: ProjectCodeContext;
      currentTask?: {
        name: string;
        type: string;
        priority: number;
        description: string;
      };
    },
    mode?: CodeMode,
    taskType?: string
  ): Promise<PromptBuildResult> {
    const startTime = Date.now();
    
    // Layer 1: Normalize inputs
    const normalized = this.normalizer.normalizePlanInput(
      task,
      context,
      artifacts,
      mode
    );
    
    // Layer 2: Assemble context
    const assembled = await this.assembler.assemble(
      task,
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
      task,
      "plan",
      assembled,
      mode,
      taskType
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
    task: AgentTask,
    context: ProjectContext,
    artifacts: {
      directive?: string;
      designDoc?: string;
      prdSpec?: string;         // ✅ Added for design graph
      currentCode?: string;     // ✅ Added for design graph
      uiDoc?: string;           // ✅ Optional UI spec (Figma-derived)
      uiAssets?: any;           // ✅ Optional UI assets index (text-only manifest)
      lastSectionNumber?: number;
      sectionPattern?: string;  // ✅ 'top-level' or 'nested' structure pattern
      isLastTaskForDocument?: boolean;  // ✅ If true, don't output metadata
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
        recentTurns: Array<{
          turnId: number;
          directive: string;
          mode: string;
          output: string;
        }>;
        summary?: string;
        totalTurns: number;
        currentTurn: number;
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
    },
    mode?: CodeMode,
    taskType?: string
  ): Promise<PromptBuildResult> {
    const startTime = Date.now();
    
    // Layer 1: Normalize inputs
    const normalized = this.normalizer.normalizeExecuteInput(
      task,
      context,
      artifacts,
      mode
    );
    
    // Layer 2: Assemble context
    const assembled = await this.assembler.assemble(
      task,
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
      task,
      "execute",
      assembled,
      mode,
      taskType
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
  buildEnforcementPrompt(
    originalResult: PromptBuildResult,
    violationMessage: string
  ): FormattedPrompt {
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
   * Note: Mode inference is now part of this prompt (LLM-based)
   */
  async buildDetectEnvironmentPrompt(
    directive: string,
    designDocs: {
      apiContract?: string;
      feDesign?: string;
      beDesign?: string;
      unifiedDesign?: string;
    } | undefined,
    profile: any,
    prdSpec?: string
  ): Promise<string> {
    // ✅ Build design doc content from object
    const parts: string[] = [];
    
    if (designDocs) {
      if (designDocs.feDesign) {
        parts.push('# Frontend System Design (fe-system-design.md)\n\n' + designDocs.feDesign);
      }
      if (designDocs.beDesign) {
        parts.push('# Backend System Design (be-system-design.md)\n\n' + designDocs.beDesign);
      }
      if (designDocs.unifiedDesign) {
        parts.push('# System Design (system-design.md)\n\n' + designDocs.unifiedDesign);
      }
      if (designDocs.apiContract) {
        parts.push('# API Contract (api-contract.md)\n\n' + designDocs.apiContract);
      }
    }
    
    const designDocsContent = parts.length > 0 
      ? parts.join('\n\n────────────────────────────────────────\n\n')
      : '';
    
    // ✅ Uses phases/detect/base.md which includes {{> code/phases/detect/rules}}
    return await this.deps.promptPort.render('code/phases/detect/base', {
      directive,
      designDocs: designDocsContent,
      profile,
      prdSpec: prdSpec || ''
    });
  }

  /**
   * Build prompt for Design Work Type + Domain Detection (design graph)
   * - First classifies work type: "ui-design" vs "system-design"
   * - For system-design: classifies domain (game/service) and environment (frontend/backend/fullstack)
   * - Uses directive, PRD, and optional references/assets info
   * - ✅ NEW: Document completion status determines next phase
   */
  async buildDesignDomainPrompt(args: {
    directive: string;
    prdSpec?: string;
    // UI document detection context
    hasReferences?: boolean;
    hasAssets?: boolean;
    referencesList?: string;
    assetsList?: string;
    // ✅ NEW: Document completion status (CRITICAL for decision)
    hasUiDocs?: boolean;
    hasUiTokens?: boolean;
    hasUiAssets?: boolean;
    hasUiSpec?: boolean;
    hasSystemDocs?: boolean;
    hasSystemDesign?: boolean;
    hasApiContract?: boolean;
    hasFeSystemDesign?: boolean;
    hasBeSystemDesign?: boolean;
  }): Promise<string> {
    return await this.deps.promptPort.render('design/phases/detect/base', {
      directive: args.directive,
      prdSpec: args.prdSpec || '',
      hasReferences: args.hasReferences || false,
      hasAssets: args.hasAssets || false,
      referencesList: args.referencesList || '',
      assetsList: args.assetsList || '',
      // ✅ Pass document completion status to prompt
      hasUiDocs: args.hasUiDocs || false,
      hasUiTokens: args.hasUiTokens || false,
      hasUiAssets: args.hasUiAssets || false,
      hasUiSpec: args.hasUiSpec || false,
      hasSystemDocs: args.hasSystemDocs || false,
      hasSystemDesign: args.hasSystemDesign || false,
      hasApiContract: args.hasApiContract || false,
      hasFeSystemDesign: args.hasFeSystemDesign || false,
      hasBeSystemDesign: args.hasBeSystemDesign || false,
    });
  }

  /**
   * Build prompt for Decompose node
   * 
   * TEMPORARY: Simple wrapper until full refactoring
   * Returns string (not PromptBuildResult) for backward compatibility
   */
  async buildDecomposePrompt(context: {
    directive: string;
    designDoc: string;
    hasDesignDoc: boolean;
    mode: string;
    profile: any;
    codebaseFilePaths?: string[];  // File paths from keyword search
    hasProjectCode?: boolean;      // ✅ CRITICAL: Actual project code existence (git-based)
    hasErrorInDirective?: boolean; // ✅ Error detected in directive
    uiSectionsSummary?: string;    // ✅ UI sections summary with token estimates (for split injection)
    runtimeAssetsIndex?: {         // ✅ Optional: runtime asset files list (text-only)
      count: number;
      files: string[];
    };
  }): Promise<string> {
    // ✅ CRITICAL: Use hasProjectCode (git-based) as primary indicator
    // Fallback to codebaseFilePaths only if hasProjectCode not provided
    const hasExistingCode = context.hasProjectCode ?? 
                           (context.codebaseFilePaths && context.codebaseFilePaths.length > 0);
    
    // ✅ File list from keyword-based RAG search (only if codebaseFilePaths exists)
    const fileList = (context.codebaseFilePaths && context.codebaseFilePaths.length > 0)
      ? context.codebaseFilePaths.map(f => `- ${f}`).join('\n')
      : '';
    
    // ✅ Build spec from directive + design doc
    const spec = context.hasDesignDoc 
      ? `## Directive\n${context.directive}\n\n## Design Document\n${context.designDoc}`
      : context.directive;
    
    // ✅ UI sections summary for split injection (shows available sections with token estimates)
    const uiHint = context.uiSectionsSummary
      ? `\n\n${context.uiSectionsSummary}\n`
      : '';

    const assetsHint =
      context.runtimeAssetsIndex && context.runtimeAssetsIndex.count > 0
        ? `\n\n## Runtime Assets Available (inputs/assets)\n` +
          `There are ${context.runtimeAssetsIndex.count} runtime asset file(s) under inputs/assets.\n` +
          `These are NOT auto-copied. You MUST add a task to copy them into the correct static asset root for the target app (monorepo-aware).\n` +
          `Copy rule: preserve relative paths under inputs/assets.\n` +
          `Examples (choose correct root for the target app):\n` +
          `- inputs/assets/icons/x.svg -> <app>/public/icons/x.svg\n` +
          `- inputs/assets/bg/hero.webp -> <app>/public/bg/hero.webp\n` +
          `Asset file list (first 50):\n` +
          `${context.runtimeAssetsIndex.files.slice(0, 50).map(f => `- ${f}`).join('\n')}\n`
        : '';
    
    const enrichedContext = {
      ...context,
      spec: `${spec}${uiHint}${assetsHint}`,
      hasExistingCode,
      fileList,
      fileCount: context.codebaseFilePaths?.length || 0,
      hasErrorInDirective: context.hasErrorInDirective || false, // ✅ Pass to template
    };
    
    // decompose/base.md now includes {{> code/phases/decompose/rules}}
    return await this.deps.promptPort.render('code/phases/decompose/base', enrichedContext);
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
    referenceProjects?: Array<{project: string}>
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
      referenceProjects: referenceProjects?.map(r => `- ${r.project}`).join('\n') || ''
    });
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
      ui?: boolean;  // ✅ UI flag for determining uiDoc injection
    },
    directive: string,  // ✅ Original directive for ground truth
    designDoc: string | undefined,
    projectCodeContext: any,
    violationsText?: string,  // ✅ Formatted violations for retry context
    uiDoc?: string  // ✅ UI spec/assets doc for UI-related tasks
  ): Promise<string> {
    // ✅ Format projectCodeContext (files array → formatted string)
    let formattedCodeContext = '';
    if (projectCodeContext?.files && Array.isArray(projectCodeContext.files) && projectCodeContext.files.length > 0) {
      const fileList = projectCodeContext.files.map((f: any) => {
        return `### 📄 \`${f.path}\`\n\n\`\`\`\n${f.content}\n\`\`\`\n`;
      }).join('\n');
      
      formattedCodeContext = `**Files** (${projectCodeContext.files.length} files):\n\n${fileList}`;
    }
    
    // ✅ Uses base-plan.md for plan generation
    return await this.deps.promptPort.render('code/phases/plan/base-plan', {
      taskName: task.name,
      taskDescription: task.description,
      directive: directive,  // ✅ Pass original directive
      taskType: task.type,
      designDoc: designDoc,
      uiDoc: uiDoc,  // ✅ UI spec for UI-related tasks
      hasUiDoc: !!uiDoc,  // ✅ Flag for template conditional
      projectCodeContext: formattedCodeContext,  // ✅ Formatted string (not .code property)
      hasDesignDoc: !!designDoc,
      hasProjectCodeContext: !!formattedCodeContext,
      violationsText: violationsText,  // ✅ Formatted violations for retry
      isRetry: !!violationsText  // ✅ Flag for template conditional
    });
  }
}

