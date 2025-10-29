import { ProjectContext, AgentTask, CodeMode, ArchitectResult } from "./types";
import { extractFeatureFolder } from "./utils";
import { retrieve } from "./memory";
import { formatSessionContext } from "./session-formatter";
import { MemoryPort, LLMClient, PromptPort, GitPort, ConfigPort, CodebaseAnalyzerPort, ProfilePort, SessionPort, ChunkPort } from "../../core/ports";
import { runCodeGraph, runBatchCodeGraph } from "./graph/code/runner";
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
  },
  codeMode?: CodeMode,
  batchOptions?: {
    batchSize?: number;
    maxBatches?: number;
    stopOnError?: boolean;
    maxRetries?: number;
  }
): Promise<ArchitectResult> {
  // Initialize context
  const featureFolder = extractFeatureFolder(inputFile, project);
  
  // 1. Load config
  if (!deps?.config) {
    throw new Error("ConfigPort not provided");
  }
  const config = await deps.config.load(project);
  
  // 2. Retrieve long-term knowledge from Vector DB
  console.log(`🔍 Retrieving vector memory for ${task}...`);
  const vectorMemory = await retrieve(task, project, featureFolder, deps?.memory ? { memory: deps.memory } : undefined);
  
  // 3. Load short-term context from Session
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
  
  // 4. Create ProjectContext with both Vector and Session
  const context: ProjectContext = {
    project,
    featureFolder,
    workingDir: process.cwd(),
    config,
    memory: vectorMemory,           // Long-term knowledge
    sessionHistory: sessionHistory  // Short-term context
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
          return {
            directive: getDirective(ctx, task) || undefined,
            previousDesign: findLatestDesign(ctx) || undefined,
            prdSpec: getSource(ctx).prd || undefined
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
          analyzer: deps?.analyzer
        },
        planText: "",
        designMarkdown: ""
      };
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
        
        const directive = getDirective(context, 'code');
        const designDoc = findLatestDesign(context);
        const hasGitChanges = deps?.git ? await deps.git.hasChanges() : false;
        
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

      // === Auto-detect batch vs normal processing ===
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

      if (estimation.needsBatch) {
        // === Batch Processing Mode ===
        console.log('📦 Using batch processing mode\n');
        
        const batchEngine = new PromptEngine({
          promptPort: deps.promptPort,
          profilePort: deps.profilePort,
          analyzer: deps.analyzer,
          git: deps.git,
          memory: deps.memory,
          contextLoader: async (task, ctx) => {
            const { getDirective, findLatestDesign } = await import('./utils');
            return {
              directive: getDirective(ctx, task) || undefined,
              designDoc: findLatestDesign(ctx) || undefined
            };
          }
        });
        
        const batchInitial: ArchitectGraphState = {
          context,
          spec,
          deps: { 
            memory: deps?.memory, 
            llm: deps?.llm,
            promptEngine: batchEngine,
            analyzer: deps?.analyzer,
            git: deps?.git,
            chunk: deps?.chunk,
            session: deps?.session
          },
          gitPort: deps?.git,
          planText: "",
          codePrompt: "",
          rawResponse: "",
          files: [],
          filesToDelete: [],
          requiredIntegrations: [],
          retries: 0,
          maxRetries: 1,
          codeMode: 'refactor', // Batch is always refactor
        };
        
        const batchResult = await runBatchCodeGraph(spec, batchInitial, batchOptions);
        
        return {
          success: batchResult.failCount === 0,
          task: 'code',
          reportFile: '',
          filesAnalyzed: batchResult.totalFilesModified,
          message: `Batch processing complete: ${batchResult.successCount}/${batchResult.totalBatches} batches succeeded, ${batchResult.totalFilesModified} files modified.`
        };
      } else {
        // === Normal Processing Mode ===
        console.log('⚡ Using normal processing mode\n');
        
        const codeEngine = new PromptEngine({
          promptPort: deps.promptPort,
          profilePort: deps.profilePort,
          analyzer: deps.analyzer,
          git: deps.git,
          memory: deps.memory,
          contextLoader: async (task, ctx) => {
            const { getDirective, findLatestDesign } = await import('./utils');
            return {
              directive: getDirective(ctx, task) || undefined,
              designDoc: findLatestDesign(ctx) || undefined
            };
          }
        });
        
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
            session: deps?.session
          },
          gitPort: deps?.git,
          planText: "",
          codePrompt: "",
          rawResponse: "",
          files: [],
          filesToDelete: [],
          requiredIntegrations: [],
          retries: 0,
          maxRetries: 1,
          codeMode: codeMode, // Will be inferred in graph nodes
        };
        const result = await runCodeGraph(initial);
        return {
          success: true,
          task: 'code',
          reportFile: result.reportFile,
          filesAnalyzed: result.filesChanged,
          message: result.filesChanged > 0
            ? `${result.filesChanged} files changed. Review with 'git diff' and commit when ready.`
            : `No code changes generated. See report for plan and learnings.`
        };
      }
    
    default:
      throw new Error(`Unknown task: ${task}`);
  }
}
