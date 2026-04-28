import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../../state";
import { ReferenceContext } from "../../../../../../core/codebase/types";
import { hydrateFeatureContext } from "../../../../../../core/context/featureContextBuilder";
import { getExecutionTier } from "../../../../../../core/executionTier";
import type { ResolveStrategy } from '../../../../../common/graph/nodes/resolve/types';
import { validateWorkspaceAndFeature, initJobTiming } from '../../../../../common/graph/nodes/resolve/utils';
import { ARTIFACT_PREFIX } from '@ant/shared';

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

    // Clear conversations for NEW JOB
    state.conversations = {};

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
        const { FileConfigAdapter } = await import('../../../../../../periphery/adapters/config/FileConfigAdapter');
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

    // Pool SSOT — checkpoint persists `resolvedAction` but NOT
    // `state.artifacts`. Resume routes can bypass detect entirely
    // (`routeAfterResolve` "Plain resume" → plan / parallelOrchestrator;
    // design's "no tasks" → decompose), so resolve must hydrate the pool
    // from the same single SSOT helper (`loadResolvedArtifacts`) that
    // detect uses on the non-resume path. Wholesale disk scans are still
    // forbidden — the helper only reads RAC.refs ∪ RAC.context.
    // See `.cursorrules` "state.artifacts Post-RAC SSOT".
    let resumeArtifacts = state.resolvedArtifacts;
    if ((!resumeArtifacts || resumeArtifacts.length === 0) && state.resolvedAction && state.context.featurePath) {
      const { loadResolvedArtifacts } = await import('../../../../../common/graph/loadDocumentsForRAC');
      resumeArtifacts = loadResolvedArtifacts(state.resolvedAction, state.context.featurePath);
    }

    // Figma MCP re-detection on resume — SSOT is `detectFigmaSource`; the
    // returned metadata feeds both state scalars (for worker sharedContext)
    // and `resolvedAction.mcpSources.figma` so execute / tool nodes read
    // from one place.
    const { detectFigmaSource } = await import('./detectFigmaSource');
    const figmaDetected = await detectFigmaSource(state.context.featurePath, {
      fileSystem: state.deps?.fileSystem,
      redis: state.deps?.redis,
      userId: state.context?.userId,
    });
    state.figmaFileKey = figmaDetected.available ? figmaDetected.fileKey : undefined;
    state.figmaStartNodeId = figmaDetected.available ? figmaDetected.startNodeId : undefined;
    console.log(`🎨 [Resolve/Resume] Figma MCP: ${figmaDetected.available ? `available (fileKey=${figmaDetected.fileKey})` : 'unavailable'}`);

    // Index runtime assets
    state.runtimeAssetsIndex = await indexRuntimeAssets(state.context.featurePath);

    // Rehydrate featureContext + turnId from feature.jsonl (§12 resume path).
    // Checkpoints do not persist either — see runner.ts / checkpoint/index.ts.
    // Without this, downstream tool/direct/learn nodes silently skip trace
    // emission and breadcrumb/boundary writes because turnId is undefined.
    const { featureContext, turnId } = await hydrateFeatureContext(
      {
        session: state.deps?.session,
        llm: state.deps?.llm,
        promptPort: state.deps?.promptBuilder,
      },
      {
        jobId: state.jobId,
        logPrefix: 'Resolve/Resume',
        // Resume path — `state.executionTier` was restored from checkpoint
        // if decompose ran on a prior turn, so the tier facade can gate
        // compact properly. On fresh resume without prior tier the
        // fallback produces Tier 4 (Plan) which skips LLM compaction.
        executionTier: getExecutionTier(state),
      },
    );
    if (turnId) state.turnId = turnId;

    // Merge any in-memory pool with RAC-resolved artifacts (in-memory
    // wins on path conflict via `appendOrUpdatePool`'s upsert semantic).
    let resumeUpdatedArtifacts = state.artifacts || [];
    if (resumeArtifacts && resumeArtifacts.length > 0) {
      const { appendOrUpdatePool } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
      resumeUpdatedArtifacts = appendOrUpdatePool(resumeUpdatedArtifacts, resumeArtifacts);
    }

    return {
      workspaceConfig: state.workspaceConfig,
      context: state.context,
      artifacts: resumeUpdatedArtifacts,
      resolvedArtifacts: resumeArtifacts,
      profile: state.profile,
      figmaFileKey: state.figmaFileKey,
      figmaStartNodeId: state.figmaStartNodeId,
      runtimeAssetsIndex: state.runtimeAssetsIndex,
      featureContext,
      turnId: state.turnId,
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

    // Pool SSOT — `state.artifacts` is filled by detect via
    // `loadResolvedArtifacts` (the single writer keyed off
    // `resolvedAction.refs ∪ context`). Resolve only fetches infra
    // signals (figma MCP, runtime assets, directive, session context)
    // and a lightweight design-presence boolean used by the
    // "no design + no directive" guard below. Wholesale loading of
    // `architecture/system|spec`, `visual/ui` or `plan` here is
    // forbidden — see `.cursorrules` "state.artifacts Post-RAC SSOT".
    const designResult = await ArtifactService.findLatestDesign(context, gitPort, fileSystem);
    const design = designResult?.content || undefined;

    // Figma MCP availability — unified via `detectFigmaSource`
    const { detectFigmaSource } = await import('./detectFigmaSource');
    const figmaDetected = await detectFigmaSource(featurePath, {
      fileSystem,
      redis: state.deps?.redis,
      userId: state.context?.userId,
    });
    const figmaFileKey = figmaDetected.available ? figmaDetected.fileKey : undefined;
    const figmaStartNodeId = figmaDetected.available ? figmaDetected.startNodeId : undefined;
    const figmaFileUrl = figmaDetected.available ? figmaDetected.fileUrl : undefined;
    console.log(`🎨 [Resolve] Figma MCP: ${figmaDetected.available ? `available (fileKey=${figmaFileKey})` : 'unavailable'}`);

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
        "For modifications: Provide directive in workspace/{project}/{feature}/meta/directives/code/directive.md",
      );
    }

    // Session context for LLM
    const { SessionContextBuilder } = await import('./sessionContextDigest');
    const sessionBuilder = new SessionContextBuilder();
    const session = state.deps?.session
      ? await state.deps.session.load(context.project, context.featureFolder, 'code')
      : null;
    const sessionContext = session?.runs && session.runs.length > 0
      ? sessionBuilder.buildContextForLLM(session.runs, 'generate', directive || design || '')
      : undefined;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Feature Context + turnId (session redesign — Phase C §11/§12/§13)
    // Shared with onResume via `hydrateFeatureContext` so both paths recover
    // the same turnId and compacted context from feature.jsonl (SSOT).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { featureContext, turnId } = await hydrateFeatureContext(
      {
        session: state.deps?.session,
        llm: state.deps?.llm,
        promptPort: state.deps?.promptBuilder,
      },
      {
        jobId: state.jobId,
        logPrefix: 'Resolve',
        // Fresh-turn code path — `state.executionTier` is not yet set
        // (decompose runs after resolve) so `getExecutionTier(state)`
        // falls back to a safe tier. Intentional: compact is a safety
        // net that mostly fires on resumed/heavy sessions, which take
        // the `onResume` branch above.
        executionTier: getExecutionTier(state),
      },
    );
    if (turnId) state.turnId = turnId;

    const referenceContexts: ReferenceContext[] = [];

    // When the RAC's UI slot resolved to the figma source AND the MCP is
    // reachable, populate `resolvedAction.mcpSources.figma`. This is the SSOT
    // for downstream `tools.ts` / `buildMessages.ts` to derive figma
    // availability — no separate `state.figmaAvailable` scalar is needed.
    const resolvedActionWithMcp = (() => {
      const ra = state.resolvedAction;
      if (!ra || !figmaDetected.available || !figmaFileKey) return ra;
      const anyRacPath = [...(ra.refs ?? []), ...(ra.context ?? [])]
        .some(p => p.startsWith(ARTIFACT_PREFIX.UI_FIGMA));
      if (!anyRacPath) return ra;
      return {
        ...ra,
        mcpSources: {
          ...(ra.mcpSources ?? {}),
          figma: {
            fileUrl: figmaFileUrl ?? '',
            fileKey: figmaFileKey,
            nodeId: figmaStartNodeId,
          },
        },
      };
    })();

    return {
      context,
      featurePath: context.featurePath,
      directive,
      // Pool seeded empty — detect is the single writer that fills it
      // via `loadResolvedArtifacts` (post-RAC SSOT). The empty array is
      // the channel-presence sentinel that detect's truthy-check uses to
      // distinguish "this job owns the pool" from planner-style jobs.
      artifacts: [],
      sessionContext,
      profile: undefined,
      referenceContexts,
      resolvedAction: resolvedActionWithMcp,
      figmaFileKey,
      figmaStartNodeId,
      featureContext,
      turnId,
      runtimeAssetsIndex,
      conversations: {},
    } as Partial<ArchitectGraphState>;
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper: index runtime assets under assets/
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function indexRuntimeAssets(featurePath?: string): Promise<{ files: string[]; count: number }> {
  if (!featurePath) return { files: [], count: 0 };
  try {
    const pathMod = await import('path');
    const fsMod = await import('fs');
    const assetsRootAbs = pathMod.join(featurePath, 'assets');
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

