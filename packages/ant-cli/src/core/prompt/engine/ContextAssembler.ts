import { ProjectContext, AgentJob, CodebaseProfile } from "../../types";
import { CodebaseAnalyzerPort, GitPort, MemoryPort } from "../../ports";
import { ReferenceContext } from "../../codebase/types";
import { ProjectCodeContext, ReferenceCodeContext } from "../types/CodeContext";

/**
 * Assembled context from all sources
 * Ready to be injected into prompts
 */
export interface AssembledContext {
  directive?: string;
  designDoc?: string;
  designDocPath?: string;
  prdSpec?: string;          // ✅ Added for design graph
  currentCode?: string;      // ✅ Added for design graph
  // ✅ Optional UI context - injected only for UI-related tasks
  uiDoc?: string;
  uiAssets?: Record<string, string[]>;  // Dynamic keys by asset subdirectory
  // ✅ Feature path for runtime asset resolution (e.g., features/skeleton)
  featurePath?: string;
  lastSectionNumber?: number;
  sectionPattern?: string;  // ✅ 'top-level' or 'nested' structure pattern
  isLastTaskForDocument?: boolean;  // ✅ If true, don't output metadata
  previousDesign?: string;
  
  designDocs?: {
    apiContracts: { [name: string]: string };
    feDesigns: { [name: string]: string };
    beDesigns: { [name: string]: string };
  };
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Code Context (Unified Structure)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  projectCodeContext?: ProjectCodeContext;       // Main project code (retrieved via RAG)
  referenceCodeContexts: ReferenceCodeContext[];  // Reference project code (loaded from requests)
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Reference Metadata (for tool calling & workflow control)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  referenceRequests?: Array<{project: string; branch?: string}>;  // Requested by decompose, loaded by plan
  
  // Task Context
  currentTask?: {             // Current task being executed
    name: string;
    type: string;
    priority: number;
    description: string;
    targetFile?: string;      // ✅ Target file for design job (api-contract-main.md, fe-system-design-main.md, etc.)
  };
  
  // ✅ NEW: Retry and Plan Context
  retryContext?: {
    attemptNumber: number;
    originalDirective: string;
    originalPlan: string;
    keyDecisions: string[];
    previousAttempts: Array<{
      attemptNumber: number;
      approach: string;
      error: string;
      wasCloseToSuccess: boolean;
    }>;
    currentError: string;
  } | null;
  
  // Memory
  memory?: string;
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
  codebaseProfile?: CodebaseProfile | null;
  
  // ✅ Design domain (for domain-specific injections, e.g., game vs service)
  designDomain?: 'game' | 'service';
  
  // Statistics
  stats: {
    hasDirective: boolean;
    hasDesign: boolean;
    hasProjectCode: boolean;          // ✅ Replaces hasOriginalFiles + hasCurrentCode
    hasReferenceCode: boolean;        // ✅ NEW: Has reference project code
    hasMemory: boolean;
    hasSessionHistory: boolean;
    codebaseDetected: boolean;
    hasMissingDependency: boolean;
  };
}

/**
 * ContextAssembler - Layer 2
 * Aggregates context from multiple sources (memory, git, files, analysis)
 * 
 * Responsibilities:
 * - Load documents (directive, design, PRD)
 * - Fetch code from git
 * - Retrieve vector memory
 * - Analyze codebase for language/framework
 * - Provide statistics for decision-making
 */
