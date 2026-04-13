import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../state";
import { ReferenceContext } from "../../../../../core/codebase/types";
import * as path from "path";
import type { ConversationEntry } from "../../../../../core/types/session";
import { CODE_JOB_COMPACTION_THRESHOLD, CODE_JOB_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS } from "../../../../../core/context/constants";
import type { ResolveStrategy } from '../../../../common/nodes/resolve/types';
import { compressHeavyweightEntries, validateWorkspaceAndFeature, initJobTiming } from '../../../../common/nodes/resolve/utils';

/**
 * Code Resolve Strategy
 *
 * Implements ResolveStrategy for the code job.
 * - loadArtifacts: workspace validation, artifact loading, conversation compaction
 * - onResume: design doc/figma reload, asset indexing
 * - initNewJob: jobTiming initialization
 */
export const codeResolveStrategy: ResolveStrategy<ArchitectGraphState> = {
  async initNewJob(state) {
    const effectiveDirective = state.overrideDirective || state.directive || undefined;
    const { jobId, jobTiming } = await initJobTiming({
      httpJobId: state._httpJobId!,
      session: state.deps?.session,
      kanbanUpdate: state.deps?.kanbanUpdate,
      project: state.context.project,
      featureFolder: state.context.featureFolder,
      jobType: 'code',
      extraSessionState: {
        overrideDirective: effectiveDirective,
        chatSource: state.chatSource,
        userLanguage: state.context.userLanguage,
      },
    });

    // Clear conversation history for NEW JOB
    state.conversationHistory = [];

    // Send "estimating started" signal (empty task list)
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        null,
        [],
        [],
        0,
        undefined,
      );
    }

    return { jobId, jobTiming } as unknown as Partial<ArchitectGraphState>;
  },

  async onResume(state) {
    console.log(`🔄 Resume: tasks=${state.taskQueue?.size() || 0}, detection=${!!state.resolvedAction}, completed=${state.completedTasks?.length || 0}`);
    
    if (!state.workspaceConfig) {
      try {
        const { FileConfigAdapter } = await import('../../../../../periphery/adapters/config/FileConfigAdapter');
        const configAdapter = new FileConfigAdapter();
        state.workspaceConfig = await configAdapter.load(state.context.project);
      } catch (error) {
        console.error(`❌ Failed to reload workspaceConfig:`, error);
      }
    }

    if (!state.context.featurePath && state.deps?.workspaceResolver) {
      const userContext = {
        userId: state.context.userId || 'local',
        organizationId: state.context.organizationId || 'local',
      };
      state.context.featurePath = state.deps.workspaceResolver.getFeaturePath(
        userContext as any,
        state.context.project,
        state.context.featureFolder
      );
    }

    const gitPort = state.deps?.git;
    const fileSystem = state.deps?.fileSystem;
    if (gitPort && fileSystem) {
      try {
        state.designDocs = await ArtifactService.loadDesignDocuments(state.context, gitPort, fileSystem, 'unknown');
        
        const resumeSpecDocs = await ArtifactService.loadSpecDocuments(state.context, gitPort, fileSystem);
        if (Object.keys(resumeSpecDocs).length > 0) {
          state.specDocs = resumeSpecDocs;
        }

        const designResult = await ArtifactService.findLatestDesign(state.context, gitPort, fileSystem);
        if (designResult?.content) {
          state.design = designResult.content;
          state.designDocPath = designResult.filePath;
        }

        const source = await ArtifactService.getSource(state.context, gitPort, fileSystem);
        if (source?.prd) state.prd = source.prd;
        if (source?.sourceDocuments) state.sourceDocuments = source.sourceDocuments;

        state.parsedUiDocs = await ArtifactService.loadParsedUiContext(state.context, gitPort, fileSystem) || undefined;

        // profile comes from codebase analysis (resolve), not detect

        console.log(`📄 [Resolve/Resume] design=${!!state.design}, designDocs=${!!state.designDocs}, prd=${!!state.prd}, ui=${!!state.parsedUiDocs}`);
      } catch (error) {
        console.warn(`⚠️  [Resolve/Resume] Failed to reload design artifacts:`, error);
      }
    }

    // Figma MCP re-detection on resume
    state.figmaAvailable = false;
    state.figmaFileKey = undefined;
    state.figmaStartNodeId = undefined;
    try {
      const featurePathResume = state.context.featurePath;
      if (featurePathResume) {
        const pathMod = await import('path');
        const figmaJsonPath = pathMod.join(featurePathResume, 'inputs', 'figma.json');
        const figmaRaw = await state.deps?.fileSystem?.readFile?.(figmaJsonPath);
        if (figmaRaw) {
          const { isFigmaDataPopulated, extractFigmaUrlParts } = await import('@ant/shared');
          const figmaConfig = JSON.parse(figmaRaw);
          if (isFigmaDataPopulated(figmaConfig)) {
            const serverMode = process.env.ANT_SERVER_MODE || 'local';
            let figmaUp = false;
            if (serverMode === 'local') {
              const { checkLocalMCPAvailability } = await import('../../../../../periphery/adapters/figma/MCPTransport');
              figmaUp = await checkLocalMCPAvailability();
            } else {
              const { createMCPTransport } = await import('../../../../../periphery/adapters/figma/MCPTransport');
              const transport = createMCPTransport({ serverMode: 'cloud', userId: state.context?.userId, redis: state.deps?.redis });
              figmaUp = await transport.isAvailable();
            }
            if (figmaUp && figmaConfig.file) {
              const parts = extractFigmaUrlParts(figmaConfig.file);
              if (parts.fileKey) {
                state.figmaAvailable = true;
                state.figmaFileKey = parts.fileKey;
                state.figmaStartNodeId = parts.nodeId;
              }
            }
          }
        }
      }
      console.log(`🎨 [Resolve/Resume] Figma MCP: ${state.figmaAvailable ? `available (fileKey=${state.figmaFileKey})` : 'unavailable'}`);
    } catch {
      console.log(`🎨 [Resolve/Resume] Figma MCP: detection failed, disabled`);
    }

    // Index runtime assets
    state.runtimeAssetsIndex = await indexRuntimeAssets(state.context.featurePath);

    return {
      workspaceConfig: state.workspaceConfig,
      context: state.context,
      designDocs: state.designDocs,
      specDocs: state.specDocs,
      design: state.design,
      designDocPath: state.designDocPath,
      prd: state.prd,
      sourceDocuments: state.sourceDocuments,
      parsedUiDocs: state.parsedUiDocs,
      profile: state.profile,
      techTier: state.techTier,
      figmaAvailable: state.figmaAvailable,
      figmaFileKey: state.figmaFileKey,
      figmaStartNodeId: state.figmaStartNodeId,
      runtimeAssetsIndex: state.runtimeAssetsIndex,
    } as Partial<ArchitectGraphState>;
  },

  async loadArtifacts(state) {
    const { context } = state;

    const gitPort = state.deps?.git;
    const fileSystem = state.deps?.fileSystem;
    if (!gitPort || !fileSystem) {
      throw new Error("GitPort and FileSystemPort not provided for file operations");
    }

    // Validate workspace and feature directories
    const featurePath = await validateWorkspaceAndFeature({
      context: context as any,
      workspaceResolver: state.deps?.workspaceResolver!,
    });
    context.featurePath = featurePath;

    // Index runtime assets
    const runtimeAssetsIndex = await indexRuntimeAssets(featurePath);

    // Load design document (optional)
    const actionRefs = state.actionMetadata?.refs;
    const actionContext = state.actionMetadata?.context;
    const hasExplicitRefs = actionRefs && actionRefs.length > 0;

    const designResult = await ArtifactService.findLatestDesign(context, gitPort, fileSystem);
    const design = designResult?.content || undefined;
    const designDocPath = designResult?.filePath || undefined;

    const source = await ArtifactService.getSource(context, gitPort, fileSystem);
    const prd = source?.prd || undefined;
    let sourceDocuments = source?.sourceDocuments;

    if (hasExplicitRefs && sourceDocuments) {
      const allowedPaths = new Set([...(actionRefs || []), ...(actionContext || [])]);
      const filtered: Record<string, string> = {};
      for (const [name, content] of Object.entries(sourceDocuments)) {
        if (allowedPaths.has(`inputs/sources/${name}`) || allowedPaths.has(name)) {
          filtered[name] = content;
        }
      }
      if (Object.keys(filtered).length > 0) {
        sourceDocuments = filtered;
        console.log(`📋 [Resolve] ActionMetadata refs filter: ${Object.keys(filtered).length} source docs selected`);
      }
    }

    const parsedUiDocs = await ArtifactService.loadParsedUiContext(context, gitPort, fileSystem);
    console.log(`📄 [Resolve] Design: ${design ? 'loaded' : 'none'}, PRD: ${prd ? 'loaded' : 'none'}, UI: ${parsedUiDocs ? 'loaded' : 'none'}`);

    // Figma MCP availability detection
    let figmaAvailable = false;
    let figmaFileKey: string | undefined;
    let figmaStartNodeId: string | undefined;
    try {
      const figmaJsonPath = path.join(featurePath, 'inputs', 'figma.json');
      const figmaRaw = await fileSystem?.readFile?.(figmaJsonPath);
      if (figmaRaw) {
        const { isFigmaDataPopulated, extractFigmaUrlParts } = await import('@ant/shared');
        const figmaConfig = JSON.parse(figmaRaw);
        if (isFigmaDataPopulated(figmaConfig)) {
          const serverMode = process.env.ANT_SERVER_MODE || 'local';
          if (serverMode === 'local') {
            const { checkLocalMCPAvailability } = await import('../../../../../periphery/adapters/figma/MCPTransport');
            figmaAvailable = await checkLocalMCPAvailability();
          } else {
            const { createMCPTransport } = await import('../../../../../periphery/adapters/figma/MCPTransport');
            const transport = createMCPTransport({ serverMode: 'cloud', userId: state.context?.userId, redis: state.deps?.redis });
            figmaAvailable = await transport.isAvailable();
          }
          if (figmaAvailable && figmaConfig.file) {
            const parts = extractFigmaUrlParts(figmaConfig.file);
            if (parts.fileKey) {
              figmaFileKey = parts.fileKey;
              figmaStartNodeId = parts.nodeId;
            } else {
              figmaAvailable = false;
            }
          }
        }
      }
    } catch { /* figma.json missing or malformed */ }
    console.log(`🎨 [Resolve] Figma MCP: ${figmaAvailable ? `available (fileKey=${figmaFileKey})` : 'unavailable'}`);

    const designDocs = await ArtifactService.loadDesignDocuments(context, gitPort, fileSystem, 'unknown');
    const specDocs = await ArtifactService.loadSpecDocuments(context, gitPort, fileSystem);

    // Load directive (overrideDirective > file)
    let directive: string | undefined;
    if (state.overrideDirective) {
      directive = state.overrideDirective;
    } else {
      directive = await ArtifactService.getDirective(context, 'code', gitPort, fileSystem) || undefined;
    }

    if (!design && !directive) {
      throw new Error(
        "No design document or directive found.\n" +
        "For new features: Run 'architect design' first.\n" +
        "For modifications: Provide directive in workspace/{project}/{feature}/inputs/directives/code/directive.md",
      );
    }

    // Session context for LLM
    const { SessionContextBuilder } = await import('../../../../../agents/architect/session/SessionContextBuilder');
    const sessionBuilder = new SessionContextBuilder();
    const session = state.deps?.session
      ? await state.deps.session.load(context.project, context.featureFolder, 'code')
      : null;
    const sessionContext = session?.runs && session.runs.length > 0
      ? sessionBuilder.buildContextForLLM(session.runs, 'generate', directive || design || '')
      : undefined;

    // Inter-Job Context Bridge: Load & compact jobConversation
    const rawJobConversation: ConversationEntry[] = session?.state?.jobConversation || [];
    let processedJobConversation = rawJobConversation;
    const promptBuilder = state.deps?.promptBuilder;
    if (rawJobConversation.length > 0 && state.deps?.llm && promptBuilder) {
      const promptPort = promptBuilder;
      if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
        state.deps.kanbanUpdate.setEstimatingActivity('Compacting previous context...', 'resolve');
      }
      let compactionChanged = false;
      const trigger2Result = await compressHeavyweightEntries(processedJobConversation, state.deps.llm, promptPort);
      processedJobConversation = trigger2Result.entries;
      compactionChanged = trigger2Result.changed;

      const { compactJob, applyCompactionToConversation } = await import('../../../../../core/context/compactJob');
      try {
        const compactResult = await compactJob(processedJobConversation, state.deps.llm, promptPort, {
          threshold: CODE_JOB_COMPACTION_THRESHOLD,
          recentWindowSize: CODE_JOB_COMPACTION_WINDOW,
          maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        });
        if (compactResult.wasCompacted) {
          processedJobConversation = applyCompactionToConversation(
            processedJobConversation,
            { summary: compactResult.summary!, summarizedCount: processedJobConversation.length - CODE_JOB_COMPACTION_WINDOW },
            (summary) => ({ role: 'system' as const, content: summary, timestamp: new Date().toISOString(), metadata: { chapterSummary: 'Previous jobs summary' } }),
          );
          compactionChanged = true;
        }
      } catch (err) {
        console.warn(`⚠️  [Resolve] Trigger 1 compaction failed, using uncompacted entries:`, err);
      }
      if (compactionChanged && state.deps?.session) {
        try {
          const existingSessionForUpdate = await state.deps.session.load(context.project, context.featureFolder, 'code');
          await state.deps.session.updateArtifacts(context.project, context.featureFolder, 'code', {
            state: { ...existingSessionForUpdate.state, jobConversation: processedJobConversation },
          });
          console.log(`💾 [Resolve] Persisted compacted jobConversation (${rawJobConversation.length} → ${processedJobConversation.length} entries)`);
        } catch (err) {
          console.warn(`⚠️  [Resolve] Failed to persist compacted jobConversation:`, err);
        }
      }
      console.log(`📋 [Resolve] Inter-Job Context: ${processedJobConversation.length} entries loaded`);
    }

    const referenceContexts: ReferenceContext[] = [];

    return {
      context,
      featurePath: context.featurePath,
      directive,
      prd,
      sourceDocuments,
      parsedUiDocs: parsedUiDocs || undefined,
      design,
      designDocPath,
      designDocs,
      specDocs: Object.keys(specDocs).length > 0 ? specDocs : undefined,
      sessionContext,
      profile: undefined,
      referenceContexts,
      resolvedAction: state.resolvedAction,
      figmaAvailable,
      figmaFileKey,
      figmaStartNodeId,
      jobConversation: processedJobConversation,
      runtimeAssetsIndex,
      conversationHistory: [],
    } as Partial<ArchitectGraphState>;
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper: index runtime assets under inputs/assets/
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function indexRuntimeAssets(featurePath?: string): Promise<{ files: string[]; count: number }> {
  if (!featurePath) return { files: [], count: 0 };
  try {
    const pathMod = await import('path');
    const fsMod = await import('fs');
    const assetsRootAbs = pathMod.join(featurePath, 'inputs', 'assets');
    const files: string[] = [];
    const maxFiles = parseInt(process.env.ANT_RUNTIME_ASSETS_INDEX_MAX || '200', 10);

    const walk = (dirAbs: string) => {
      if (files.length >= maxFiles) return;
      let entries: any[] = [];
      try { entries = fsMod.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (files.length >= maxFiles) break;
        if (e.name.startsWith('.')) continue;
        const abs = pathMod.join(dirAbs, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile()) {
          const relToFeature = pathMod.relative(featurePath, abs).replace(/\\/g, '/');
          if (relToFeature && !relToFeature.startsWith('..')) files.push(relToFeature);
        }
      }
    };

    if (fsMod.existsSync(assetsRootAbs)) walk(assetsRootAbs);
    return { files, count: files.length };
  } catch {
    return { files: [], count: 0 };
  }
}

