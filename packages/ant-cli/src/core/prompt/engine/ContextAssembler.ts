import { ProjectContext, AgentTask, CodebaseProfile } from "../../types";
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
  lastSectionNumber?: number;
  previousDesign?: string;
  
  designDocs?: {
    apiContract?: string;
    feDesign?: string;
    beDesign?: string;
    unifiedDesign?: string;
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
    targetFile?: string;      // ✅ Target file for design job (api-contract.md, fe-system-design.md, etc.)
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
  sessionHistory?: string;
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
   * Assemble all context for a given task
   * 
   * @param loader - Optional loader function for task-specific documents
   * @param artifacts - Pre-loaded artifacts (directive, currentCode, etc.)
   */
  async assemble(
    task: AgentTask,
    context: ProjectContext,
    deps?: {
      git?: GitPort;
      memory?: MemoryPort;
      analyzer?: CodebaseAnalyzerPort;
    },
    loader?: (task: AgentTask, context: any) => Promise<Partial<AssembledContext>>,
    artifacts?: {
      directive?: string;
      designDoc?: string;
      prdSpec?: string;
      currentCode?: string;
      lastSectionNumber?: number;
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
        apiContract?: string;
        feDesign?: string;
        beDesign?: string;
        unifiedDesign?: string;
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
      assembled.lastSectionNumber = artifacts.lastSectionNumber;
      assembled.projectCodeContext = artifacts.projectCodeContext;
      assembled.referenceCodeContexts = artifacts.referenceCodeContexts || [];
      assembled.currentTask = artifacts.currentTask;
      assembled.retryContext = artifacts.retryContext;
      assembled.referenceRequests = artifacts.referenceRequests;
      assembled.designDocs = artifacts.designDocs;
      assembled.designDomain = artifacts.designDomain;
    }
    
    // 1. Load task-specific documents using provided loader
    if (loader) {
      const loaded = await loader(task, context);
      Object.assign(assembled, loaded);
    }
    
    // Codebase profile (passed from state, not loaded here)
    
    // 3. Load vector memory (from context)
    assembled.memory = context.memory || undefined;
    
    // 4. Load session history (from context)
    assembled.sessionHistory = context.sessionHistory || undefined;
    
    // 5. Generate statistics
    const hasMissingDependency = Boolean(
      assembled.currentTask?.name?.toLowerCase().includes('missing') ||
      assembled.currentTask?.name?.toLowerCase().includes('dependency') ||
      assembled.currentTask?.description?.toLowerCase().includes('missing') ||
      assembled.currentTask?.description?.toLowerCase().includes('dependency')
    );
    
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
      hasSessionHistory: Boolean(assembled.sessionHistory),
      codebaseDetected: Boolean(assembled.codebaseProfile),
      hasMissingDependency
    };
    
    return {
      ...assembled,
      stats
    } as AssembledContext;
  }
}

