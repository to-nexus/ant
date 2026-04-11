import { ProjectContext, AgentJob, JobMode, ArchitectResult } from "./types";
import type { InterruptionReason } from "../../core/types/session";
import { retrieve } from "./memory";
import { ArtifactService } from "../../infrastructure/workspace/ArtifactService";
import { MemoryPort, LLMClient, PromptPort, GitPort, ConfigPort, CodebaseAnalyzerPort, ProfilePort, SessionPort, ChunkPort, CommandPort, TaskQueueUpdatePort } from "../../core/ports";
import { FileSystemPort } from "../../core/ports/filesystem";
import { runCodeGraph } from "./graph/code/runner";
import { ArchitectGraphState } from "./graph/code/state";
import { runDesignGraph } from "./graph/design/runner";
import { DesignGraphState } from "./graph/design/state";
import { runLearnGraph } from "./graph/learn/runner";
import { LearnGraphState } from "./graph/learn/state";
import { PromptEngine } from "../../core/prompt/engine";

export async function architectAgent(
  input: string, 
  project: string,
  job: AgentJob = 'design',
  inputFile?: string,
  deps?: { 
    memory?: MemoryPort; 
    llm?: LLMClient; 
    promptPort?: PromptPort; 
    profilePort?: ProfilePort;
    analyzer?: CodebaseAnalyzerPort;
    git?: GitPort;
    fileSystem?: FileSystemPort;  // ✅ NEW: FileSystemPort for file I/O
    config?: ConfigPort;
    chunk?: ChunkPort;
    session?: SessionPort;
    command?: CommandPort;
    kanbanUpdate?: TaskQueueUpdatePort;  // ✅ For real-time Kanban updates
    fileTreeUpdate?: import('../../core/ports').FileTreeUpdatePort;  // ✅ For real-time file tree updates
    workflowUpdate?: import('../../core/ports/workflow').WorkflowStateUpdatePort;  // ✅ For real-time workflow tracking
    previewUpdate?: import('../../core/ports/preview').PreviewUpdatePort;  // ✅ For preview structureType broadcast
    workspaceResolver?: any;
    userContext?: import('../../core/types/user').UserContext;  // ✅ User context (Cloud or Local)
    overrideDirective?: string;  // ✅ Chat input as directive (highest priority)
    chatSource?: boolean;  // ✅ Flag for Chat SSE
    feature?: string;  // ✅ Feature name (for chat jobs without inputFile)
    featurePath?: string;  // ✅ Pre-calculated feature path (avoids re-calculation mismatch)
    skipTriage?: boolean;
    actionMetadata?: import('@ant/shared').ActionMetadata;
    redis?: any;  // Raw ioredis client for cloud Figma MCP bridge
  },
  mode?: JobMode,
  enableEvaluation?: boolean,
  jobId?: string  // ✅ Existing jobId for resume or real-time tracking
): Promise<ArchitectResult> {
  // Initialize context
  // ✅ For chat jobs: use provided feature name
  // ✅ For file jobs: extract from inputFile
  // ✅ For learn jobs: featureFolder is optional (can be "default")
  const featureFolder = deps?.feature || ArtifactService.extractFeatureFolderFromPath(inputFile, project);
  
  if (!project || typeof project !== 'string' || !project.trim()) {
    throw new Error('Project name is required and must be a non-empty string');
  }
  
  // ✅ Learn job doesn't require featureFolder (uses "default" if not provided)
  if (job !== 'learn') {
    if (!featureFolder || typeof featureFolder !== 'string' || !featureFolder.trim()) {
      console.error('❌ featureFolder is undefined or empty.');
      console.error('  inputFile:', inputFile);
      console.error('  feature:', deps?.feature);
      console.error('  project:', project);
      throw new Error('Feature folder is required and must be a non-empty string');
    }
  }
  
  // 1. Load config
  if (!deps?.config) {
    throw new Error("ConfigPort not provided");
  }
  const config = await deps.config.load(project);
  
  // 2. Determine working directory (actual code repository path)
  // Must use GitPort.getRepoRoot() - never fallback to process.cwd()
  // Learn job doesn't require GitPort (works without git)
  if (!deps?.git && job !== 'learn') {
    throw new Error("GitPort is required to determine working directory (codebase path)");
  }
  
  let workingDir: string;
  if (deps?.git) {
    try {
      workingDir = await deps.git.getRepoRoot();
    } catch (error) {
      throw new Error(`Could not determine codebase path. Ensure config.localPath is set correctly.`);
    }
  } else {
    workingDir = config.localPath || process.cwd();
  }
  
  // 3. Retrieve long-term knowledge from Vector DB
  const vectorMemory = await retrieve(job, project, featureFolder, deps?.memory ? { memory: deps.memory } : undefined);
  
  // 4. Detect user locale: actionMetadata.locale (explicit from UI) > input text inference
  const { detectUserLanguage } = await import('../../core/utils/languageDetector');
  const explicitLanguage = deps?.actionMetadata?.locale ?? deps?.actionMetadata?.language;
  const userLanguage = explicitLanguage || detectUserLanguage(input || '');
  
  // 5. Extract UserContext for path resolution
  // ✅ Get from deps (passed by orchestrator)
  const userContext = deps?.userContext || { userId: 'local', organizationId: 'local' };
  const { userId, organizationId } = userContext;
  
  // 6. (Optional) Pre-calculate featurePath for performance
  // ✅ CRITICAL: Use deps.featurePath if provided (from orchestrator) to ensure consistency
  let featurePath: string | undefined = (deps as any)?.featurePath;
  
  if (!featurePath && deps?.workspaceResolver) {
    // Fallback: calculate from workspaceResolver
    try {
      const userContext = { userId, organizationId };
      featurePath = deps.workspaceResolver.getFeaturePath(userContext, project, featureFolder);
    } catch (error) {
      // featurePath resolution failed - will proceed without it
    }
  }
  
  // 7. Create ProjectContext with both Vector and Session
  // ✅ FIX: Do NOT include ANY complex objects in context - only primitives!
  // ✅ LangGraph state serialization + ProjectContext's index signature causes issues
  const context: ProjectContext & { enableEvaluation?: boolean, featurePath?: string } = {
    project,
    featureFolder,
    workingDir,  // Repository root path (string)
    projectPath: config.localPath,         // ✅ Used by TemplateComposer (primitive string)
    repoType: config.repoType,             // ✅ For mode detection (primitive string)
    branchBase: config.branchBase,         // ✅ For learn node branch creation (primitive string)
    memory: vectorMemory,                  // Long-term knowledge (string)
    userLanguage,                          // ✅ User's language for this job (string)
    enableEvaluation,                      // Evaluation flag (boolean)
    userId,                                // ✅ For path resolution (string)
    organizationId,                        // ✅ For path resolution (string)
    featurePath                            // ✅ Optional: Pre-resolved for performance (string)
  };
  
  // ✅ Read chat integration parameters from environment
  // ✅ Properly handle empty string as undefined
  const overrideDirective = process.env.ANT_OVERRIDE_DIRECTIVE?.trim() || undefined;
  const chatSource = process.env.ANT_CHAT_SOURCE === 'true';

  // Call appropriate handler based on job
  switch (job) {
    case 'learn':
      // Generic learn: accept repo files or free-form text in spec
      const lInitial: LearnGraphState = {
        context,
        directive: input,
        deps: {
          memory: deps?.memory,
          chunk: deps?.chunk,
          git: deps?.git,
          llm: deps?.llm,
          workflowUpdate: deps?.workflowUpdate
        },
        targets: [],
        texts: [],
        // ✅ Triage System fields
        _httpJobId: jobId || process.env.ANT_JOB_ID,
        overrideDirective: deps?.overrideDirective || overrideDirective,
        chatSource: deps?.chatSource,
        skipTriage: deps?.skipTriage,
        actionMetadata: deps?.actionMetadata,
        currentJob: 'learn',
        currentAgent: 'architect'
      };
      
      console.log('🚀 Starting LEARN job');
      
      const l = await runLearnGraph(lInitial);
      
      // ✅ Return appropriate message based on triage result
      const learnTriageResult = l.triageResult;
      
      if (learnTriageResult) {
        // Ask intent: question was answered
        if (learnTriageResult.intent === 'ask') {
          return {
            success: true,
            job: 'learn',
            message: learnTriageResult.displayMessage || 'Question answered.'
          };
        }
        
        // Redirect: suggested different job
        if (learnTriageResult.workStatus === 'redirect') {
          return {
            success: true,
            job: 'learn',
            message: learnTriageResult.displayMessage || `Suggested action: ${learnTriageResult.suggestedJob || 'different job'}`
          };
        }
        
        // Blocked: prerequisites not met
        if (learnTriageResult.workStatus === 'blocked') {
          return {
            success: false,
            status: 'paused',
            job: 'learn',
            interruption: {
              reason: 'api_error' as InterruptionReason,
              message: learnTriageResult.displayMessage || 'Prerequisites not met for this operation.',
              timestamp: new Date().toISOString(),
              canResume: false,
            },
            message: learnTriageResult.displayMessage || 'Prerequisites not met for this operation.',
          };
        }
      }
      
      return {
        success: true,
        job: 'learn',
        reportFile: '',
        message: `Stored ${l.stored} lesson chunk(s) to vector memory.`
      };
    case 'design':
      // Run via design graph
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for design generation");
      }
      const designEngine = new PromptEngine({
        promptPort: deps.promptPort,
        profilePort: deps.profilePort,
        analyzer: deps.analyzer,
        git: deps.git,
        memory: deps.memory,
        contextLoader: async (task, ctx) => {
          // ✅ FIX: task parameter is a Task object, not AgentJob string!
          // For design job, we need to pass 'design' as the AgentJob type
          const agentJob: AgentJob = 'design';
          
          const gitPort = deps.git;
          const fileSystem = deps.fileSystem;
          if (!gitPort || !fileSystem) return {};
          
          const directive = await ArtifactService.getDirective(ctx, agentJob, gitPort, fileSystem);
          const designResult = await ArtifactService.findLatestDesign(ctx, gitPort, fileSystem);
          const source = await ArtifactService.getSource(ctx, gitPort, fileSystem);
          
          return {
            directive: directive || undefined,
            previousDesign: designResult?.content || undefined,
            sourceDocuments: source?.sourceDocuments || undefined
          };
        }
      });

      const dInitial: DesignGraphState = {
        context,
        directive: input,
        workspaceConfig: config,
        deps: {
          llm: deps?.llm,
          promptEngine: designEngine,
          chunk: deps?.chunk,
          session: deps?.session,
          git: deps?.git,
          fileSystem: deps?.fileSystem,
          analyzer: deps?.analyzer,
          memory: deps?.memory,
          workspaceResolver: deps?.workspaceResolver,
          kanbanUpdate: deps?.kanbanUpdate,
          fileTreeUpdate: deps?.fileTreeUpdate,
          workflowUpdate: deps?.workflowUpdate,
          redis: deps?.redis,
        },
        planText: "",
        _httpJobId: jobId || process.env.ANT_JOB_ID,  // ✅ For tracking and resume
        overrideDirective: deps?.overrideDirective,  // ✅ Chat input as directive
        chatSource: deps?.chatSource,  // ✅ Chat SSE flag
        skipTriage: deps?.skipTriage,  // ✅ Skip triage (after proceed choice)
        actionMetadata: deps?.actionMetadata,  // ✅ Structured context from Actions panel
        currentJob: 'design',  // ✅ For triage system
        currentAgent: 'architect'  // ✅ For triage system
      };
      
      console.log('🚀 Starting DESIGN job');
      
      const d = await runDesignGraph(dInitial);
      
      // ✅ Return appropriate message based on triage result
      const triageResult = d.triageResult;
      
      if (triageResult) {
        // Ask intent: question was answered
        if (triageResult.intent === 'ask') {
          return {
            success: true,
            job: 'design',
            message: triageResult.displayMessage || 'Question answered.'
          };
        }
        
        // Redirect: suggested different job
        if (triageResult.workStatus === 'redirect') {
          return {
            success: true,
            job: 'design',
            message: triageResult.displayMessage || `Suggested action: ${triageResult.suggestedJob || 'different job'}`
          };
        }
        
        // Blocked: prerequisites not met
        if (triageResult.workStatus === 'blocked') {
          return {
            success: false,
            status: 'paused',
            job: 'design',
            interruption: {
              reason: 'api_error' as InterruptionReason,
              message: triageResult.displayMessage || 'Prerequisites not met for this operation.',
              timestamp: new Date().toISOString(),
              canResume: false,
            },
            message: triageResult.displayMessage || 'Prerequisites not met for this operation.',
          };
        }
      }
      
      // ✅ Check for design error (e.g., Figma rate limit, window not open)
      if (d.designError) {
        const FIGMA_ENV_TYPES = ['figma_mcp_unavailable', 'figma_window_not_open', 'figma_bridge_unavailable'];
        const reason: InterruptionReason =
          d.designError.type === 'figma_rate_limited' ? 'figma_rate_limited'
          : FIGMA_ENV_TYPES.includes(d.designError.type) ? 'figma_connection_lost'
          : 'api_error';

        return {
          success: false,
          status: 'paused',
          job: 'design',
          interruption: {
            reason,
            message: d.designError.message || 'Design operation failed.',
            timestamp: new Date().toISOString(),
            canResume: true,
            metadata: { designErrorType: d.designError.type },
          },
          message: d.designError.message || 'Design operation failed.',
        };
      }
      
      // ✅ Check for interruption (call limit, recursion limit, etc.)
      const designInterruption = (d as any).interruption;
      if (designInterruption) {
        const tasksRemaining = designInterruption.metadata?.tasksRemaining || 0;
        const completedCount = d.completedTasks?.length || 0;
        
        if (tasksRemaining === 0) {
          // All tasks completed despite interruption (edge case: interrupted but recovered)
          return {
            success: true,
            job: 'design',
            message: `Design document created. Review and approve before generating code.`
          };
        }
        
        return {
          success: true,
          status: 'paused',
          job: 'design',
          interruption: designInterruption,
          message: designInterruption.message || `Design paused: ${completedCount} task(s) completed, ${tasksRemaining} remaining. Resume to continue.`
        };
      }
      
      // ✅ Normal completion: design documents created
      return {
        success: true,
        job: 'design',
        message: `Design document created. Review and approve before generating code.`
      };
    case 'code':
      // Run via code graph (auto-detect batch vs normal)
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for code generation");
      }

      // === ✅ Mode inference is handled by LLM in detectEnvironment node ===
      // Do NOT infer mode here - let detectEnvironment decide
      const inferredMode = mode;  // Use explicit mode if provided, otherwise undefined
      
      // UNIFIED: Always use Task Queue Mode with LLM validation
      const { WorkSizeEstimator } = await import('../../core/codebase');
      const estimator = new WorkSizeEstimator();
      
      const estimation = await estimator.estimate(
        input,
        context.workingDir,
        deps?.git
      );

      console.log(`🚀 Starting CODE job (~${estimation.estimatedFiles} files)`);
        
        const codeEngine = new PromptEngine({
          promptPort: deps.promptPort,
          profilePort: deps.profilePort,
          analyzer: deps.analyzer,
          git: deps.git,
          memory: deps.memory,
          contextLoader: async (task, ctx) => {
            // ✅ FIX: task parameter is a Task object, not AgentJob string!
            // For code job, we need to pass 'code' as the AgentJob type
            const agentJob: AgentJob = 'code';
            
            const gitPort = deps.git;
            const fileSystem = deps.fileSystem;
            if (!gitPort || !fileSystem) return {};
            
            const directive = await ArtifactService.getDirective(ctx, agentJob, gitPort, fileSystem);
            
            // ✅ Load all available design documents
            // TemplateComposer will filter by environment before sending to LLM
            const designDocs = await ArtifactService.loadDesignDocuments(ctx, gitPort, fileSystem, 'unknown');
            
            // ✅ Also load unified design as fallback
            // This will be used if designDocs filtering doesn't find environment-specific docs
            const designResult = await ArtifactService.findLatestDesign(ctx, gitPort, fileSystem);
            
            return {
              directive: directive || undefined,
              designDocPath: designResult?.filePath || undefined,
              designDocs
            };
          }
        });
        
        // ✅ Resolve jobId: orchestrator param > env var (child process) > undefined
        const resolvedJobId = jobId || process.env.ANT_JOB_ID;
        
        // ✅ Create CodebaseRetriever for reference loading
        const { CodebaseRetriever: CodeRetrieverClass } = await import('../../core/codebase/CodebaseRetriever');
        const retriever = new CodeRetrieverClass();
        
        const initial: ArchitectGraphState = {
          context,
          directive: input,
          workspaceConfig: config,
          deps: { 
            memory: deps?.memory, 
            llm: deps?.llm,
            promptEngine: codeEngine,
            analyzer: deps?.analyzer,
            git: deps?.git,
            fileSystem: deps?.fileSystem,  // ✅ NEW: FileSystemPort
            chunk: deps?.chunk,
            session: deps?.session,
            command: deps?.command,
            retriever,  // ✅ NEW: CodebaseRetriever for reference loading
            vectorDB: deps?.memory,  // ✅ NEW: Same as memory (for reference queries)
            workspaceResolver: deps?.workspaceResolver,  // ✅ For path resolution
            kanbanUpdate: deps?.kanbanUpdate,  // ✅ Pass Kanban update port (undefined in child process)
            fileTreeUpdate: deps?.fileTreeUpdate,  // ✅ Pass file tree update port (undefined in child process)
            workflowUpdate: deps?.workflowUpdate,  // ✅ Pass workflow update port for Agent Workflow visualization
            previewUpdate: deps?.previewUpdate,
            redis: deps?.redis,
          },
          gitPort: deps?.git,
          planText: "",
          codePrompt: "",
          rawResponse: "",
          // ✅ REMOVED: files (replaced by projectCodeContext.files)
          filesToDelete: [],
          requiredIntegrations: [],
          violations: [],  // ✅ Initialize violations array
          retries: 0,
          maxRetries: 3,  // ✅ Allow multiple retries for dependency fixes
          completedTasksDetails: [],  // ✅ Initialize completedTasksDetails
          referenceCodeContexts: [],  // ✅ Initialize reference code contexts
          subtaskIndex: 0,
          totalSubtasks: 0,
          _httpJobId: resolvedJobId,  // ✅ For real-time tracking and resume
          overrideDirective: deps?.overrideDirective,  // ✅ Chat input as directive
          chatSource: deps?.chatSource,  // ✅ Chat SSE flag
          skipTriage: deps?.skipTriage,  // ✅ Skip triage (after proceed choice)
          actionMetadata: deps?.actionMetadata,  // ✅ Structured context from Actions panel
          currentJob: 'code',  // ✅ For triage system
          currentAgent: 'architect'  // ✅ For triage system
        };
        const result = await runCodeGraph(initial);
        
        // ✅ Check triage result first (ask/redirect/blocked handling)
        const codeTriageResult = result.triageResult;
        
        if (codeTriageResult) {
          // Ask intent: question was answered
          if (codeTriageResult.intent === 'ask') {
            return {
              success: true,
              job: 'code',
              message: codeTriageResult.displayMessage || 'Question answered.'
            };
          }
          
          // Redirect: suggested different job
          if (codeTriageResult.workStatus === 'redirect') {
            return {
              success: true,
              job: 'code',
              message: codeTriageResult.displayMessage || `Suggested action: ${codeTriageResult.suggestedJob || 'different job'}`
            };
          }
          
          // Blocked: prerequisites not met
          if (codeTriageResult.workStatus === 'blocked') {
            return {
              success: false,
              status: 'paused',
              job: 'code',
              interruption: {
                reason: 'api_error' as InterruptionReason,
                message: codeTriageResult.displayMessage || 'Prerequisites not met for this operation.',
                timestamp: new Date().toISOString(),
                canResume: false,
              },
              message: codeTriageResult.displayMessage || 'Prerequisites not met for this operation.',
            };
          }
        }
        
        // ✅ Determine status based on execution result (using unified interruption)
        const hasInterruption = !!result.interruption;
        const tasksRemaining = result.interruption?.metadata?.tasksRemaining || 0;
        const failedCount = result.interruption?.metadata?.failedCount || 0;
        
        let status: 'success' | 'paused' | 'partial';
        let effectiveInterruption = result.interruption;
        
        if (hasInterruption && failedCount > 0) {
          status = 'paused';  // Has permanently failed tasks — must pause for user review
        } else if (hasInterruption && tasksRemaining > 0) {
          status = 'paused';  // Interrupted with tasks remaining
        } else if (hasInterruption && tasksRemaining === 0) {
          status = 'success';  // Interrupted but all tasks completed (retried successfully)
          // Clear interruption: all tasks completed despite earlier recursion limit.
          // Without this, cleanupJobState finds the interruption and creates a
          // spurious "Task cancelled" choice card even though everything succeeded.
          effectiveInterruption = undefined;
        } else {
          status = 'success';  // Normal completion
        }
        
        return {
          success: status === 'success',
          status: status,  // ✅ Add explicit status field
          job: 'code',
          reportFile: result.reportFile || '',
          filesAnalyzed: result.filesChanged || 0,
          interruption: effectiveInterruption,  // ✅ Only pass interruption when tasks actually remain
          message: (result.filesChanged || 0) > 0
            ? `${result.filesChanged} files changed. Review with 'git diff' and commit when ready.`
            : `No code changes generated. See report for plan and lessons.`
        };
    
    default:
      throw new Error(`Unknown job: ${job}`);
  }
}
