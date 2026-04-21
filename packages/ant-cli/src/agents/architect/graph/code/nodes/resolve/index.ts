import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../../state";
import { ReferenceContext } from "../../../../../../core/codebase/types";
import * as path from "path";
import { hydrateFeatureContext } from "../../../../../../core/context/featureContextBuilder";
import { getExecutionTier } from "../../../../../../core/executionTier";
import type { ResolveStrategy } from '../../../../../common/graph/nodes/resolve/types';
import { validateWorkspaceAndFeature, initJobTiming } from '../../../../../common/graph/nodes/resolve/utils';
import type { ResolvedArtifact } from '@ant/shared';
import { ARTIFACT_PREFIX } from '@ant/shared';
import type { ParsedUiDocs } from '../../../../../../core/types/uiDoc';

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

    let artifacts: ResolvedArtifact[] = state.artifacts || [];
    const gitPort = state.deps?.git;
    const fileSystem = state.deps?.fileSystem;
    if (gitPort && fileSystem) {
      try {
        const designDocs = await ArtifactService.loadDesignDocuments(state.context, gitPort, fileSystem, 'unknown');
        const resumeSpecDocs = await ArtifactService.loadSpecDocuments(state.context, gitPort, fileSystem);
        const specDocs = Object.keys(resumeSpecDocs).length > 0 ? resumeSpecDocs : undefined;
        const designResult = await ArtifactService.findLatestDesign(state.context, gitPort, fileSystem);
        const design = designResult?.content || undefined;
        const source = await ArtifactService.getSource(state.context, gitPort, fileSystem);
        const prd = source?.prd || undefined;
        const sourceDocuments = source?.sourceDocuments || undefined;
        const parsedUiDocs = await ArtifactService.loadParsedUiContext(state.context, gitPort, fileSystem) || undefined;

        console.log(`📄 [Resolve/Resume] design=${!!design}, designDocs=${!!designDocs}, prd=${!!prd}, ui=${!!parsedUiDocs}`);

        artifacts = buildArtifactPool({ designDocs, specDocs, parsedUiDocs, sourceDocuments, prd, design });
        console.log(`📦 [Resolve/Resume] Artifact pool: ${artifacts.length} artifacts (${artifacts.reduce((s, a) => s + (a.content?.length || 0), 0).toLocaleString()} chars)`);
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
              const { checkLocalMCPAvailability } = await import('../../../../../../periphery/adapters/figma/MCPTransport');
              figmaUp = await checkLocalMCPAvailability();
            } else {
              const { createMCPTransport } = await import('../../../../../../periphery/adapters/figma/MCPTransport');
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

    return {
      workspaceConfig: state.workspaceConfig,
      context: state.context,
      artifacts,
      profile: state.profile,
      figmaAvailable: state.figmaAvailable,
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
            const { checkLocalMCPAvailability } = await import('../../../../../../periphery/adapters/figma/MCPTransport');
            figmaAvailable = await checkLocalMCPAvailability();
          } else {
            const { createMCPTransport } = await import('../../../../../../periphery/adapters/figma/MCPTransport');
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
    const specDocsOrUndefined = Object.keys(specDocs).length > 0 ? specDocs : undefined;

    // Build unified artifact pool
    const artifacts = buildArtifactPool({
      designDocs,
      specDocs: specDocsOrUndefined,
      parsedUiDocs: parsedUiDocs || undefined,
      sourceDocuments,
      prd,
      design,
    });
    console.log(`📦 [Resolve] Artifact pool: ${artifacts.length} artifacts (${artifacts.reduce((s, a) => s + (a.content?.length || 0), 0).toLocaleString()} chars)`);

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

    return {
      context,
      featurePath: context.featurePath,
      directive,
      artifacts,
      sessionContext,
      profile: undefined,
      referenceContexts,
      resolvedAction: state.resolvedAction,
      figmaAvailable,
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
// Helper: Build ResolvedArtifact[] pool from loaded materials
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DesignDocsShape {
  apiContracts: Record<string, string>;
  feDesigns: Record<string, string>;
  beDesigns: Record<string, string>;
}

function buildArtifactPool(opts: {
  designDocs?: DesignDocsShape;
  specDocs?: Record<string, string>;
  parsedUiDocs?: ParsedUiDocs;
  sourceDocuments?: Record<string, string>;
  prd?: string;
  design?: string;
}): ResolvedArtifact[] {
  const pool: ResolvedArtifact[] = [];

  if (opts.designDocs) {
    const { feDesigns, beDesigns, apiContracts } = opts.designDocs;
    for (const [name, content] of Object.entries(feDesigns)) {
      if (content) pool.push({ path: `${ARTIFACT_PREFIX.FE_SYSTEM}${name}.md`, content, role: 'ref' });
    }
    for (const [name, content] of Object.entries(beDesigns)) {
      if (content) pool.push({ path: `${ARTIFACT_PREFIX.BE_SYSTEM}${name}.md`, content, role: 'ref' });
    }
    for (const [name, content] of Object.entries(apiContracts)) {
      if (content) pool.push({ path: `${ARTIFACT_PREFIX.API_CONTRACT}${name}.md`, content, role: 'ref' });
    }
  }

  if (opts.specDocs) {
    for (const [name, content] of Object.entries(opts.specDocs)) {
      if (content) pool.push({ path: `${ARTIFACT_PREFIX.SPEC}${name}`, content, role: 'ref' });
    }
  }

  if (opts.parsedUiDocs) {
    if (opts.parsedUiDocs.tokens) {
      pool.push({ path: `${ARTIFACT_PREFIX.UI}tokens`, content: opts.parsedUiDocs.tokens, role: 'context' });
    }
    if (opts.parsedUiDocs.assets) {
      pool.push({ path: `${ARTIFACT_PREFIX.UI}assets`, content: opts.parsedUiDocs.assets, role: 'context' });
    }
    if (opts.parsedUiDocs.specSections) {
      for (const [id, section] of opts.parsedUiDocs.specSections) {
        if (section.content) {
          pool.push({ path: `${ARTIFACT_PREFIX.UI_SPEC}${id}`, content: section.content, role: 'context' });
        }
      }
    }
  }

  if (opts.sourceDocuments && Object.keys(opts.sourceDocuments).length > 0) {
    const combined = Object.entries(opts.sourceDocuments)
      .map(([name, content]) => `# ${name}\n\n${content}`)
      .join('\n\n────────────────────────────────────────\n\n');
    pool.push({ path: ARTIFACT_PREFIX.SOURCES, content: combined, role: 'context' });
  } else if (opts.prd) {
    pool.push({ path: ARTIFACT_PREFIX.SOURCES, content: opts.prd, role: 'context' });
  }

  const hasDesignContent = opts.designDocs && (
    Object.values(opts.designDocs.feDesigns).some(v => !!v) ||
    Object.values(opts.designDocs.beDesigns).some(v => !!v) ||
    Object.values(opts.designDocs.apiContracts).some(v => !!v)
  );
  if (opts.design && !hasDesignContent) {
    pool.push({ path: `${ARTIFACT_PREFIX.SYSTEM_DESIGN}full`, content: opts.design, role: 'ref' });
  }

  return pool;
}

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

