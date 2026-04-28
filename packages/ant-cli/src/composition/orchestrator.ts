import { architectAgent } from "../agents/architect/index";
import { runPlanGraph } from "../agents/planner";
import { runInlineAsk } from "../agents/architect/graph/ask/inlineAskRunner";
import { AdapterFactory } from "../infrastructure/adapters/AdapterFactory";
import { createLLMClient, createImageGenerationClient } from "../periphery/adapters/llm/LLMClientFactory";
import { FilePromptAdapter } from "../periphery/adapters/prompt/FilePromptAdapter";
import { CodebaseAnalyzer } from "../periphery/adapters/analyzer/CodebaseAnalyzer";
import { FileConfigAdapter } from "../periphery/adapters/config/FileConfigAdapter";
import { FileSessionAdapter } from "../periphery/adapters/session/FileSessionAdapter";
import { NodeCommandAdapter } from "../periphery/adapters/command/NodeCommandAdapter";
import { TaskQueueUpdatePort, FileTreeUpdatePort } from "../core/ports";
import { WorkflowStateUpdatePort } from "../core/ports/workflow";
import { PreviewUpdatePort } from "../core/ports/preview";
import { getChatAPIClient } from "../core/adapters/ChatAPIClient";
import { recordUserTurn } from "./recordUserTurn";
import * as path from "path";

/**
 * Orchestrator: Composition Root
 * 
 * Responsibilities:
 * 1. Instantiate adapters (periphery implementations)
 * 2. Inject dependencies into agents
 * 3. Route commands: agent → task → mode (hierarchical)
 * 
 * This is the only place where concrete implementations are wired together.
 */
