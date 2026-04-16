import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { WorkspacePathResolver } from "../../../../../core/config/WorkspacePathResolver";
import { DesignGraphState } from "../state";
import * as path from "path";
import { isTemplateContent } from "../../../../../core/utils/templateDetector";
import { FIGMA_FILENAME, FigmaDataConfig, migrateFigmaConfig, createEmptyFigmaData, DESIGN_DIR, DESIGN_SUBDIR } from "@ant/shared";
import type { ConversationEntry } from "../../../../../core/types/session";
import { DESIGN_JOB_COMPACTION_THRESHOLD, DESIGN_JOB_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS } from "../../../../../core/context/constants";
import type { ResolveStrategy } from '../../../../common/graph/nodes/resolve/types';
import { compressHeavyweightEntries, validateWorkspaceAndFeature, initJobTiming } from '../../../../common/graph/nodes/resolve/utils';
import { buildSessionDigest } from '../../../../common/graph/utils/sessionDigest';
import { scanDesignOutputs, buildDesignArtifactPool } from '../../../../../core/prompt/builder/ArtifactPipeline';

const DESIGN_FILE_PATTERNS = [
  /^api-contract-.+\.md$/,
  /^fe-system-.+\.md$/,
  /^be-system-.+\.md$/,
];

/**
 * Design Resolve Strategy
 *
 * Implements ResolveStrategy for the design job.
 * - initNewJob: jobTiming initialization (before first broadcast)
 * - loadArtifacts: workspace validation, source/design/figma loading, conversation compaction
 * - onResume: existing design docs reload, source documents reload
 */
