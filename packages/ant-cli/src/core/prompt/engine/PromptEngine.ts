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
      lastSectionNumber?: number;
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
   * Build prompt for DetectEnvironment node
   * Note: Mode inference is now part of this prompt (LLM-based)
   */
  async buildDetectEnvironmentPrompt(
    directive: string,
    designDocs: string[],
    profile: any
  ): Promise<string> {
    return await this.deps.promptPort.render('code/nodes/detect-environment', {
      directive,
      designDocs: designDocs.join(', '),
      profile
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
    codebaseFilePaths?: string[];
  }): Promise<string> {
    // ✅ Compute derived variables for the prompt
    const hasExistingCode = context.codebaseFilePaths && context.codebaseFilePaths.length > 0;
    const fileList = hasExistingCode 
      ? context.codebaseFilePaths!.map(f => `- ${f}`).join('\n')
      : '';
    
    // ✅ Build spec from directive + design doc
    const spec = context.hasDesignDoc 
      ? `## Directive\n${context.directive}\n\n## Design Document\n${context.designDoc}`
      : context.directive;
    
    const enrichedContext = {
      ...context,
      spec,
      hasExistingCode,
      fileList,
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
    profile: any,
    mode: string,
    referenceProjects?: Array<{project: string}>
  ): Promise<string> {
    return await this.deps.promptPort.render('code/nodes/generate-task-keywords', {
      taskName: task.name,
      taskDescription: task.description,
      language: profile?.language || 'unknown',
      framework: profile?.framework || 'unknown',
      mode: mode || 'unknown',
      hasReferences: referenceProjects && referenceProjects.length > 0,
      referenceProjects: referenceProjects?.map(r => `- ${r.project}`).join('\n') || ''
    });
  }
}