export class ContextAssembler {
  /**
   * Assemble all context for a given job
   * 
   * @param loader - Optional loader function for job-specific documents
   * @param artifacts - Pre-loaded artifacts (directive, currentCode, etc.)
   */
  async assemble(
    job: AgentJob,
    context: ProjectContext,
    deps?: {
      git?: GitPort;
      memory?: MemoryPort;
      analyzer?: CodebaseAnalyzerPort;
    },
    loader?: (job: AgentJob, context: any) => Promise<Partial<AssembledContext>>,
    artifacts?: {
      directive?: string;
      designDoc?: string;
      prdSpec?: string;
      currentCode?: string;
      uiDoc?: string;
      uiAssets?: AssembledContext['uiAssets'];
      lastSectionNumber?: number;
      sectionPattern?: string;
      isLastTaskForDocument?: boolean;
      projectCodeContext?: ProjectCodeContext;
      referenceCodeContexts?: ReferenceCodeContext[];
      currentTask?: {
        name: string;
        type: string;
        priority: number;
        description: string;
      };
      retryContext?: AssembledContext['retryContext'];
      referenceRequests?: Array<{project: string; branch?: string}>;
      designDocs?: {
        apiContracts: { [name: string]: string };
        feDesigns: { [name: string]: string };
        beDesigns: { [name: string]: string };
      };
      designDomain?: 'game' | 'service';
    }
  ): Promise<AssembledContext> {
    const assembled: Partial<AssembledContext> = {};
    
    if (artifacts) {
      assembled.directive = artifacts.directive;
      assembled.designDoc = artifacts.designDoc;
      assembled.prdSpec = artifacts.prdSpec;
      assembled.currentCode = artifacts.currentCode;
      assembled.uiDoc = artifacts.uiDoc;
      assembled.uiAssets = artifacts.uiAssets;
      assembled.lastSectionNumber = artifacts.lastSectionNumber;
      assembled.sectionPattern = artifacts.sectionPattern;
      assembled.isLastTaskForDocument = artifacts.isLastTaskForDocument;
      assembled.projectCodeContext = artifacts.projectCodeContext;
      assembled.referenceCodeContexts = artifacts.referenceCodeContexts || [];
      assembled.currentTask = artifacts.currentTask;
      assembled.retryContext = artifacts.retryContext;
      assembled.referenceRequests = artifacts.referenceRequests;
      assembled.designDocs = artifacts.designDocs;
      assembled.designDomain = artifacts.designDomain;
      // ✅ UI specification existence flag (for conditional prompt guidance)
      if ((artifacts as any).hasUiDoc !== undefined) {
        (assembled as any).hasUiDoc = (artifacts as any).hasUiDoc;
      }
    }
    
    // 1. Load job-specific documents using provided loader
    if (loader) {
      const loaded = await loader(job, context);
      Object.assign(assembled, loaded);
    }
    
    // ✅ FIX: Re-apply ALL artifact values that take priority over contextLoader.
    // The contextLoader re-reads from disk on every buildExecutePrompt call and
    // Object.assign overwrites artifact values. This causes cache invalidation when
    // the loader returns even slightly different content (e.g., different designDocPath).
    // Artifacts from promptBuilder are the authoritative source — always restore them.
    if (artifacts) {
      if (artifacts.directive !== undefined) {
        assembled.directive = artifacts.directive;
      }
      if (artifacts.designDoc !== undefined) {
        assembled.designDoc = artifacts.designDoc;
      }
      if (artifacts.designDocs !== undefined) {
        assembled.designDocs = artifacts.designDocs;
      }
      if (artifacts.projectCodeContext !== undefined) {
        assembled.projectCodeContext = artifacts.projectCodeContext;
      }
      if (artifacts.referenceCodeContexts !== undefined) {
        assembled.referenceCodeContexts = artifacts.referenceCodeContexts;
      }
      if (artifacts.currentTask !== undefined) {
        assembled.currentTask = artifacts.currentTask;
      }
    }
    
    // ✅ CRITICAL: Read codebaseProfile from context (passed by promptBuilder)
    // This enables TypeScript/React templates for new projects!
    if ((context as any).codebaseProfile) {
      assembled.codebaseProfile = (context as any).codebaseProfile;
    }
    
    // ✅ CRITICAL: Pass detectedEnvironment for ModeController priority-0 check
    // Without this, ModeController falls back to designDocPath filename detection,
    // which returns 'browser' for fullstack projects (fe-system-design.md is checked first).
    // The detectedEnvironment comes from detectEnvironment node (LLM-based analysis)
    // and is set on context by promptBuilder from state.detectionReport.environment.
    if ((context as any).detectedEnvironment) {
      (assembled as any).detectedEnvironment = (context as any).detectedEnvironment;
    }
    
    // ✅ Pass detectionReportProfile as fallback for ModeController language detection.
    // When codebaseProfile is unavailable (e.g., worker state race condition),
    // ModeController can still detect the correct language from detectionReport.profile.
    if ((context as any).detectionReportProfile) {
      (assembled as any).detectionReportProfile = (context as any).detectionReportProfile;
    }
    
    // ✅ Pass featurePath for runtime asset path resolution in templates
    if ((context as any).featurePath) {
      assembled.featurePath = (context as any).featurePath;
    }
    
    // 3. Load vector memory (from context)
    assembled.memory = context.memory || undefined;
    
    // 4. Generate statistics
    const hasMissingDependency = this.detectMissingDependency(assembled);
    
    const stats = {
      hasDirective: Boolean(assembled.directive),
      hasDesign: Boolean(assembled.designDoc || assembled.previousDesign),
      hasProjectCode: Boolean(
        assembled.projectCodeContext?.files && 
        assembled.projectCodeContext.files.length > 0
      ),
      hasReferenceCode: Boolean(
        assembled.referenceCodeContexts && 
        assembled.referenceCodeContexts.length > 0
      ),
      hasMemory: Boolean(assembled.memory),
      codebaseDetected: Boolean(assembled.codebaseProfile),
      hasMissingDependency
    };
    
    return {
      ...assembled,
      stats
    } as AssembledContext;
  }

  /**
   * Detect if the current task involves missing dependency resolution.
   * 
   * Priority order:
   * 1. Explicit flag from task metadata (needsDependencyFix)
   * 2. Setup task with existing project code (likely adding deps to existing project)
   * 3. Keyword heuristic in task name/description (fallback)
   */
  private detectMissingDependency(assembled: Partial<AssembledContext>): boolean {
    const task = assembled.currentTask;
    if (!task) return false;

    // 1. Explicit flag from LLM decompose output (highest priority)
    if ((task as any).needsDependencyFix === true) return true;
    if ((task as any).needsDependencyFix === false) return false;

    // 2. Setup task targeting an existing project = likely dependency installation
    const hasExistingCode = Boolean(
      assembled.projectCodeContext?.files && assembled.projectCodeContext.files.length > 0
    );
    if (task.type === 'setup' && hasExistingCode) return true;

    // 3. Keyword heuristic (fallback for backward compatibility)
    const text = `${task.name} ${task.description}`.toLowerCase();
    const depPatterns = [
      /missing\s+(module|package|dep)/,
      /install\s+(dep|package|module)/,
      /add\s+(dep|package|module)/,
      /dependency\s+(install|setup|missing|fix|resolution)/,
      /package\.json.*dep/,
      /go\s+mod\s+(tidy|download)/,
      /pip\s+install/,
      /cargo\s+add/,
    ];
    return depPatterns.some(p => p.test(text));
  }
}