export async function orchestrator(params: {
  agent: "architect" | "reviewer" | "planner" | "doc" | "creator";
  jobType?: "design" | "code" | "learn" | "review" | "plan" | "doc" | "inline-ask" | "visual";
  input: string;
  project?: string;
  feature?: string;  // ✅ Feature name (for chat jobs without inputFile)
  inputFile?: string;
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
  jobId?: string;  // ✅ Existing jobId for resume or tracking
  featurePath?: string;  // ✅ Full feature path
  projectPath?: string;  // ✅ Full project path
  workspaceResolver?: any;  // ✅ Workspace resolver for tenant-aware path resolution
  userContext?: any;  // ✅ User context
  overrideDirective?: string;  // ✅ Chat input as directive (highest priority)
  chatSource?: boolean;  // ✅ Flag for Chat SSE
  skipTriage?: boolean;  // ✅ Skip triage node (after user selects "proceed" on redirect)
  actionMetadata?: import('@ant/shared').ActionMetadata;  // ✅ Structured context from Actions panel
  /**
   * True when this invocation is a resume of a previously paused/interrupted job.
   * When true, recordUserTurn MUST skip writing a new user_turn (the original
   * turnId already lives in feature.jsonl); it only re-propagates the existing
   * turnId to LLMResponseService so subsequent trace lines keep the same grouping.
   */
  isResume?: boolean;
  /**
   * Pre-allocated turn id from `/chat/user-message` (chat SSOT §6).
   * When present, the orchestrator passes it as `recordUserTurn`'s
   * `turnId` so the durable user_turn line shares the same id as the
   * optimistic SSE broadcast. Eliminates the user-message duplication
   * defect.
   */
  seedTurnId?: string;
}) {
  const { agent, jobType, input, project, feature, inputFile, mode, enableEvaluation, jobId, featurePath, projectPath, workspaceResolver, userContext, overrideDirective, chatSource, skipTriage, actionMetadata, isResume, seedTurnId } = params;

  switch (agent) {
    case "architect": {
      if (!jobType || !['design', 'code', 'learn', 'inline-ask'].includes(jobType)) {
        throw new Error(`Architect agent requires jobType: 'design', 'code', 'learn', or 'inline-ask'`);
      }

      // Common dependencies for architect
      const memory = AdapterFactory.createMemoryAdapter();
      const config = new FileConfigAdapter();
      
      // Load project config for git/repo and LLM settings
      let configData = await config.load(project || "default");
      // Inject projectPath into configData for cloud mode
      if (configData.repoType === "cloud" && projectPath) {
        configData.projectPath = projectPath;
      }
      
      // LLM configuration - pass workspaceConfig for job/node-specific model selection
      // ✅ Create LLM with job context (nodes will override with specific nodeType if needed)
      const llm = createLLMClient('architect', undefined, { jobType: jobType as 'design' | 'code' | 'learn' }, configData);

      if (jobType === 'learn') {
        // Learn task: requires Git and Chunk for indexing
        const chunk = AdapterFactory.createChunkAdapter();
        const git = projectPath ? AdapterFactory.createGitAdapterWithConfig(project || "default", configData, projectPath) : undefined;
        
        return await architectAgent(input, project || "default", 'learn', inputFile, { 
          memory, 
          llm, 
          chunk, 
          git, 
          config,
          overrideDirective,
          chatSource,
          skipTriage,
          actionMetadata,
        });
      }

      if (jobType === 'inline-ask') {
        // ✅ Inline Ask: Lightweight job for handling ask during interrupted jobs
        // No session, no kanban, no fileTree — purely stateless
        console.log('🔧 [Orchestrator:InlineAsk] Starting inline-ask job...');

        if (!featurePath) {
          throw new Error('featurePath is required for inline-ask');
        }

        // ✅ Auto-detect interrupted job type from session files
        const { getAllSessionPaths } = await import("../core/utils/sessionPaths");
        const fsSync = await import("fs");
        let interruptedJob = 'design';
        let interruptedAgent = 'architect';
        let foundInterruptedSession = false;
        let existingTaskSummary: string | undefined;

        for (const entry of getAllSessionPaths(featurePath)) {
          if (fsSync.existsSync(entry.path)) {
            try {
              const data = JSON.parse(fsSync.readFileSync(entry.path, 'utf-8'));
              if (data.state?.interruption) {
                interruptedJob = entry.job;
                interruptedAgent = entry.agent;
                foundInterruptedSession = true;
                console.log(`🔧 [Orchestrator:InlineAsk] Detected interrupted job: ${interruptedAgent}/${interruptedJob}`);

                // Build task summary for continuation assessment
                const taskQueue = data.state?.taskQueue;
                const completedTasks = data.state?.completedTasks;
                if (taskQueue && Array.isArray(taskQueue) && taskQueue.length > 0) {
                  const taskLines = taskQueue.map((t: any, i: number) =>
                    `${i + 1}. [${t.status || 'pending'}] ${t.title || t.description || t.id || 'Untitled task'}`
                  );
                  const completedCount = Array.isArray(completedTasks) ? completedTasks.length : 0;
                  existingTaskSummary = `Pending tasks (${taskQueue.length}):\n${taskLines.join('\n')}`;
                  if (completedCount > 0) {
                    existingTaskSummary += `\n\nCompleted tasks: ${completedCount}`;
                  }
                  console.log(`📋 [Orchestrator:InlineAsk] Task summary: ${taskQueue.length} pending, ${completedCount} completed`);
                }
                break;
              }
            } catch {
              // Skip unreadable session files
            }
          }
        }

        if (!foundInterruptedSession) {
          console.warn('⚠️ [Orchestrator:InlineAsk] No interrupted session found — skip triage, return newJob');
          return {
            status: 'completed',
            intent: 'work',
            action: 'newJob',
            noSession: true,
          };
        }

        const inlineAskLLM = createLLMClient(
          'architect', undefined,
          { jobType: interruptedJob as 'design' | 'code' | 'learn' },
          configData
        );

        // ✅ Record user_turn to chat.jsonl (skipFeature=true — ask는 feature.jsonl 미기록).
        //   `seedTurnId` (chat SSOT §6) reuses the id pre-allocated by
        //   /chat/user-message so the durable record matches the optimistic
        //   SSE broadcast — the user-message duplication defect is gone.
        await recordUserTurn({
          featurePath,
          jobType: 'inline-ask',
          jobId: jobId || 'unknown',
          directive: overrideDirective || input,
          projectId: project,
          isResume,
          turnId: seedTurnId,
          actionMetadata,
        }).catch(err => {
          console.warn('[Orchestrator:InlineAsk] Failed to record user_turn:', err);
        });

        const result = await runInlineAsk({
          message: overrideDirective || input,
          featurePath,
          currentJob: interruptedJob,
          currentAgent: interruptedAgent,
          projectId: project,
          deps: { llm: inlineAskLLM, memory },
          _httpJobId: jobId,
          existingTaskSummary,
        });

        return {
          status: result.status,
          intent: result.intent,
          action: result.action,
          suggestedJob: result.suggestedJob,
          suggestedAgent: result.suggestedAgent,
          redirectReason: result.redirectReason,
          response: result.response,
          noSession: !foundInterruptedSession,
        };
      }

      // Design and Code tasks: full dependencies
      const promptPort = new FilePromptAdapter();
      const chunk = AdapterFactory.createChunkAdapter();
      
      // ✅ Require featurePath and projectPath - no fallback
      if (!featurePath || !projectPath) {
        throw new Error('featurePath and projectPath are required for design/code tasks');
      }
      
      // ✅ Extract featureName from featurePath
      const featureName = featurePath.split(path.sep).filter(Boolean).pop() || 'unknown';
      
      // ✅ Get FileSystemPort and GitPort (separated responsibilities)
      // Use ANT_CODEBASE_PATH (set by JobWorker for feature-aware worktree paths)
      const codebasePath = process.env.ANT_CODEBASE_PATH || path.join(featurePath, 'codebase');
      const fileSystem = AdapterFactory.createFileSystemAdapterWithPath(featurePath);  // ✅ Use featurePath (feature root: plan/architecture/visual/assets/meta/sessions/codebase)
      const git = AdapterFactory.createGitAdapterWithConfig(project || "default", configData, codebasePath);

      if (jobType === 'design') {
        console.log('🔧 [Orchestrator:Design] Starting design job...');

        const analyzer = new CodebaseAnalyzer();

        // ✅ Real-time updates via Redis Pub/Sub (Job Worker child process → Redis → Realtime Server → SSE)
        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
        let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
        let closeBroadcasters: (() => Promise<void>) | undefined = undefined;
        let redis: any = undefined;

        if (process.env.ANT_REDIS_URL) {
          try {
            const { createRealtimeBroadcasters, getBroadcasterOptionsFromEnv } = await import('../core/realtime');
            const options = getBroadcasterOptionsFromEnv();

            if (options) {
              const broadcasters = createRealtimeBroadcasters(options);
              kanbanUpdate = broadcasters.kanban;
              fileTreeUpdate = broadcasters.fileTree;
              workflowUpdate = broadcasters.workflow;
              closeBroadcasters = () => broadcasters.close();
              console.log('✅ Real-time updates enabled (Redis Pub/Sub) [Design]');
            } else {
              console.log('⚠️  Redis URL set but missing required env vars for broadcasting [Design]');
            }
          } catch (error: any) {
            console.log('⚠️  Failed to initialize real-time broadcasters [Design]:', error?.message);
          }

          if (process.env.ANT_SERVER_MODE === 'cloud') {
            try {
              const { default: Redis } = await import('ioredis');
              const url = process.env.ANT_REDIS_URL;
              const isTLS = url.startsWith('rediss://');
              const tlsOpts = isTLS ? { tls: { checkServerIdentity: () => undefined as undefined } } : {};
              redis = new Redis(url, { ...tlsOpts, maxRetriesPerRequest: 3, lazyConnect: true });
              await redis.connect();
              console.log('✅ Redis client created for Figma MCP bridge [Design]');
            } catch (error: any) {
              console.log('⚠️  Failed to create Redis for Figma bridge [Design]:', error?.message);
              redis = undefined;
            }
          }
        } else {
          console.log('ℹ️  Real-time updates disabled (no ANT_REDIS_URL) [Design]');
        }

        // ✅ Create session with file tree update support (agent-nested)
        const session = new FileSessionAdapter(featurePath, 'architect', project, featureName, fileTreeUpdate);

        // ✅ Record user_turn (feature.jsonl + chat.jsonl). skipFeature=false for design.
        // mode is not yet known for design (Detect runs inside the graph) → undefined.
        // When isResume=true the helper skips the append and only re-propagates the
        // existing turnId into LLMResponseService — see recordUserTurn JSDoc.
        // `seedTurnId` reuses the id pre-allocated by /chat/user-message
        // (chat SSOT §6) so the durable user_turn matches the optimistic
        // SSE broadcast id.
        await recordUserTurn({
          featurePath,
          jobType: 'design',
          jobId: jobId || 'unknown',
          directive: overrideDirective || input,
          isResume,
          turnId: seedTurnId,
          session,
          actionMetadata,
        }).catch(err => {
          console.warn('[Orchestrator:Design] Failed to record user_turn:', err);
        });

        // ✅ CRITICAL: Pass featurePath directly to avoid re-calculation mismatch
        const result = await architectAgent(
          input,
          project || "default",
          'design',
          inputFile,
          { memory, llm, promptPort, config, chunk, session, git, fileSystem, analyzer, kanbanUpdate, fileTreeUpdate, workflowUpdate, workspaceResolver, userContext, overrideDirective, chatSource, skipTriage, actionMetadata, feature, featurePath, redis },
          undefined,  // codeMode
          undefined,  // enableEvaluation
          jobId
        );

        // Drain pending chat broadcasts before process exits
        const { drainChatBroadcaster } = await import('../core/adapters/ChatAPIClient');
        await drainChatBroadcaster();
        await closeBroadcasters?.();
        await redis?.quit?.();

        return result;
      }

      if (jobType === 'code') {
        const analyzer = new CodebaseAnalyzer();
        const command = new NodeCommandAdapter();

        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
        let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
        let previewUpdate: PreviewUpdatePort | undefined = undefined;
        let closeBroadcasters: (() => Promise<void>) | undefined = undefined;

        // Redis client for cloud-mode Figma MCP (BridgeMCPTransport)
        let codeRedis: any = undefined;

        if (process.env.ANT_REDIS_URL) {
          try {
            const { createRealtimeBroadcasters, getBroadcasterOptionsFromEnv } = await import('../core/realtime');
            const options = getBroadcasterOptionsFromEnv();

            if (options) {
              const broadcasters = createRealtimeBroadcasters(options);
              kanbanUpdate = broadcasters.kanban;
              fileTreeUpdate = broadcasters.fileTree;
              workflowUpdate = broadcasters.workflow;
              previewUpdate = broadcasters.preview;
              closeBroadcasters = () => broadcasters.close();
              console.log('✅ Real-time updates enabled (Redis Pub/Sub) [Code]');
            } else {
              console.log('⚠️  Redis URL set but missing required env vars for broadcasting [Code]');
            }
          } catch (error: any) {
            console.log('⚠️  Failed to initialize real-time broadcasters [Code]:', error?.message);
          }

          if (process.env.ANT_SERVER_MODE === 'cloud') {
            try {
              const Redis = (await import('ioredis')).default;
              const { createTLSOptions } = await import('../infrastructure/utils/redis');
              const url = process.env.ANT_REDIS_URL;
              codeRedis = new Redis(url, { ...createTLSOptions(url), maxRetriesPerRequest: 3, lazyConnect: true });
              await codeRedis.connect();
              console.log('✅ Redis client created for Code Job Figma MCP [Cloud]');
            } catch (error: any) {
              console.log('⚠️  Failed to create Redis client for Code Figma MCP:', error?.message);
              codeRedis = undefined;
            }
          }
        } else {
          console.log('ℹ️  Real-time updates disabled (no ANT_REDIS_URL) [Code]');
        }

        const session = new FileSessionAdapter(featurePath, 'architect', project, featureName, fileTreeUpdate);

        // ✅ Record user_turn (feature.jsonl + chat.jsonl). Mode may be known via --mode/env.
        // When isResume=true the helper skips the append and only re-propagates the
        // existing turnId into LLMResponseService — see recordUserTurn JSDoc.
        // `seedTurnId` reuses the id pre-allocated by /chat/user-message
        // (chat SSOT §6).
        await recordUserTurn({
          featurePath,
          jobType: 'code',
          jobId: jobId || 'unknown',
          directive: overrideDirective || input,
          mode,
          isResume,
          turnId: seedTurnId,
          session,
          actionMetadata,
        }).catch(err => {
          console.warn('[Orchestrator:Code] Failed to record user_turn:', err);
        });

        const result = await architectAgent(
          input,
          project || "default",
          'code',
          inputFile,
          { memory, llm, promptPort, analyzer, git, fileSystem, config, chunk, session, command, kanbanUpdate, fileTreeUpdate, workflowUpdate, previewUpdate, workspaceResolver, userContext, overrideDirective, chatSource, skipTriage, actionMetadata, feature, featurePath, redis: codeRedis },
          mode,
          enableEvaluation,
          jobId
        );

        const { drainChatBroadcaster } = await import('../core/adapters/ChatAPIClient');
        await drainChatBroadcaster();
        await closeBroadcasters?.();
        await codeRedis?.quit?.();

        return result;
      }

      throw new Error(`Unknown architect jobType: ${jobType}`);
    }

    case "planner": {
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('planner', undefined, { jobType: 'plan' }, configData);

      // Setup real-time updates via Redis Pub/Sub
      let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
      let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
      let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
      let closeBroadcasters: (() => Promise<void>) | undefined = undefined;

      if (process.env.ANT_REDIS_URL) {
        try {
          const { createRealtimeBroadcasters, getBroadcasterOptionsFromEnv } = await import('../core/realtime');
          const options = getBroadcasterOptionsFromEnv();
          if (options) {
            const broadcasters = createRealtimeBroadcasters(options);
            kanbanUpdate = broadcasters.kanban;
            fileTreeUpdate = broadcasters.fileTree;
            workflowUpdate = broadcasters.workflow;
            closeBroadcasters = () => broadcasters.close();
            console.log('✅ Real-time updates enabled (Redis Pub/Sub) [Planner]');
          } else {
            console.log('⚠️  Redis URL set but missing required env vars for broadcasting [Planner]');
          }
        } catch (error: any) {
          console.log('⚠️  Failed to initialize real-time broadcasters [Planner]:', error?.message);
        }
      } else {
        console.log('ℹ️  Real-time updates disabled (no ANT_REDIS_URL) [Planner]');
      }

      // Create session for planner
      const session = new FileSessionAdapter(featurePath || '', 'planner', project, feature, fileTreeUpdate);

      // ✅ Record user_turn (feature.jsonl + chat.jsonl) — plan is a feature-context job.
      // Use the orchestrator-level `isResume` param (propagated from job-runner via
      // ANT_IS_RESUME). The legacy `!!(overrideDirective && jobId)` heuristic was a
      // false-positive trap — a normal continue endpoint with both fields set looks
      // identical to a real resume, producing duplicate user_turn lines.
      if (featurePath) {
        // `seedTurnId` reuses the id pre-allocated by /chat/user-message
        // (chat SSOT §6).
        await recordUserTurn({
          featurePath,
          jobType: 'plan',
          jobId: jobId || 'unknown',
          directive: overrideDirective || input,
          isResume,
          turnId: seedTurnId,
          session,
          actionMetadata,
        }).catch(err => {
          console.warn('[Orchestrator:Planner] Failed to record user_turn:', err);
        });
      }

      // Detect language from directive
      const language = /[가-힣]/.test(input) ? 'ko' : 'en';

      const planPromptPort = new FilePromptAdapter();
      const { PromptBuilder } = await import('../core/prompt/builder/PromptBuilder');
      const planPromptBuilder = new PromptBuilder(planPromptPort);

      const result = await runPlanGraph({
        directive: input,
        language: language as 'ko' | 'en',
        workspaceState: { featurePath: featurePath || '' } as any,
        featurePath: featurePath || '',
        // Authoritative orchestrator-level signal (propagated from
        // ANT_IS_RESUME in job-runner). The legacy `!!(overrideDirective && jobId)`
        // heuristic was removed in session-redesign §3 — keeping it here would
        // re-introduce the false-positive trap that created duplicate user_turn
        // lines (see recordUserTurn call above). runPlanGraph still has its own
        // session-state `interruption` detection + ANT_IS_RESUME env fallback
        // for legitimate resume detection, so dropping this heuristic is safe.
        isResume,
        chatSource: chatSource,
        skipTriage: skipTriage,
        actionMetadata: actionMetadata,
        deps: { llm, session, kanbanUpdate, fileTreeUpdate, workflowUpdate, promptPort: planPromptPort, promptBuilder: planPromptBuilder },
        _httpJobId: jobId,
      });

      // Drain pending chat broadcasts before process exits
      const { drainChatBroadcaster } = await import('../core/adapters/ChatAPIClient');
      await drainChatBroadcaster();
      await closeBroadcasters?.();

      return result;
    }

    case "creator": {
      if (!jobType || !['visual'].includes(jobType)) {
        throw new Error(`Creator agent requires jobType: 'visual'`);
      }

      if (!featurePath) {
        throw new Error('featurePath is required for visual tasks');
      }

      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");

      const visualPromptPort = new FilePromptAdapter();
      const llm = createLLMClient('creator', undefined, { jobType: 'visual' }, configData);
      const directLLM = createLLMClient('creator', undefined, { jobType: 'visual', nodeType: 'direct' }, configData);
      const explainLLM = createLLMClient('creator', undefined, { jobType: 'visual', nodeType: 'explain' }, configData);
      const engraveLLM = createLLMClient('creator', undefined, { jobType: 'visual', nodeType: 'engrave' }, configData);
      const sketchImageClient = createImageGenerationClient(configData, configData.llmModels?.visual?.sketch);
      const renderImageClient = createImageGenerationClient(configData, configData.llmModels?.visual?.render);

      const { VisualProcessorClient } = await import('../periphery/adapters/visualProcessor/VisualProcessorClient');
      const { NoopBackgroundRemoval } = await import('../periphery/adapters/visualProcessor/NoopBackgroundRemoval');
      const visualProcessorUrl = process.env.ANT_VISUAL_PROCESSOR_URL || 'http://localhost:4103';
      const backgroundRemoval = configData.visualSettings?.removeBackground !== false
        ? new VisualProcessorClient(visualProcessorUrl)
        : new NoopBackgroundRemoval();

      let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
      let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
      let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
      let closeBroadcasters: (() => Promise<void>) | undefined = undefined;

      if (process.env.ANT_REDIS_URL) {
        try {
          const { createRealtimeBroadcasters, getBroadcasterOptionsFromEnv } = await import('../core/realtime');
          const options = getBroadcasterOptionsFromEnv();
          if (options) {
            const broadcasters = createRealtimeBroadcasters(options);
            kanbanUpdate = broadcasters.kanban;
            fileTreeUpdate = broadcasters.fileTree;
            workflowUpdate = broadcasters.workflow;
            closeBroadcasters = () => broadcasters.close();
            console.log('✅ Real-time updates enabled (Redis Pub/Sub) [Creator]');
          }
        } catch (error: any) {
          console.log('⚠️  Failed to initialize real-time broadcasters [Creator]:', error?.message);
        }
      }

      const featureName = featurePath.split(path.sep).filter(Boolean).pop() || 'unknown';
      const session = new FileSessionAdapter(featurePath, 'creator', project, featureName, fileTreeUpdate);

      const { runVisualGraph } = await import("../agents/creator/graph/visual/runner");

      const result = await runVisualGraph({
        directive: input,
        featurePath,
        // Authoritative orchestrator-level signal only. The legacy
        // `!!(overrideDirective && jobId)` heuristic was a false-positive trap
        // (see session-redesign §3 + the planner branch above). job-runner
        // propagates ANT_IS_RESUME explicitly; direct callers must opt in.
        isResume,
        chatSource,
        skipTriage,
        actionMetadata,
        deps: {
          llm,
          directLLM,
          explainLLM,
          engraveLLM,
          sketchImageClient,
          renderImageClient,
          promptBuilder: new (await import('../core/prompt/builder/PromptBuilder')).PromptBuilder(visualPromptPort),
          session,
          kanbanUpdate,
          fileTreeUpdate,
          workflowUpdate,
          backgroundRemoval,
        },
        visualSettings: configData.visualSettings,
        _httpJobId: jobId,
      });

      const { drainChatBroadcaster } = await import('../core/adapters/ChatAPIClient');
      await drainChatBroadcaster();
      await closeBroadcasters?.();

      return result;
    }

    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

