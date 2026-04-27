import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { WorkspacePathResolver } from "../../../../../core/config/WorkspacePathResolver";
import { DesignGraphState } from "../state";
import * as path from "path";
import { isTemplateContent } from "../../../../../core/utils/templateDetector";
import { FIGMA_CONFIG_PATH, FigmaDataConfig, migrateFigmaConfig, createEmptyFigmaData, DESIGN_DIR, DESIGN_SUBDIR, extractFigmaUrlParts } from "@ant/shared";
import { hydrateFeatureContext } from "../../../../../core/context/featureContextBuilder";
import type { ResolveStrategy } from '../../../../common/graph/nodes/resolve/types';
import { validateWorkspaceAndFeature, initJobTiming } from '../../../../common/graph/nodes/resolve/utils';

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

    // Reload existingDesignDocs from disk (canonical outputs/design/system/ only; not stored in session)
    let existingDesignDocs: Record<string, string> | undefined;
    if (featurePath) {
      const fs = await import('fs');
      try {
        const systemDir = path.join(featurePath, DESIGN_DIR, DESIGN_SUBDIR.SYSTEM);
        if (fs.existsSync(systemDir)) {
          const reloaded: Record<string, string> = {};
          const entries = fs.readdirSync(systemDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory()) continue;
            if (DESIGN_FILE_PATTERNS.some(p => p.test(e.name))) {
              const content = fs.readFileSync(path.join(systemDir, e.name), 'utf-8');
              if (content?.trim()) reloaded[e.name] = content;
            }
          }
          if (Object.keys(reloaded).length > 0) {
            existingDesignDocs = reloaded;
            console.log(`📄 [Design Resolve] Reloaded existingDesignDocs: [${Object.keys(reloaded).join(', ')}]`);
          }
        }
      } catch { /* Non-critical */ }
    }

    // Pool SSOT — checkpoint persists `resolvedAction` but NOT
    // `state.artifacts`. Resume routes can bypass detect entirely
    // (`routeAfterResolve`'s task-queue and "no tasks" branches), so
    // resolve must hydrate the pool from the same single SSOT helper
    // (`loadResolvedArtifacts`) that detect uses on the non-resume path.
    // Wholesale disk scans are still forbidden — the helper only reads
    // RAC.refs ∪ RAC.context. The `existingDesignDocs` body cache above
    // stays — it is a design-job internal channel consumed by
    // `docGen/intent/system.ts` for refactor mode and is orthogonal to
    // the post-RAC pool SSOT. See `.cursorrules` "state.artifacts
    // Post-RAC SSOT".
    let resumeArtifacts: import('@ant/shared').ResolvedArtifact[] | undefined = state.resolvedArtifacts;
    if ((!resumeArtifacts || resumeArtifacts.length === 0) && state.resolvedAction && featurePath) {
      const { loadResolvedArtifacts } = await import('../../../../common/graph/loadDocumentsForRAC');
      resumeArtifacts = loadResolvedArtifacts(state.resolvedAction, featurePath);
    }
    let resumeUpdatedArtifacts = state.artifacts || [];
    if (resumeArtifacts && resumeArtifacts.length > 0) {
      const { appendOrUpdatePool } = await import('../../../../../core/prompt/builder/ArtifactPipeline');
      resumeUpdatedArtifacts = appendOrUpdatePool(resumeUpdatedArtifacts, resumeArtifacts);
    }

    // Rehydrate featureContext + turnId from feature.jsonl (§12 resume path).
    // Checkpoints do not persist turnId — without this, learn cannot attribute
    // breadcrumb/boundary writes to the correct user turn.
    //
    // §13 note: we intentionally do NOT pass `llm`/`promptPort` here. Design
    // prompt templates never render `featureContext.summary` (see
    // `core/prompt/templates/jobs/design/**` — zero references), so the LLM
    // call that Compact would fire on large user_turn accumulation produces
    // a digest nothing in this job run consumes. Code resolve keeps compact
    // because plan/direct templates inject summary; design does not.
    const { featureContext, turnId } = await hydrateFeatureContext(
      { session: state.deps?.session },
      { jobId: state.jobId, logPrefix: 'Design Resolve/Resume' },
    );

    // Resume routing in `graph.ts` skips detect, so figmaFileKey /
    // figmaStartNodeId are not re-derived on resume. Legacy checkpoints
    // produced before the detect-side fix never persisted these fields
    // (state was undefined and JSON.stringify dropped them), which made
    // every worker figma_* call fail with "Figma fileKey not configured".
    // Rehydrate from the canonical SSOT (figmaConfig.file) here —
    // idempotent for fresh checkpoints, recovery for legacy ones.
    const figmaParts = state.figmaConfig?.file
      ? extractFigmaUrlParts(state.figmaConfig.file)
      : undefined;

    return {
      existingDesignDocs,
      artifacts: resumeUpdatedArtifacts,
      resolvedArtifacts: resumeArtifacts,
      featureContext,
      turnId,
      ...(figmaParts?.fileKey && { figmaFileKey: figmaParts.fileKey }),
      ...(figmaParts?.nodeId && { figmaStartNodeId: figmaParts.nodeId }),
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

    // Lightweight PRD presence check — only used by the template-content
    // guard immediately below. The pool itself is filled by detect's
    // `loadResolvedArtifacts` (post-RAC SSOT), so we no longer keep
    // `sourceDocuments` here.
    let prd: string | undefined;
    try {
      const source = await ArtifactService.getSource(context, gitPort, fileSystem);
      prd = source?.prd || undefined;
    } catch {
      prd = undefined;
    }

    // Template check for generate mode — the plan-job canonical filename
    // is domain-aware (service → prd.md, game → gdd.md). Either file
    // sitting in template state should be surfaced to the user as the
    // same fix-the-template error.
    if (jobMode === 'generate' && !prd) {
      const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
      const sourceDirAbs = path.join(featurePathAbs, "inputs/sources");
      const root = fileSystem.getRootPath?.() || '';
      const sourceDir = root ? path.relative(root, sourceDirAbs) : sourceDirAbs;
      for (const planFilename of ['prd.md', 'gdd.md'] as const) {
        const planPath = path.join(sourceDir, planFilename);
        if (await fileSystem.fileExists(planPath)) {
          const raw = await fileSystem.readFile(planPath);
          if (raw && isTemplateContent(raw)) {
            throw new Error(
              `기획서(${planFilename})가 아직 템플릿 상태입니다.\n` +
              `- ${planFilename} 상단의 \`<!-- ant:template -->\` 줄을 삭제하고 내용을 채워주세요.\n` +
              "- 해당 마커가 남아있으면 시스템은 '비어있는 입력'으로 취급합니다.",
            );
          }
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

    // Scan existing system design documents (canonical outputs/design/system/ only)
    let existingDesignDocs: Record<string, string> | undefined;
    try {
      const fs = await import('fs');
      const systemDir = path.join(featurePath, DESIGN_DIR, DESIGN_SUBDIR.SYSTEM);
      if (fs.existsSync(systemDir)) {
        const docs: Record<string, string> = {};
        const entries = fs.readdirSync(systemDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) continue;
          if (DESIGN_FILE_PATTERNS.some(p => p.test(e.name))) {
            const content = fs.readFileSync(path.join(systemDir, e.name), 'utf-8');
            if (content?.trim()) docs[e.name] = content;
          }
        }
        if (Object.keys(docs).length > 0) existingDesignDocs = docs;
      }
    } catch { /* Non-critical */ }

    // Load figma workfile reference from canonical location
    let figmaConfig: FigmaDataConfig | undefined;
    try {
      const fs = await import('fs');
      const figmaJsonPath = path.join(featurePath, FIGMA_CONFIG_PATH);
      if (fs.existsSync(figmaJsonPath)) {
        const figmaRaw = fs.readFileSync(figmaJsonPath, 'utf-8');
        const raw = JSON.parse(figmaRaw);
        figmaConfig = migrateFigmaConfig(raw);
        if (JSON.stringify(figmaConfig) !== JSON.stringify(raw)) {
          fs.writeFileSync(figmaJsonPath, JSON.stringify(figmaConfig, null, 2), 'utf-8');
          console.log(`📄 [Design Resolve] Migrated figma.json to simplified format`);
        }
      } else {
        figmaConfig = createEmptyFigmaData();
        fs.mkdirSync(path.dirname(figmaJsonPath), { recursive: true });
        fs.writeFileSync(figmaJsonPath, JSON.stringify(figmaConfig, null, 2), 'utf-8');
      }
      console.log(`📄 [Design Resolve] Loaded figma.json: ${figmaConfig.file ? '1 file configured' : 'no file'}`);
    } catch { /* Non-critical */ }

    // SSOT — derive figmaFileKey/figmaStartNodeId from figmaConfig.file at the
    // single point where figmaConfig enters state. Detect (explicit branch in
    // common/graph/nodes/detect/index.ts) does NOT call strategy.run(), so
    // any URL parsing inside the design strategy is bypassed for explicit
    // submissions (`actionMetadata.explicit=true`). The unified figma handler
    // (`agents/common/tool/handlers/figma.ts`) reads `ctx.figmaFileKey` and
    // rejects every figma_* call with "Figma fileKey not configured" if the
    // key is missing — the regression that fired for `azure-keeping-cairn`
    // (gen-ui-figma, explicit=true) where workers fell back to `figma.json`-as-
    // text. Pairing parsing with figmaConfig load makes this the SSOT for
    // both explicit and infer new-job paths; the resume path keeps its own
    // rehydrate in `onResume` because checkpoints persist `figmaConfig` but
    // historically dropped `figmaFileKey`/`figmaStartNodeId`.
    const figmaParts = figmaConfig?.file
      ? extractFigmaUrlParts(figmaConfig.file)
      : undefined;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Feature Context + turnId (session redesign — Phase C §11/§12/§13)
    // Shared with onResume via `hydrateFeatureContext` so both paths recover
    // the same turnId from feature.jsonl (SSOT).
    //
    // §13 note: no `llm`/`promptPort` passed. Design prompts do not render
    // `featureContext.summary`, so running Compact here would fire an LLM
    // call whose output nobody reads. Compact is code-specific by design —
    // see onResume for the full rationale.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { featureContext, turnId } = await hydrateFeatureContext(
      { session: state.deps?.session },
      { jobId: state.jobId, logPrefix: 'Design Resolve' },
    );

    // Generate-mode validation: require at least PRD on disk. The pool is
    // filled by detect via `loadResolvedArtifacts(resolvedAction, ...)`,
    // so here we only check whether *some* source-document signal exists
    // for the early-fail path.
    if (jobMode === 'generate' && !prd) {
      throw new Error("Generate mode requires source documents in inputs/sources/");
    }

    return {
      context,
      featurePath: context.featurePath,
      directive,
      existingDesignDocs,
      // Pool seeded empty — detect fills it via `loadResolvedArtifacts`
      // (post-RAC SSOT). The empty array is the channel-presence
      // sentinel for detect's truthy-check.
      artifacts: [],
      figmaConfig,
      resolvedAction: state.resolvedAction,
      overrideDirective: state.overrideDirective,
      chatSource: state.chatSource,
      _httpJobId: state._httpJobId,
      featureContext,
      turnId,
      ...(figmaParts?.fileKey && { figmaFileKey: figmaParts.fileKey }),
      ...(figmaParts?.nodeId && { figmaStartNodeId: figmaParts.nodeId }),
    } as Partial<DesignGraphState>;
  },
};
