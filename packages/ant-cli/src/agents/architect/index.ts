import { ProjectContext, AgentTask, CodeMode, ArchitectResult } from "./types";
import { extractFeatureFolder } from "./utils";
import { retrieve } from "./memory";
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
  },
  codeMode?: CodeMode,
  enableEvaluation?: boolean,
  taskId?: string  // ✅ For real-time tracking
): Promise<ArchitectResult> {
  // Initialize context
  const featureFolder = extractFeatureFolder(inputFile, project);
  
  // 1. Load config
  if (!deps?.config) {
    throw new Error("ConfigPort not provided");
  }
  const config = await deps.config.load(project);
  
  // 2. Determine working directory (actual code repository path)
  let workingDir = process.cwd(); // Default fallback
  
  if (deps?.git) {
    try {
      // Get the actual repository root from git adapter
      // This will resolve localPath correctly for local repos
      workingDir = await deps.git.getRepoRoot();
    } catch (error) {
      console.warn(`⚠️  Could not determine working directory from git:`, error);
      // Fall back to process.cwd()
    }
  }
  
  // 3. Retrieve long-term knowledge from Vector DB
  console.log(`🔍 Retrieving vector memory for ${task}...`);
  const vectorMemory = await retrieve(task, project, featureFolder, deps?.memory ? { memory: deps.memory } : undefined);
  
  // 4. Load short-term context from Session
  let sessionHistory = "";
  if (deps?.session && featureFolder) {
    try {
      console.log(`📖 Loading session history for feature: ${featureFolder}...`);
      const session = await deps.session.load(project, featureFolder);
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
  
  // 5. Create ProjectContext with both Vector and Session
  const context: ProjectContext & { enableEvaluation?: boolean } = {
    project,
    featureFolder,
    workingDir,  // Now uses resolved repository path
    config,
    memory: vectorMemory,           // Long-term knowledge
    sessionHistory: sessionHistory,  // Short-term context
    enableEvaluation                 // Evaluation flag
  };

  // Call appropriate handler based on task
  switch (task) {
    case 'learn':
      // Generic learn: accept repo files or free-form text in spec
      const lInitial: LearnGraphState = {
        context,
        spec,
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
        message: `Stored ${l.stored} learning chunk(s) to vector memory.`
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
          const { getDirective, getSource, findLatestDesign } = await import('./utils');
          const gitPort = deps.git;
          if (!gitPort) return {};
          
          const directive = await getDirective(ctx, task, gitPort);
          const previousDesign = await findLatestDesign(ctx, gitPort);
          const source = await getSource(ctx, gitPort);
          
          return {
            directive: directive || undefined,
            previousDesign: previousDesign || undefined,
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
          memory: deps?.memory  // ✅ IMPROVEMENT: Pass MemoryPort to design graph
        },
        planText: "",
        designMarkdown: ""
      };
      
      console.log('\n🚀 Starting task: "Generate Design Document"');
      console.log('   Type: DESIGN');
      console.log('');
      
      const d = await runDesignGraph(dInitial);
      return {
        success: true,
        task: 'design',
        reportFile: d.designFilePath,
        message: `Design document created at ${d.designFilePath}. Review and approve before generating code.`
      };
    case 'code':
      // Run via code graph (auto-detect batch vs normal)
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for code generation");
      }

      // === Infer code mode if not explicitly provided ===
      let inferredMode = codeMode;
      if (!inferredMode) {
        const { inferCodeMode } = await import('../../core/modeInference');
        const { getDirective, findLatestDesign } = await import('./utils');
        
        const gitPort = deps?.git;
        if (!gitPort) {
          throw new Error("GitPort not provided for code mode inference");
        }
        
        const directive = await getDirective(context, 'code', gitPort);
        const designDoc = await findLatestDesign(context, gitPort);
        const hasGitChanges = await gitPort.hasChanges();
        
        inferredMode = inferCodeMode({
          directive,
          designDoc,
          hasGitChanges,
          hasExistingCode: true  // We're in a project, so code exists
        });
        
        console.log(`🎯 Code mode inferred: ${inferredMode}`);
      } else {
        console.log(`🎯 Code mode (explicit): ${inferredMode}`);
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
            const { getDirective, findLatestDesign } = await import('./utils');
            const gitPort = deps.git;
            if (!gitPort) return {};
            
            const directive = await getDirective(ctx, task, gitPort);
            const designDoc = await findLatestDesign(ctx, gitPort);
            
            return {
              directive: directive || undefined,
              designDoc: designDoc || undefined
            };
          }
        });
        
        // ✅ Resolve taskId: orchestrator param > env var (child process) > undefined
        const resolvedTaskId = taskId || process.env.ANT_JOB_ID;
        
        console.log(`🔍 [architectAgent] Task ID resolution:`);
        console.log(`   taskId param:`, taskId || 'undefined');
        console.log(`   process.env.ANT_JOB_ID:`, process.env.ANT_JOB_ID || 'undefined');
        console.log(`   resolvedTaskId:`, resolvedTaskId || 'undefined');
        console.log(`   kanbanUpdate available:`, !!deps?.kanbanUpdate);
        console.log(`   workflowUpdate available:`, !!deps?.workflowUpdate);
        
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
                codeMode: codeMode, // Will be inferred in graph nodes
                subtaskIndex: 0,  // Backward compatibility
                totalSubtasks: 0,  // Backward compatibility
                _httpTaskId: resolvedTaskId  // ✅ For real-time Kanban tracking
              };
        const result = await runCodeGraph(initial);
        
        // ✅ Determine status based on execution result
        let status: 'success' | 'paused' | 'partial';
        if (result.pausedDueToLimit && result.tasksRemaining > 0) {
          status = 'paused';  // Recursion limit hit, tasks remaining
        } else if (result.pausedDueToLimit && result.tasksRemaining === 0) {
          status = 'success';  // Recursion limit but all tasks completed
        } else {
          status = 'success';  // Normal completion
        }
        
        return {
          success: status === 'success',
          status: status,  // ✅ Add explicit status field
          task: 'code',
          reportFile: result.reportFile,
          filesAnalyzed: result.filesChanged,
          tasksRemaining: result.tasksRemaining,
          pausedDueToLimit: result.pausedDueToLimit,
          message: result.filesChanged > 0
            ? `${result.filesChanged} files changed. Review with 'git diff' and commit when ready.`
            : `No code changes generated. See report for plan and learnings.`
        };
    
    default:
      throw new Error(`Unknown task: ${task}`);
  }
}
