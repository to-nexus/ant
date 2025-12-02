import { ProjectContext, AgentTask, CodebaseProfile } from "../../types";
import { CodebaseAnalyzerPort, GitPort, MemoryPort } from "../../ports";
import { ReferenceContext } from "../../codebase/types";

/**
 * Assembled context from all sources
 * Ready to be injected into prompts
 */
export interface AssembledContext {
  // Documents
  directive?: string;
  designDoc?: string;         // For code task
  designDocPath?: string;     // ✅ NEW: Design document file path (for environment inference)
  lastSectionNumber?: number; // Last section number for continuation
  previousDesign?: string;    // For design task
  prdSpec?: string;
  
  // Code
  originalFiles?: string;     // Git HEAD version (for comparison)
  currentCode?: string;       // Working tree code
  
  // ✅ Reference Projects (for tool calling)
  referenceRequests?: Array<{project: string; branch?: string}>;
  
  // Task Context
  currentTask?: {             // Current task being executed
    name: string;
    type: string;
    priority: number;
    description: string;
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
  
  // Statistics
  stats: {
    hasDirective: boolean;
    hasDesign: boolean;
    hasOriginalFiles: boolean;
    hasCurrentCode: boolean;
    hasMemory: boolean;
    hasSessionHistory: boolean;
    codebaseDetected: boolean;
    hasMissingDependency: boolean;  // ✅ For missing dependency injection
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
      lastSectionNumber?: number;
      prdSpec?: string;
      originalFiles?: string;
      currentCode?: string;
      currentTask?: {
        name: string;
        type: string;
        priority: number;
        description: string;
      };
      retryContext?: AssembledContext['retryContext'];
      referenceRequests?: Array<{project: string; branch?: string}>;  // ✅ Reference projects for tool calling
    }
  ): Promise<AssembledContext> {
    const assembled: Partial<AssembledContext> = {};
    
    // 0. Add pre-loaded artifacts if provided
    if (artifacts) {
      assembled.directive = artifacts.directive;
      assembled.designDoc = artifacts.designDoc;
      assembled.lastSectionNumber = artifacts.lastSectionNumber;
      assembled.prdSpec = artifacts.prdSpec;
      assembled.originalFiles = artifacts.originalFiles;
      assembled.currentCode = artifacts.currentCode;
      assembled.currentTask = artifacts.currentTask;
      assembled.retryContext = artifacts.retryContext;
      assembled.referenceRequests = artifacts.referenceRequests;  // ✅ Reference projects for tool calling
      // Note: originalFiles from artifacts will be overridden by git if available
    }
    
    // 1. Load task-specific documents using provided loader
    if (loader) {
      const loaded = await loader(task, context);
      Object.assign(assembled, loaded);
    }
    
    // 2. Load original files from git (if available)
    if (deps?.git) {
      assembled.originalFiles = await this.loadOriginalFiles(deps.git);
      
      // Analyze codebase if we have original files
      if (assembled.originalFiles && deps.analyzer) {
        assembled.codebaseProfile = await this.analyzeCodebase(
          assembled.originalFiles,
          context.workingDir,
          deps.analyzer
        );
      }
    }
    
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
      hasOriginalFiles: Boolean(assembled.originalFiles),
      hasCurrentCode: Boolean(assembled.currentCode),
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
  
  /**
   * Load original files from git HEAD
   */
  private async loadOriginalFiles(git: GitPort): Promise<string | undefined> {
    try {
      const changedFiles = await git.getChangedFiles();
      if (changedFiles.length === 0) {
        return undefined;
      }
      
      const originals: Array<{ path: string; content: string }> = [];
      
      for (const p of changedFiles) {
        const content = await git.getHeadFile(p);
        if (content !== null) {
          originals.push({ path: p, content });
        }
      }
      
      if (originals.length === 0) {
        return undefined;
      }
      
      return originals
        .map(f => `FILE: ${f.path}\n${f.content}`)
        .join("\n\n---\n\n");
    } catch (error) {
      console.warn('[ContextAssembler] Failed to load original files:', error);
      return undefined;
    }
  }
  
  /**
   * Analyze codebase to detect language and framework
   */
  private async analyzeCodebase(
    filesBlock: string,
    workingDir: string,
    analyzer: CodebaseAnalyzerPort
  ): Promise<CodebaseProfile | null> {
    try {
      const profile = await analyzer.analyze(filesBlock, workingDir);
      
      console.log(
        `📊 Codebase detected: ${profile.language}` +
        `${profile.framework ? ` + ${profile.framework}` : ''}`
      );
      
      return profile;
    } catch (error) {
      console.warn('[ContextAssembler] Failed to analyze codebase:', error);
      return null;
    }
  }
}

