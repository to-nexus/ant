import { ProjectContext, AgentTask, CodeMode, ArchitectResult } from "./types";
import { retrieve } from "./memory";
import { ArtifactService } from "../../infrastructure/workspace/ArtifactService";
import { formatSessionContext } from "./session-formatter";
import { MemoryPort, LLMClient, PromptPort, GitPort, ConfigPort, CodebaseAnalyzerPort, ProfilePort, SessionPort, ChunkPort, CommandPort, TaskQueueUpdatePort } from "../../core/ports";
import { runCodeGraph } from "./graph/code/runner";
import { ArchitectGraphState } from "./graph/code/state";
import { runDesignGraph } from "./graph/design/runner";
import { DesignGraphState } from "./graph/design/state";
import { runLearnGraph } from "./graph/learn/runner";
import { LearnGraphState } from "./graph/learn/state";
import { PromptEngine } from "../../core/prompt/engine";

export async function architectAgent(
  spec: string, 
  project: string,
  task: AgentTask = 'design',
  inputFile?: string,
  deps?: { 
    memory?: MemoryPort; 
    llm?: LLMClient; 
    promptPort?: PromptPort; 
    profilePort?: ProfilePort;
    analyzer?: CodebaseAnalyzerPort;
    git?: GitPort; 
    config?: ConfigPort;
    chunk?: ChunkPort;
    session?: SessionPort;
    command?: CommandPort;
    kanbanUpdate?: TaskQueueUpdatePort;  // ✅ For real-time Kanban updates
    fileTreeUpdate?: import('../../core/ports').FileTreeUpdatePort;  // ✅ For real-time file tree updates
    workflowUpdate?: import('../../core/ports/workflow').WorkflowStateUpdatePort;  // ✅ For real-time workflow tracking
    workspaceResolver?: any;
    userContext?: import('../../core/types/user').UserContext;  // ✅ User context (Cloud or Local)
    overrideDirective?: string;  // ✅ Chat input as directive (highest priority)
    chatSource?: boolean;  // ✅ Flag for Chat SSE
    feature?: string;  // ✅ Feature name (for chat jobs without inputFile)
  },
  codeMode?: CodeMode,
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
  if (task !== 'learn') {
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
  // ✅ Must use GitPort.getRepoRoot() - never fallback to process.cwd()
  // ✅ Learn job doesn't require GitPort (works without git)
  if (!deps?.git && task !== 'learn') {
    throw new Error("GitPort is required to determine working directory (codebase path)");
  }
  
  let workingDir: string;
  if (deps?.git) {
    try {
      // Get the actual repository root from git adapter
      // Local mode: resolves config.localPath
      // Cloud mode: returns projectPath/codebase
      workingDir = await deps.git.getRepoRoot();
      console.log(`📂 Working directory (codebase): ${workingDir}`);
    } catch (error) {
      console.error(`❌ Failed to determine working directory:`, error);
      throw new Error(`Could not determine codebase path. Ensure config.localPath is set correctly.`);
    }
  } else {
    // Learn job without git - use config path
    workingDir = config.localPath || process.cwd();
    console.log(`📂 Working directory (no git): ${workingDir}`);
  }
  
  // 3. Retrieve long-term knowledge from Vector DB
  console.log(`🔍 Retrieving vector memory for ${task}...`);
  const vectorMemory = await retrieve(task, project, featureFolder, deps?.memory ? { memory: deps.memory } : undefined);
  
  // 4. Detect user language from input (directive > spec)
  // ✅ Job-level language detection: each job can have different language
  const { detectUserLanguage } = await import('../../core/utils/languageDetector');
  const inputText = spec || '';  // Use spec (which contains directive/PRD)
  const userLanguage = detectUserLanguage(inputText);
  console.log(`🌍 Detected user language: ${userLanguage}`);
  
  // 5. Load short-term context from Session
  let sessionHistory = "";
  if (deps?.session && featureFolder) {
    try {
      console.log(`📖 Loading session history for feature: ${featureFolder}...`);
      // ✅ Only load session for supported job types
      const jobType: 'design' | 'code' | 'learn' = (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
      const session = await deps.session.load(project, featureFolder, jobType);
      if (session.turns.length > 0) {
        sessionHistory = formatSessionContext(session);
        console.log(`✅ Loaded ${session.turns.length} previous turn(s)`);
      } else {
        console.log(`ℹ️  This is the first turn in this feature`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not load session history:`, error);
      // Continue without session history (graceful degradation)
    }
  }
  
  // 6. Extract UserContext for path resolution
  // ✅ Get from deps (passed by orchestrator)
  const userContext = deps?.userContext || { userId: 'local', organizationId: 'local', workspacePath: '' };
  const { userId, organizationId } = userContext;
  
  // 6. (Optional) Pre-calculate featurePath for performance
  let featurePath: string | undefined;
  if (deps?.workspaceResolver) {
    try {
      const userContext = { userId, organizationId, workspacePath: '' };
      featurePath = deps.workspaceResolver.getFeaturePath(userContext, project, featureFolder);
      console.log(`📂 Feature path: ${featurePath}`);
    } catch (error) {
      console.warn(`⚠️  Could not resolve featurePath:`, error);
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
    strictValidation: config.strictValidation ?? true, // ✅ For runtime validation (boolean)
    memory: vectorMemory,                  // Long-term knowledge (string)
    sessionHistory: sessionHistory,        // Short-term context (string)
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

  // Call appropriate handler based on task
  switch (task) {
    case 'learn':
      // Generic learn: accept repo files or free-form text in spec
      const lInitial: LearnGraphState = {
        context,
        spec,
        deps: {
          memory: deps?.memory,
          chunk: deps?.chunk,
          git: deps?.git,
          llm: deps?.llm  // ✅ LLM for analysis
        },
        targets: [],
        texts: []
      };
      
      console.log('\n🚀 Starting task: "Learn and Store Knowledge"');
      console.log('   Type: LEARN');
      console.log('');
      
      const l = await runLearnGraph(lInitial);
      return {
        success: true,
        task: 'learn',
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
          // ✅ FIX: task parameter is a Task object, not AgentTask string!
          // For design job, we need to pass 'design' as the AgentTask type
          const agentTask: AgentTask = 'design';
          
          const gitPort = deps.git;
          if (!gitPort) return {};
          
          const directive = await ArtifactService.getDirective(ctx, agentTask, gitPort);
          const designResult = await ArtifactService.findLatestDesign(ctx, gitPort);
          const source = await ArtifactService.getSource(ctx, gitPort);
          
          return {
            directive: directive || undefined,
            previousDesign: designResult?.content || undefined,
            prdSpec: source?.prd || undefined
          };
        }
      });

      const dInitial: DesignGraphState = {
        context,
        spec,
        deps: {
          llm: deps?.llm,
          promptEngine: designEngine,
          chunk: deps?.chunk,
          session: deps?.session,
          git: deps?.git,
          analyzer: deps?.analyzer,
          memory: deps?.memory,
          workspaceResolver: deps?.workspaceResolver,  // ✅ For path resolution
          kanbanUpdate: deps?.kanbanUpdate,      // ✅ NEW: For real-time Kanban updates
          fileTreeUpdate: deps?.fileTreeUpdate,  // ✅ NEW: For real-time file tree updates
          workflowUpdate: deps?.workflowUpdate   // ✅ NEW: For real-time workflow tracking
        },
        planText: "",
        _httpJobId: jobId || process.env.ANT_JOB_ID,  // ✅ For tracking and resume
        overrideDirective: deps?.overrideDirective,  // ✅ Chat input as directive
        chatSource: deps?.chatSource  // ✅ Chat SSE flag
      };
      
      console.log('\n🚀 Starting task: "Generate Design Document"');
      console.log('   Type: DESIGN');
      console.log('');
      
      
      const d = await runDesignGraph(dInitial);
      return {
        success: true,
        task: 'design',
        message: `Design document created. Review and approve before generating code.`
      };
    case 'code':
      // Run via code graph (auto-detect batch vs normal)
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for code generation");
      }

      // === ✅ Mode inference is handled by LLM in detectEnvironment node ===
      // Do NOT infer mode here - let detectEnvironment decide
      const inferredMode = codeMode;  // Use explicit mode if provided, otherwise undefined
      
      if (inferredMode) {
        console.log(`🎯 Code mode (explicit): ${inferredMode}`);
      } else {
        console.log(`🎯 Code mode: Will be determined by LLM in detectEnvironment node`);
      }

      // === ✅ UNIFIED: Always use Task Queue Mode with LLM validation ===
      const { WorkSizeEstimator } = await import('../../core/codebase');
      const estimator = new WorkSizeEstimator();
      
      console.log('📊 Analyzing work size...');
      const estimation = await estimator.estimate(
        spec,
        context.workingDir,
        deps?.git
      );

      console.log(`   Estimated: ~${estimation.estimatedFiles} files, ~${Math.ceil(estimation.estimatedTokens / 1000)}K tokens`);
      console.log(`   Decision: ${estimation.reason}`);
      console.log('⚡ Using task queue mode\n');
        
        const codeEngine = new PromptEngine({
          promptPort: deps.promptPort,
          profilePort: deps.profilePort,
          analyzer: deps.analyzer,
          git: deps.git,
          memory: deps.memory,
          contextLoader: async (task, ctx) => {
            // ✅ FIX: task parameter is a Task object, not AgentTask string!
            // For code job, we need to pass 'code' as the AgentTask type
            const agentTask: AgentTask = 'code';
            
            const gitPort = deps.git;
            if (!gitPort) return {};
            
            const directive = await ArtifactService.getDirective(ctx, agentTask, gitPort);
            
            // ✅ Load all available design documents
            // TemplateComposer will filter by environment before sending to LLM
            const designDocs = await ArtifactService.loadDesignDocuments(ctx, gitPort, 'unknown');
            
            // ✅ Also load unified design for backward compatibility
            // This will be used if designDocs filtering doesn't find environment-specific docs
            const designResult = await ArtifactService.findLatestDesign(ctx, gitPort);
            
            return {
              directive: directive || undefined,
              designDoc: designResult?.content || undefined,  // ✅ Backward compatibility
              designDocPath: designResult?.filePath || undefined,  // ✅ For environment inference
              designDocs  // ✅ All docs (filtered later by TemplateComposer)
            };
          }
        });
        
        // ✅ Resolve jobId: orchestrator param > env var (child process) > undefined
        const resolvedJobId = jobId || process.env.ANT_JOB_ID;
        
        
        // ✅ Create CodebaseRetriever for reference loading
        const { CodebaseRetriever } = await import('../../core/codebase/CodebaseRetriever');
        const retriever = new CodebaseRetriever();
        
        const initial: ArchitectGraphState = {
          context,
          spec,
          deps: { 
            memory: deps?.memory, 
            llm: deps?.llm,
            promptEngine: codeEngine,
            analyzer: deps?.analyzer,
            git: deps?.git,
            chunk: deps?.chunk,
            session: deps?.session,
            command: deps?.command,
            retriever,  // ✅ NEW: CodebaseRetriever for reference loading
            vectorDB: deps?.memory,  // ✅ NEW: Same as memory (for reference queries)
            workspaceResolver: deps?.workspaceResolver,  // ✅ For path resolution
            kanbanUpdate: deps?.kanbanUpdate,  // ✅ Pass Kanban update port (undefined in child process)
            fileTreeUpdate: deps?.fileTreeUpdate,  // ✅ Pass file tree update port (undefined in child process)
            workflowUpdate: deps?.workflowUpdate  // ✅ Pass workflow update port for Agent Workflow visualization
          },
          gitPort: deps?.git,
          planText: "",
          codePrompt: "",
          rawResponse: "",
          files: [],
          filesToDelete: [],
          requiredIntegrations: [],
          violations: [],  // ✅ Initialize violations array
          retries: 0,
          maxRetries: 3,  // ✅ Allow multiple retries for dependency fixes
          completedTasksDetails: [],  // ✅ Initialize completedTasksDetails
          referenceCodeContexts: [],  // ✅ Initialize reference code contexts
          codeMode: codeMode, // Will be inferred in graph nodes
          subtaskIndex: 0,  // Backward compatibility
          totalSubtasks: 0,  // Backward compatibility
          _httpJobId: resolvedJobId,  // ✅ For real-time tracking and resume
          overrideDirective: deps?.overrideDirective,  // ✅ Chat input as directive
          chatSource: deps?.chatSource  // ✅ Chat SSE flag
        };
        const result = await runCodeGraph(initial);
        
        // ✅ Determine status based on execution result (using unified interruption)
        const hasInterruption = !!result.interruption;
        const tasksRemaining = result.interruption?.metadata?.tasksRemaining || 0;
        
        let status: 'success' | 'paused' | 'partial';
        if (hasInterruption && tasksRemaining > 0) {
          status = 'paused';  // Interrupted with tasks remaining
        } else if (hasInterruption && tasksRemaining === 0) {
          status = 'success';  // Interrupted but all tasks completed
        } else {
          status = 'success';  // Normal completion
        }
        
        return {
          success: status === 'success',
          status: status,  // ✅ Add explicit status field
          task: 'code',
          reportFile: result.reportFile || '',
          filesAnalyzed: result.filesChanged || 0,
          interruption: result.interruption,  // ✅ Return interruption details
          message: (result.filesChanged || 0) > 0
            ? `${result.filesChanged} files changed. Review with 'git diff' and commit when ready.`
            : `No code changes generated. See report for plan and lessons.`
        };
    
    default:
      throw new Error(`Unknown task: ${task}`);
  }
}