export const designResolveStrategy: ResolveStrategy<DesignGraphState> = {
  async initNewJob(state) {
    if (!state._httpJobId) return {} as Partial<DesignGraphState>;

    const { jobId, jobTiming } = await initJobTiming({
      httpJobId: state._httpJobId,
      session: state.deps?.session,
      kanbanUpdate: state.deps?.kanbanUpdate,
      project: state.context.project,
      featureFolder: state.context.featureFolder,
      jobType: 'design',
      extraSessionState: {
        overrideDirective: state.overrideDirective || state.directive || undefined,
        chatSource: state.chatSource,
        userLanguage: state.context.userLanguage,
      },
    });

    return { jobId, jobTiming } as unknown as Partial<DesignGraphState>;
  },

  async onResume(state) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 DESIGN AGENT - RESUME (Skip Resolve)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const hasTaskQueue = state.taskQueue && !state.taskQueue.isEmpty();
    const hasResolvedAction = Boolean(state.resolvedAction);
    const hasNewDirective = Boolean(state.overrideDirective);
    console.log(`   isResume: true`);
    console.log(`   hasTaskQueue: ${hasTaskQueue} (${state.taskQueue?.size() || 0} tasks)`);
    console.log(`   hasResolvedAction: ${hasResolvedAction}`);
    console.log(`   hasNewDirective: ${hasNewDirective}`);
    console.log(`   → Router will decide next node\n`);

    const context = state.context;
    const featurePath = context.featurePath || '';

    // Reload existingDesignDocs from disk (not stored in session)
    let existingDesignDocs: Record<string, string> | undefined;
    if (featurePath) {
      const fs = await import('fs');
      try {
        const designDirAbs = path.join(featurePath, DESIGN_DIR);
        const reloaded: Record<string, string> = {};
        for (const dir of [path.join(designDirAbs, DESIGN_SUBDIR.SYSTEM), designDirAbs]) {
          if (!fs.existsSync(dir)) continue;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() || reloaded[e.name]) continue;
            if (DESIGN_FILE_PATTERNS.some(p => p.test(e.name))) {
              const content = fs.readFileSync(path.join(dir, e.name), 'utf-8');
              if (content?.trim()) reloaded[e.name] = content;
            }
          }
        }
        if (Object.keys(reloaded).length > 0) {
          existingDesignDocs = reloaded;
          console.log(`📄 [Design Resolve] Reloaded existingDesignDocs: [${Object.keys(reloaded).join(', ')}]`);
        }
      } catch { /* Non-critical */ }
    }

    // Reload sourceDocuments/PRD from disk
    let prd: string | undefined;
    let sourceDocuments: Record<string, string> | undefined;
    if (featurePath) {
      const gitPort = state.deps?.git;
      const fileSystem = state.deps?.fileSystem;
      if (gitPort && fileSystem) {
        try {
          const source = await ArtifactService.getSource(context, gitPort, fileSystem);
          if (source?.prd) prd = source.prd;
          if (source?.sourceDocuments) sourceDocuments = source.sourceDocuments;
          console.log(`📄 [Design Resolve] Reloaded sourceDocuments on resume (prd: ${!!source?.prd}, docs: ${Object.keys(source?.sourceDocuments || {}).length})`);
        } catch (err: any) {
          console.warn(`⚠️ [Design Resolve] Failed to reload sourceDocuments on resume: ${err.message}`);
        }
      }
    }

    // Build artifact pool from disk (restores previous task outputs including UI docs)
    const designOutputs = featurePath ? scanDesignOutputs(featurePath) : [];
    const artifacts = buildDesignArtifactPool({
      sourceDocuments,
      designOutputs,
    });
    console.log(`📄 [Design Resolve] Resume pool: ${artifacts.length} artifacts (${designOutputs.length} from disk)`);

    return {
      existingDesignDocs,
      artifacts,
    } as Partial<DesignGraphState>;
  },

  async loadArtifacts(state) {
    const jobMode = state.resolvedAction?.mode;
    const context = state.context;

    const gitPort = state.deps?.git;
    if (!gitPort) throw new Error("GitPort not provided for file operations");
    const fileSystem = state.deps?.fileSystem;
    if (!fileSystem) throw new Error('FileSystemPort is required for workspace resolution');

    // Validate workspace and feature directories
    const featurePath = await validateWorkspaceAndFeature({
      context: context as any,
      workspaceResolver: state.deps?.workspaceResolver!,
    });
    context.featurePath = featurePath;

    // Load source documents
    const actionRefs = state.actionMetadata?.refs;
    const actionCtx = state.actionMetadata?.context;
    const hasExplicitRefs = actionRefs && actionRefs.length > 0;

    let prd: string | undefined;
    let sourceDocuments: Record<string, string> | undefined;
    try {
      const source = await ArtifactService.getSource(context, gitPort, fileSystem);
      prd = source?.prd || undefined;
      sourceDocuments = source?.sourceDocuments;
      if (hasExplicitRefs && sourceDocuments) {
        const allowedPaths = new Set([...(actionRefs || []), ...(actionCtx || [])]);
        const filtered: Record<string, string> = {};
        for (const [name, content] of Object.entries(sourceDocuments)) {
          if (allowedPaths.has(`inputs/sources/${name}`) || allowedPaths.has(name)) {
            filtered[name] = content;
          }
        }
        if (sourceDocuments['prd.md'] && !filtered['prd.md']) {
          filtered['prd.md'] = sourceDocuments['prd.md'];
        }
        if (Object.keys(filtered).length > 0) {
          sourceDocuments = filtered;
          console.log(`📋 [Design Resolve] ActionMetadata refs filter: ${Object.keys(filtered).length} source docs selected`);
        }
      }
    } catch {
      prd = undefined;
    }

    // Template check for generate mode
    if (jobMode === 'generate' && !prd) {
      const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
      const sourceDirAbs = path.join(featurePathAbs, "inputs/sources");
      const root = fileSystem.getRootPath?.() || '';
      const sourceDir = root ? path.relative(root, sourceDirAbs) : sourceDirAbs;
      const prdPath = path.join(sourceDir, 'prd.md');
      if (await fileSystem.fileExists(prdPath)) {
        const raw = await fileSystem.readFile(prdPath);
        if (raw && isTemplateContent(raw)) {
          throw new Error(
            "PRD(prd.md)가 아직 템플릿 상태입니다.\n" +
            "- prd.md 상단의 `<!-- ant:template -->` 줄을 삭제하고 내용을 채워주세요.\n" +
            "- 해당 마커가 남아있으면 시스템은 '비어있는 입력'으로 취급합니다.",
          );
        }
      }
    }

    // Load directive
    let directive: string | undefined;
    if (state.overrideDirective) {
      console.log('\n🎯 [Design Resolve] Using override directive from chat input\n');
      directive = state.overrideDirective;
    } else {
      directive = await ArtifactService.getDirective(context, 'design', gitPort, fileSystem) || undefined;
    }

    // Load previous design
    const designResult = await ArtifactService.findLatestDesign(context, gitPort, fileSystem);
    const design = designResult?.content || undefined;

    // Scan existing system design documents
    let existingDesignDocs: Record<string, string> | undefined;
    try {
      const fs = await import('fs');
      const designDirAbs = path.join(featurePath, DESIGN_DIR);
      const docs: Record<string, string> = {};
      for (const dir of [path.join(designDirAbs, DESIGN_SUBDIR.SYSTEM), designDirAbs]) {
        if (!fs.existsSync(dir)) continue;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() || docs[e.name]) continue;
          if (DESIGN_FILE_PATTERNS.some(p => p.test(e.name))) {
            const content = fs.readFileSync(path.join(dir, e.name), 'utf-8');
            if (content?.trim()) docs[e.name] = content;
          }
        }
      }
      if (Object.keys(docs).length > 0) existingDesignDocs = docs;
    } catch { /* Non-critical */ }

    // Load figma.json
    let figmaConfig: FigmaDataConfig | undefined;
    try {
      const fs = await import('fs');
      const figmaJsonPath = path.join(featurePath, 'inputs', FIGMA_FILENAME);
      if (fs.existsSync(figmaJsonPath)) {
        const figmaRaw = fs.readFileSync(figmaJsonPath, 'utf-8');
        const raw = JSON.parse(figmaRaw);
        figmaConfig = migrateFigmaConfig(raw);
        if (JSON.stringify(figmaConfig) !== JSON.stringify(raw)) {
          fs.writeFileSync(figmaJsonPath, JSON.stringify(figmaConfig, null, 2), 'utf-8');
          console.log(`📄 [Design Resolve] Migrated ${FIGMA_FILENAME} to simplified format`);
        }
      } else {
        figmaConfig = createEmptyFigmaData();
        fs.mkdirSync(path.dirname(figmaJsonPath), { recursive: true });
        fs.writeFileSync(figmaJsonPath, JSON.stringify(figmaConfig, null, 2), 'utf-8');
      }
      console.log(`📄 [Design Resolve] Loaded ${FIGMA_FILENAME}: ${figmaConfig.file ? '1 file configured' : 'no file'}`);
    } catch { /* Non-critical */ }

    // Inter-Job Context Bridge: Load & compact jobConversation
    let processedJobConversation: ConversationEntry[] = [];
    if (state.deps?.session) {
      const designSession = await state.deps.session.load(context.project, context.featureFolder || 'default', 'design');
      const rawJobConversation: ConversationEntry[] = designSession?.state?.jobConversation || [];
      processedJobConversation = rawJobConversation;

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
            threshold: DESIGN_JOB_COMPACTION_THRESHOLD,
            recentWindowSize: DESIGN_JOB_COMPACTION_WINDOW,
            maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
          });
          if (compactResult.wasCompacted) {
            processedJobConversation = applyCompactionToConversation(
              processedJobConversation,
              { summary: compactResult.summary!, summarizedCount: processedJobConversation.length - DESIGN_JOB_COMPACTION_WINDOW },
              (summary) => ({ role: 'system' as const, content: summary, timestamp: new Date().toISOString(), metadata: { chapterSummary: 'Previous jobs summary' } }),
            );
            compactionChanged = true;
          }
        } catch (err) {
          console.warn(`⚠️  [Design Resolve] Trigger 1 compaction failed, using uncompacted entries:`, err);
        }
        if (compactionChanged) {
          try {
            await state.deps.session.updateArtifacts(context.project, context.featureFolder || 'default', 'design', {
              state: { ...designSession.state, jobConversation: processedJobConversation },
            });
            console.log(`💾 [Design Resolve] Persisted compacted jobConversation (${rawJobConversation.length} → ${processedJobConversation.length} entries)`);
          } catch (err) {
            console.warn(`⚠️  [Design Resolve] Failed to persist compacted jobConversation:`, err);
          }
        }
        console.log(`📋 [Design Resolve] Inter-Job Context: ${processedJobConversation.length} entries loaded`);
      }
    }

    // Validation based on mode
    const hasAnySource = sourceDocuments && Object.keys(sourceDocuments).length > 0;
    if (jobMode === 'generate' && !prd && !hasAnySource) {
      throw new Error("Generate mode requires source documents in inputs/sources/");
    }

    // Build artifact pool from sources + existing design outputs
    const designOutputs = context.featurePath ? scanDesignOutputs(context.featurePath) : [];
    const artifacts = buildDesignArtifactPool({
      sourceDocuments,
      designOutputs,
      design,
    });
    console.log(`📄 [Design Resolve] Initial pool: ${artifacts.length} artifacts (${designOutputs.length} outputs, ${Object.keys(sourceDocuments || {}).length} sources)`);

    return {
      context,
      featurePath: context.featurePath,
      directive,
      existingDesignDocs,
      artifacts,
      figmaConfig,
      resolvedAction: state.resolvedAction,
      overrideDirective: state.overrideDirective,
      chatSource: state.chatSource,
      _httpJobId: state._httpJobId,
      jobConversation: processedJobConversation,
      sessionDigest: buildSessionDigest(processedJobConversation),
    } as Partial<DesignGraphState>;
  },
};
