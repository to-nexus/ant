/**
 * buildMessages — Execute-node message composer.
 *
 * Per-node prompt orchestration adapter that wraps the canonical
 * `core/prompt/builder/PromptBuilder`. This file does NOT implement a
 * parallel PromptBuilder; it pre-formats execute-specific inputs
 * (artifact selection, runtime context, UI images, foundation contract,
 * schema anchor), invokes `state.deps.promptBuilder.build(config)`, then
 * post-processes the result into Anthropic cache blocks and composes the
 * final messages against the conversation history.
 *
 * Supports Anthropic Prompt Caching for cost reduction:
 * - System prompts, rules, profiles (cached)
 * - Project context, design docs (cached)
 * - Current task, user directive (not cached - changes frequently)
 */

import { createHash } from "crypto";
import { ArchitectGraphState } from "../../state";
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { TokenBudgetManager } from "../../../../../../core/utils/tokenBudget";
import { formatViolations } from "../../utils/violationFormatter";
import { CacheableContent, MessageContentBlock } from "../../../../../../core/ports/llm";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { cleanFileContentFromResponse } from "../../utils/responseCleaners";
import { selectArtifacts, selectArtifactsWithPolicy, compactArtifacts, ArtifactPoolView } from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { effectiveTechTier, getTechTier, getRACDocuments, type ResolvedArtifact } from "@ant/shared";
import { deriveArtifactPolicies } from "../../../../../../core/prompt/builder/ArtifactRoleResolver";
import type { PromptBuildConfig } from "../../../../../../core/prompt/builder/PromptBuildConfig";
import { buildCacheableBlocks } from "../../../../../../core/prompt/builder/CacheBlockMapper";
import { composeMessages } from "../../../../../../core/utils/messageComposer";
import { hooksIfActive } from "../../tasks/_shared/registry";
import { loadAntrules } from "../../../../../../core/artifact/antrules";
import { normalizeToCodebasePath } from "../../../../../../core/utils/pathNormalizer";
import { resolveCodebaseRel } from "./codebaseRel";

const DEFAULT_EXECUTE_TEMPLATES = {
  base: 'jobs/code/nodes/execute/variants/default/base',
  rules: 'jobs/code/nodes/execute/variants/default/rules',
} as const;

const DEFAULT_PLAN_FRAMING = {
  label: '📋 IMPLEMENTATION PLAN (Structured JSON - FOLLOW EXACTLY)',
  description:
    'The following JSON contains the exact implementation instructions.\n' +
    '- `create`: Files to create with integration points. Import paths and observed API signatures of design-prescribed dependencies are inlined in each entry\'s `purpose`.\n' +
    '- `modify`: Files to modify with specific changes. Dependency signatures relevant to the change are inlined in `changes`.\n' +
    '- `assets`: Asset copy operations (source → destination)',
} as const;

let _lastCacheBlockHashes: { block1?: string; block2?: string; taskId?: string } = {};

/**
 * Observe `codebase/node_modules` against `codebase/package.json` so the
 * `missing-dependency-fix` injection activates whenever declared deps are
 * not yet resolvable. The same `areDepsInstalled` SSOT used by verification
 * plan entry backs this check; we do not introduce a parallel observation
 * path.
 *
 * Active task types: every code-writing type that can edit `package.json`
 * or rely on it. That set deliberately includes `verification` and `error`
 * now — the prior exclusion ("plan already carries `Session.dependencyStatus()`")
 * was wrong in practice: the plan-phase status lands in the plan template only,
 * but the actual `edit_file(package.json)` happens in execute. Without the
 * execute-side injection, the LLM got no "install required" directive right
 * next to the file-edit tool, leading to plans like "add `@types/jest` and
 * install" being honored as edit-only (observed in `lean-falling-dwarf`).
 *
 * Excluded task types:
 *   - `doc`, `explain` — do not modify code / cannot legitimately install.
 *
 * Returns `false` when `areDepsInstalled` reports `null` (non-JS project);
 * in that case the observation has nothing to say and the injection stays
 * dormant.
 */
export async function observeMissingDepsForTask(state: ArchitectGraphState): Promise<boolean> {
  const type = state.currentTask?.type;
  if (!type) return false;
  if (type === 'doc' || type === 'explain') return false;
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return false;
  try {
    const { areDepsInstalled } = await import(
      '../../../../../common/tool/handlers/invalidationScope'
    );
    const installed = await areDepsInstalled(featureRoot);
    return installed === false;
  } catch {
    return false;
  }
}

/**
 * Build retry context from enforcement history so the LLM knows what was
 * already tried and failed. Returns null when not in a retry cycle.
 */
function buildRetryContext(state: ArchitectGraphState) {
  if (!state.retries || state.retries === 0 || !state.enforcementHistory?.length) {
    return null;
  }

  const history = state.enforcementHistory;
  const previousAttempts = history.map(h => ({
    attemptNumber: h.attemptNumber,
    approach: h.violations.map(v => v.suggestedFix || v.message).join('; ').substring(0, 200),
    error: h.violations.map(v => v.message).join('; ').substring(0, 200),
    wasCloseToSuccess: false,
  }));

  const currentViolations = state.violations || [];
  return {
    attemptNumber: state.retries + 1,
    originalDirective: state.context?.task?.substring(0, 300) || '',
    originalPlan: state.planText?.substring(0, 500) || '',
    keyDecisions: [],
    currentError: formatViolations(currentViolations).substring(0, 500),
    previousAttempts,
  };
}

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 *
 * ✅ Caching Strategy:
 * 1. System prompt + rules + profiles (cached - rarely changes)
 * 2. Selected artifact pool + foundation/schema anchors (cached per task)
 * 3. Runtime context — plan JSON, Existing Codebase Files manifest,
 *    Modify Targets current content, violations, current task (not cached;
 *    changes every turn)
 *
 * File awareness (after commit cbb4d924 removed `projectCodeContext`):
 * - Path manifest: `_existingCodebaseFiles` (seeded in execute/index.ts
 *   from the same disk listing that seeds `FileRegistry.existingFiles`)
 *   is rendered as the `Existing Codebase Files` section so the LLM can
 *   distinguish new creation from modification without a `list_files`
 *   round-trip.
 * - Modify content: `implementation.modify[]` targets in `state.planText`
 *   are read from disk and rendered as `Modify Targets — Current Content`
 *   so `edit_file` calls can be constructed without a prior `read_file`.
 */
export async function buildMessages(state: ArchitectGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  
  if (state.planText) {
    console.log(`🔍 [Execute] planText: ${state.planText.length} chars`);
  }

  if (!state.currentTask) {
    throw new Error('[Execute] currentTask is required but not available in state');
  }

  // Task-specific execute hooks carry every task-type switch previously
  // inlined here (template variant, directive sanitisation, heavy-context
  // gating, runtime-context framing, empty-plan fallback, directoryTree).
  // `execHook === undefined` is the generic fallback path used by feature
  // / explain / ui / design-system tasks.
  const execHook = hooksIfActive(state)?.execute;

  if (!state.planText && !execHook && state.currentTask.priority !== 1000) {
    console.warn(`⚠️  [Execute] planText is empty (task: ${state.currentTask.type}, priority: ${state.currentTask.priority})`);
  }
  
  // Execute reads files on-demand via read_file tool. No RAG dump block —
  // plan already planned WHICH files to modify; execute fetches only those
  // through its own tool calls. See docs/architecture/14-code-job.md.
  const taskTechTiers = state.currentTask.techTiers ?? (getTechTier(state) ? [getTechTier(state)!] : []);
  const contextWithTechTier = {
    ...state.context,
    techTier: effectiveTechTier(taskTechTiers),
    techTiers: taskTechTiers,
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Artifact selection via ArtifactPipeline
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const poolView = new ArtifactPoolView(state.artifacts || []);
  const pool = poolView.all;

  const hasExplicitSelection = state.resolvedAction?.hasExplicitFields
    && ((state.resolvedAction.refs?.length ?? 0) + (state.resolvedAction.context?.length ?? 0) > 0);

  let resolvedActionWithDocs = state.resolvedAction;
  if (hasExplicitSelection) {
    const explicitPolicy = {
      refs: state.resolvedAction!.refs || [],
      context: state.resolvedAction!.context || [],
    };
    const selected = selectArtifactsWithPolicy(pool, explicitPolicy);
    if (selected.length > 0) {
      const compacted = compactArtifacts(selected, { threshold: 30_000 });
      resolvedActionWithDocs = {
        ...(state.resolvedAction!),
        artifacts: compacted,
        documents: compacted,
      };
      const totalChars = compacted.reduce((s, a) => s + (a.content?.length || 0), 0);
      console.log(`📄 [Execute] Explicit: ${pool.length} pool → ${compacted.length} selected (${totalChars.toLocaleString()} chars, refs=${JSON.stringify(explicitPolicy.refs)}, context=${JSON.stringify(explicitPolicy.context)})`);
    }
  } else {
    const task = state.currentTask;
    const selected = task.artifactPolicy
      ? selectArtifactsWithPolicy(pool, task.artifactPolicy)
      : selectArtifacts(pool, { taskType: task.type, include: task.include });
    const inferred = compactArtifacts(selected, { threshold: 30_000 });

    if (inferred.length > 0) {
      resolvedActionWithDocs = {
        ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
        artifacts: inferred,
        documents: inferred,
      };
      const totalChars = inferred.reduce((s, a) => s + (a.content?.length || 0), 0);
      console.log(`📄 [Execute] Pipeline: ${pool.length} pool → ${inferred.length} selected (${totalChars.toLocaleString()} chars, include=${JSON.stringify(task.include ?? 'default')})`);
    }
  }

  const { ARTIFACT_PREFIX: AP } = await import('@ant/shared');
  const hasUiArtifacts = getRACDocuments(resolvedActionWithDocs).some(
    a => a.path.startsWith(AP.UI),
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build prompt via PromptBuilder (4-tier injection resolution)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const taskType = state.currentTask.type;
  const skipExamples = execHook?.skipExamples ?? false;
  const skipCrossTaskContext = execHook?.skipCrossTaskContext ?? false;

  const intent = state.resolvedAction?.intent;
  const effectiveTier = effectiveTechTier(taskTechTiers);

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Execute] PromptBuilder is required but not available in state.deps');

  const { base: templateBase, rules: templateRules } =
    execHook?.templatePaths ?? DEFAULT_EXECUTE_TEMPLATES;

  const formattedLessons = formatLessonsForPrompt(state.lessons);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build runtime context → vars.runtimeContext (rendered into Block 3 via base template)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const runtimeContextParts: string[] = [];

  if (state.violations && state.violations.length > 0) {
    const violationsText = formatViolations(state.violations);
    runtimeContextParts.push(
      `──────────────────────────────────────────────────────────────\n` +
      `⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED\n` +
      `──────────────────────────────────────────────────────────────\n\n` +
      `${violationsText}\n\n` +
      `Focus on fixing the root cause, not workarounds.\n\n` +
      `──────────────────────────────────────────────────────────────`,
    );
  }

  const runtimeContext = await buildRuntimeContext(state);
  if (runtimeContext) runtimeContextParts.push(runtimeContext);

  const _basisDiag = state.resolvedAction?.basis;
  if (!_basisDiag) {
    console.warn(`⚠️  [Execute] state.resolvedAction.basis is ${_basisDiag === undefined ? 'undefined' : 'falsy'} (resolvedAction exists: ${!!state.resolvedAction}, intent: ${state.resolvedAction?.intent})`);
  } else {
    console.log(`📐 [Execute] basis present: stack=${_basisDiag.techTier?.stack || 'none'}, visualTier=${_basisDiag.visualTier ? Object.keys(_basisDiag.visualTier).join(',') : 'none'}`);
  }

  const config: PromptBuildConfig = {
    templates: {
      base: templateBase,
      rules: templateRules,
      system: 'jobs/code/base/system',
    },
    intent,
    artifactPolicies: intent
      ? deriveArtifactPolicies(intent, getRACDocuments(resolvedActionWithDocs))
      : [],
    techContext: {
      techTier: effectiveTier,
      techTiers: taskTechTiers,
      taskType,
      mode: state.resolvedAction?.mode,
      resolvedAction: resolvedActionWithDocs,
    },
    basis: state.resolvedAction?.basis,
    pipeline: {
      sanitizeInput: true,
      includeBasis: true,
      includeExamples: !skipExamples,
      applyPolicyGuardrails: true,
      formatForLLM: true,
    },
    artifacts: getRACDocuments(resolvedActionWithDocs),
    vars: {
      currentTask: state.currentTask ? {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      } : null,
      directive: execHook?.sanitizeDirective
        ? execHook.sanitizeDirective(state.directive || '')
        : (state.directive || ''),
      referenceRequests: state.referenceRequests || [],
      // Gate flag — execute branches on whether UI artifacts are
      // present in the post-RAC selected pool. Role semantics are
      // already baked into the selection (`selectArtifactsWithPolicy`
      // reassigns `role='context'` for ui/design-system tasks; explicit
      // user selections keep their authored role); the template only
      // needs presence. See `.cursorrules`
      // "Post-RAC Template Condition SSOT".
      hasUi: new ArtifactPoolView(getRACDocuments(resolvedActionWithDocs)).hasUi(),
      uiSource: new ArtifactPoolView(getRACDocuments(resolvedActionWithDocs)).uiSource(),
      isSpecDriven: new ArtifactPoolView(state.artifacts || []).activeSpecRefFilename() !== null,
      // figmaAvailable is strictly derived from uiSource === 'figma'.
      // The previous AND-with-!hasUi() gate is obsolete; hard-exclusive UiSource
      // means figma and ant/handoff never coexist in the same pool.
      figmaAvailable: state.resolvedAction?.mcpSources?.figma != null,
      figmaFileKey: state.resolvedAction?.mcpSources?.figma?.fileKey ?? state.figmaFileKey ?? undefined,
      figmaStartNodeId: state.resolvedAction?.mcpSources?.figma?.nodeId ?? state.figmaStartNodeId ?? undefined,
      runtimeContext: runtimeContextParts.join('\n\n'),

      lessons: formattedLessons,
      content: formattedLessons, // for memory.md
      sessionContext: state.sessionContext ? formatSessionContextForPrompt(state.sessionContext) : '',
      retryContext: buildRetryContext(state),
      resolvedAction: resolvedActionWithDocs || null,
      userLanguage: state.context?.userLanguage || 'en',
      filteredCatalog: undefined,
      hasRuntimeError: state.directive ? containsRuntimeErrorPattern(state.directive) : false,
      // `missing-dependency-fix` activation: a task that declares or relies
      // on deps owns the install within the same cycle. Flipped true when
      // `codebase/node_modules` does not resolve every declared dep in
      // `codebase/package.json`. Verification / error keep their SSOT via
      // `Session.dependencyStatus()`; doc / explain opt out (see
      // `observeMissingDepsForTask`).
      hasMissingDependency: await observeMissingDepsForTask(state),
      // codebase/ANTRULES.md — project-wide ant-agent settings. Loaded on
      // every execute invocation so the partial
      // `jobs/code/base/injections/ant-md` included from every execute
      // variant's base template can gate-render via `{{#if antrulesContent}}`.
      // See `docs/architecture/35-codebase-meta-policy.md`.
      antrulesContent: loadAntrules(state.context?.featurePath),
      // Task-specific vars (e.g. error's remediationMode{Upstream,Refactor}).
      // Placed last so the hook's keys override generic defaults if ever
      // required; today error is the sole publisher and it only adds keys.
      ...(execHook?.extraTemplateVars?.({
        state,
        task: state.currentTask,
      }) ?? {}),
    },
  };

  const promptResult = await promptBuilder.build(config);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Additional context parts for Block 2
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const foundationContract = skipCrossTaskContext ? null : await buildFoundationContract(state);
  const schemaAnchor = skipCrossTaskContext ? null : await buildSchemaAnchor(state);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI Images (NOT CACHED - multimodal blocks)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const uiImageBlocks: CacheableContent[] = [];
  try {
    const llmProvider = state.deps?.llm?.provider;
    const canSendImages = llmProvider === 'anthropic';

    if (hasUiArtifacts && canSendImages && state.deps?.fileSystem) {
      const uiReferenceImages = await ArtifactService.loadUiReferenceImages(state.context, state.deps.fileSystem);
      
      if (uiReferenceImages) {
        const fs = await import('fs');
        const path = await import('path');

        const rootPath = state.deps.fileSystem.getRootPath();

        const maxImages = parseInt(process.env.ANT_UI_IMAGE_MAX || '4', 10);
        const maxBytesPerImage = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${2 * 1024 * 1024}`, 10);
        const maxTotalBytes = parseInt(process.env.ANT_UI_IMAGE_TOTAL_MAX_BYTES || `${8 * 1024 * 1024}`, 10);

        const candidates: string[] = uiReferenceImages
          .filter(Boolean)
          .map(p => (typeof p === 'string' ? p.replace(/\\/g, '/') : p))
          .filter(p => !p.includes('/.gitkeep') && !p.endsWith('/.gitkeep'));

        let totalBytes = 0;

        if (candidates.length > 0) {
          const previewList = candidates.slice(0, maxImages).map(p => `- ${p}`).join('\n');
          uiImageBlocks.push({
            type: 'text',
            text:
              `# UI Reference Images\n` +
              `The following image blocks are screenshots/component states from \`inputs/references\`.\n` +
              `Use them to match layout/spacing/visual states.\n` +
              `IMPORTANT (runtime packaging, NOT authority): These image files are inputs to this prompt only — they are NOT automatically copied into the app runtime (e.g., not placed under \`public/\`). If the implementation needs runtime images/icons, either (a) generate placeholders in the codebase or (b) follow explicit instructions in \`outputs/design/ui/ant/ui-assets.json\` (including destination paths).\n\n` +
              `${previewList}\n`
          });
        }

        for (const rel of candidates) {
          if (uiImageBlocks.filter(b => (b as any).type === 'image').length >= maxImages) break;

          const abs = path.resolve(rootPath, rel);
          if (!abs.startsWith(rootPath)) continue;
          if (!fs.existsSync(abs)) continue;

          const stat = fs.statSync(abs);
          if (stat.size > maxBytesPerImage) {
            console.log(`⚠️  [UI Images] Skip (too large): ${rel} (${stat.size} bytes)`);
            continue;
          }
          if (totalBytes + stat.size > maxTotalBytes) {
            console.log(`⚠️  [UI Images] Skip (total budget exceeded): ${rel}`);
            continue;
          }

          const ext = path.extname(abs).toLowerCase();
          const mediaType =
            ext === '.png' ? 'image/png' :
            (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
            ext === '.webp' ? 'image/webp' :
            ext === '.gif' ? 'image/gif' :
            null;

          if (!mediaType) continue;

          const data = fs.readFileSync(abs).toString('base64');
          totalBytes += stat.size;

          uiImageBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as any,
              data
            }
          });
        }

        if (uiImageBlocks.some(b => (b as any).type === 'image')) {
          console.log(`🖼️  [UI Images] Injected ${uiImageBlocks.filter(b => (b as any).type === 'image').length} image(s) (total=${totalBytes} bytes)`);
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️  [UI Images] Failed to build image blocks (non-fatal):`, e);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Assemble blocks via CacheBlockMapper
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const preflightManager = new TokenBudgetManager();
  const blocks = buildCacheableBlocks(promptResult, {
    contextParts: [foundationContract, schemaAnchor].filter(Boolean) as string[],
    mediaBlocks: uiImageBlocks.length > 0 ? uiImageBlocks : undefined,
    tokenPreflight: {
      maxBlock2Tokens: preflightManager.getAreaBudgets().projectContext,
      estimateTokens: (t) => preflightManager.estimateTokens(t),
    },
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Cache stability check
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const currentTaskId = state.currentTask?.id || 'unknown';
    if (_lastCacheBlockHashes.taskId !== currentTaskId) {
      _lastCacheBlockHashes = { taskId: currentTaskId };
    }

    const block1Text = blocks[0]?.type === 'text' ? blocks[0].text : '';
    const block2Text = blocks[1]?.type === 'text' ? blocks[1].text : '';
    const b1Hash = createHash('md5').update(block1Text).digest('hex').slice(0, 12);
    const b2Hash = createHash('md5').update(block2Text).digest('hex').slice(0, 12);
    const b1Len = block1Text.length;
    const b2Len = block2Text.length;
    const histLen = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length;

    // Synchronously snapshot prev hashes before the module-level record gets
    // updated below — otherwise async logger callbacks (microtask-scheduled
    // import().then) would read the already-overwritten new hash and record
    // prevHash === currHash.
    const prevB1 = _lastCacheBlockHashes.block1;
    const prevB2 = _lastCacheBlockHashes.block2;

    if (prevB1 && prevB1 !== b1Hash) {
      console.warn(`⚠️  [CacheStability] Block1 CHANGED between calls! prev=${prevB1} curr=${b1Hash} len=${b1Len} (task=${currentTaskId}, hist=${histLen})`);
      if (state.context?.featurePath && state._httpJobId) {
        import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
          getExecutionLogger({ featurePath: state.context!.featurePath!, jobId: state._httpJobId!, jobType: 'code' })
            .logCacheInstability(currentTaskId, { block: 'block1', prevHash: prevB1, currHash: b1Hash, contentLength: b1Len, historyLength: histLen })
            .catch(() => {});
        }).catch(() => {});
      }
    }
    if (prevB2 && prevB2 !== b2Hash) {
      console.warn(`⚠️  [CacheStability] Block2 CHANGED between calls! prev=${prevB2} curr=${b2Hash} len=${b2Len} (task=${currentTaskId}, hist=${histLen})`);
      if (state.context?.featurePath && state._httpJobId) {
        import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
          getExecutionLogger({ featurePath: state.context!.featurePath!, jobId: state._httpJobId!, jobType: 'code' })
            .logCacheInstability(currentTaskId, { block: 'block2', prevHash: prevB2, currHash: b2Hash, contentLength: b2Len, historyLength: histLen })
            .catch(() => {});
        }).catch(() => {});
      }
    }

    if (histLen === 0) {
      console.log(`🔑 [CacheStability] New task → Block1=${b1Hash}(${b1Len}) Block2=${b2Hash}(${b2Len})`);
    }
    _lastCacheBlockHashes = { block1: b1Hash, block2: b2Hash, taskId: currentTaskId };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Compose messages via MessageComposer
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { messages } = composeMessages({
    initialBlocks: blocks,
    priorTurns: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE) as any,
    cleanAssistantContent: cleanFileContentFromResponse,
    budgetRecovery: {
      aggressiveParams: { microcompactHotTail: 1, autoCompactThreshold: 20000, autoCompactHotTail: 1 },
      stubBlockIndex: 1,
      stubText: '[Project context omitted to fit token budget — use read_file and search_code tools to access codebase]',
    },
  });

  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      const totalPromptLength = messages.reduce((sum: number, m: any) => {
        if (Array.isArray(m.content)) {
          return sum + m.content.reduce((s: number, c: any) => s + (c.type === 'text' ? c.text.length : 0), 0);
        }
        return sum + (typeof m.content === 'string' ? m.content.length : 0);
      }, 0);
      
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'execute-fullMessage',
        totalPromptLength,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          callIndex: state._executeCallIndex,
          templatePath: templateBase,
          usedTemplates: [
            templateBase,
            templateRules,
            ...promptResult.injections,
          ].filter(Boolean),
          resolvedPartials: collectResolvedPartials([
            templateBase,
            templateRules,
          ].filter(Boolean)),
          injectedVariables: {
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            artifactPool: pool.length,
            artifactsSelected: getRACDocuments(resolvedActionWithDocs).length,
            include: state.currentTask?.include || undefined,
            packages: state.currentTask?.packages || undefined,
            planText: state.planText ? `[${state.planText.length} chars]` : undefined,
            detectedMode: state.resolvedAction?.mode,
            taskType: state.currentTask?.type,
            uiImageBlocksCount: uiImageBlocks.filter(b => (b as any).type === 'image').length,
            hasViolations: !!(state.violations?.length),
            violationsCount: state.violations?.length || 0,
            messageCount: messages.length,
            nodeHistoryLength: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
            profileLanguage: getTechTier(state)?.language || null,
            profileFramework: getTechTier(state)?.framework || null,
            profilesLoaded: !!promptResult.sections.profiles,
            failedTemplates: promptResult.sections.failedTemplates.length > 0 ? promptResult.sections.failedTemplates : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log prompt:`, logError);
    }
  }

  return messages;
}

const MANIFEST_MAX_ENTRIES = 100;
const MODIFY_CONTENT_PER_FILE_CAP = 30_000;
const MODIFY_CONTENT_TOTAL_CAP = 80_000;

/**
 * Extract `implementation.modify[].target` paths from a plan-JSON string.
 * Tolerant of code-fence wrapping and non-JSON content (returns []).
 */
function extractPlanModifyPaths(planText: string | undefined): string[] {
  if (!planText) return [];
  const stripped = planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  try {
    const parsed = JSON.parse(stripped);
    const modify = parsed?.implementation?.modify;
    if (!Array.isArray(modify)) return [];
    const paths: string[] = [];
    for (const entry of modify) {
      const target = typeof entry === 'string' ? entry : entry?.target;
      if (typeof target === 'string' && target.length > 0) paths.push(target);
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Render the `Modify Targets — Current Content` section — reads each
 * plan.modify target from disk and lays out its current content so the
 * LLM can build exact `edit_file` calls without a prior `read_file`
 * round-trip. Caps per-file and total chars to protect the token budget.
 */
export async function buildModifyTargetsSection(state: ArchitectGraphState): Promise<string | null> {
  const paths = extractPlanModifyPaths(state.planText);
  if (paths.length === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  // Align with FileRenderer / execute/index.ts — plan targets may be written
  // as bare `src/...` paths while the workspace-rooted fileSystem needs the
  // `codebase/` prefix. Without this normalization every modify target reads
  // as "file not found", which used to emit "treat as new creation" and
  // pushed the LLM into `<file>` (overwrite) instead of `edit_file`.
  const codebaseRel = await resolveCodebaseRel(state);

  const blocks: string[] = [];
  let totalChars = 0;

  for (const p of paths) {
    if (totalChars >= MODIFY_CONTENT_TOTAL_CAP) {
      blocks.push(`\n[remaining modify targets omitted — use \`read_file\` to fetch: ${paths.slice(blocks.length).join(', ')}]`);
      break;
    }
    const { normalized } = normalizeToCodebasePath(p, codebaseRel);
    let content: string | undefined;
    try {
      content = await fileSystem.readFile(normalized) ?? undefined;
    } catch {
      content = undefined;
    }
    if (content === undefined) {
      blocks.push(
        `### ${p}\n\n` +
        `[file not found on disk at \`${normalized}\` — call \`read_file\` to verify the current location before deciding. ` +
        `If the file truly does not exist, create it with \`<file>\`. ` +
        `If it exists at a different path, call \`edit_file\` on that path — do NOT use \`<file>\` on existing files.]`
      );
      continue;
    }
    let body = content;
    if (body.length > MODIFY_CONTENT_PER_FILE_CAP) {
      body = body.slice(0, MODIFY_CONTENT_PER_FILE_CAP) + `\n... [truncated at ${MODIFY_CONTENT_PER_FILE_CAP} chars, use \`read_file\` for full content]`;
    }
    const budgetLeft = MODIFY_CONTENT_TOTAL_CAP - totalChars;
    if (body.length > budgetLeft) {
      body = body.slice(0, Math.max(0, budgetLeft)) + `\n... [truncated — total budget reached, use \`read_file\` for full content]`;
    }
    totalChars += body.length;
    blocks.push(`### ${p}\n\n\`\`\`\n${body}\n\`\`\``);
  }

  if (blocks.length === 0) return null;

  return [
    `════════════════════════════════════════════════════════════════════════════════`,
    `📝 Modify Targets — Current Content`,
    `════════════════════════════════════════════════════════════════════════════════`,
    ``,
    `The following files are listed in plan.modify. Their current on-disk content is below.`,
    `Use \`edit_file\` for partial changes. Do NOT re-emit these via \`<file>\` tag — that would overwrite.`,
    ``,
    blocks.join('\n\n'),
    ``,
    `════════════════════════════════════════════════════════════════════════════════`,
    ``,
  ].join('\n');
}

/**
 * Build runtime context (task, plan, file manifests, enforcement).
 *
 * CRITICAL: This is appended to EVERY user message, even during tool call loops!
 * This ensures task constraints (especially setup task restrictions) are always visible.
 *
 * Async because the `Modify Targets — Current Content` section reads each
 * plan.modify target from disk. Disk I/O is capped by `MODIFY_CONTENT_*`
 * budgets above so a single runtime-context build stays bounded.
 */
export async function buildRuntimeContext(state: ArchitectGraphState): Promise<string> {
  const lines: string[] = [];
  
  
  const execHook = hooksIfActive(state)?.execute;

  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);

    // Remediation-style framing (verification / error) vs generic
    // implementation framing is driven by `execute.runtimePlanFraming`
    // so the phase layer never branches on `task.type`.
    const framing = execHook?.runtimePlanFraming;
    const isRemediationTask = !!framing;

    // Safety guard: detect batched planText that leaked through processDiagnosticBatchSplit failure.
    // If the plan contains a `batches` array, it was meant to be split into sub-tasks, not executed directly.
    // Log INVARIANT VIOLATION but do NOT modify the planText — silent fallbacks mask bugs.
    if (state.planText && isRemediationTask) {
      try {
        const stripped = state.planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
        const parsed = JSON.parse(stripped);
        if (parsed.batches && Array.isArray(parsed.batches) && parsed.batches.length > 1) {
          console.error(`❌ [Execute] INVARIANT VIOLATION: Batched planText leaked to execute (${parsed.batches.length} batches). processDiagnosticBatchSplit should have split this. planRouter should have routed to checkTaskStatus. This is a system bug.`);
        }
      } catch { /* not valid JSON — proceed normally */ }
    }

    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);

      const planLabel = framing?.label ?? DEFAULT_PLAN_FRAMING.label;
      const planDescription = framing?.description ?? DEFAULT_PLAN_FRAMING.description;

      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(planLabel);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
      lines.push(planDescription);
      lines.push(``);
      lines.push('```json');
      lines.push(state.planText);
      lines.push('```');
      lines.push(``);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
    } else {
      lines.push(state.currentTask.description);
      lines.push(``);
      const fallback = execHook?.emptyPlanFallback?.(state.currentTask);
      if (fallback) {
        lines.push(fallback);
        lines.push(``);
      }
    }
  }

  // ✅ Runtime assets reminder (text-only, small)
  if (state.runtimeAssetsIndex?.count && state.runtimeAssetsIndex.count > 0) {
    const idx = state.runtimeAssetsIndex;
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📦 Available Assets (inputs/assets)`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`Check if this task needs any assets from the list below.`);
    lines.push(`If needed: SVG (.svg) → copy to codebase/src/assets/ and import as React component (SVGR).`);
    lines.push(`Raster (png, jpg, webp) → copy to codebase/public/ and use framework image component.`);
    lines.push(``);
    if (state.context?.featurePath) {
      lines.push(`Source: ${state.context.featurePath.replace(/\\/g, '/')}/inputs/assets/`);
    }
    lines.push(`SVG destination: codebase/src/assets/ (SVGR import — webpack processes source tree only)`);
    lines.push(`Raster destination: codebase/public/ (URL reference via framework image component)`);
    lines.push(``);
    lines.push(`Available files (${idx.count} total):`);
    idx.files.slice(0, 20).forEach((f) => lines.push(`  - ${f}`));
    if (idx.count > 20) lines.push(`  ... and ${idx.count - 20} more`);
    lines.push(``);
  }
  
  // Note: Violations are injected at the top of prompt, not here
  
  // ✅ Session File Manifest: Show files created by OTHER parallel workers.
  // This gives the LLM awareness of cross-worker writes without requiring read_file.
  // Own-task file writes surface naturally through conversation tool_results.
  const otherWorkerFiles = state._otherWorkerFiles;
  if (otherWorkerFiles && otherWorkerFiles.length > 0) {
    const MAX_MANIFEST_ENTRIES = 40;
    const filesToShow = otherWorkerFiles.slice(0, MAX_MANIFEST_ENTRIES);
    
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📋 Files Created by Parallel Tasks`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
    lines.push(`The following files were created by other tasks running in parallel with yours.`);
    lines.push(`Do NOT create duplicates. If you need to import from or extend these files, use \`read_file\` to check their content first.`);
    lines.push(``);
    
    // Group by task name for readability
    const byTask = new Map<string, string[]>();
    for (const f of filesToShow) {
      const taskKey = f.taskName || 'unknown';
      if (!byTask.has(taskKey)) byTask.set(taskKey, []);
      byTask.get(taskKey)!.push(f.path);
    }
    
    for (const [taskName, paths] of byTask) {
      lines.push(`**${taskName}**:`);
      for (const p of paths) {
        lines.push(`  - ${p}`);
      }
    }
    
    if (otherWorkerFiles.length > MAX_MANIFEST_ENTRIES) {
      lines.push(``);
      lines.push(`... and ${otherWorkerFiles.length - MAX_MANIFEST_ENTRIES} more files`);
    }
    lines.push(``);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
  }

  // Existing Codebase Files manifest — replaces the `projectCodeContext`
  // directory-tree / file-manifest injection removed in commit cbb4d924.
  // Paths-only (no content) so token cost stays small; content for plan
  // modify targets is surfaced by the section that follows.
  //
  // Dedupe against `_otherWorkerFiles`: when a parallel task writes to a
  // path that already exists on disk, the parallel-tasks section (above)
  // carries the richer semantics (taskName + cross-worker ownership) —
  // surfacing the same path under "Existing Codebase Files" would falsely
  // suggest it is safe to `edit_file` without cross-worker conflict.
  const otherWorkerPathSet = new Set<string>(
    (otherWorkerFiles ?? []).map(f => f.path),
  );
  const existingFiles = (state._existingCodebaseFiles ?? []).filter(
    p => !otherWorkerPathSet.has(p),
  );
  if (existingFiles.length > 0) {
    const shown = existingFiles.slice(0, MANIFEST_MAX_ENTRIES);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📋 Existing Codebase Files`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
    lines.push(`The following files ALREADY EXIST on disk at task start.`);
    lines.push(`For changes to these files: use \`edit_file\` tool (search/replace).`);
    lines.push(`Do NOT use \`<file>\` tag on any of these paths — it overwrites all content.`);
    lines.push(``);
    for (const p of shown) lines.push(`  - ${p}`);
    if (existingFiles.length > MANIFEST_MAX_ENTRIES) {
      lines.push(``);
      lines.push(`... and ${existingFiles.length - MANIFEST_MAX_ENTRIES} more files`);
    }
    lines.push(``);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
  }

  // Modify Targets — current on-disk content for every plan.modify entry.
  // Lets the LLM build precise `edit_file` calls without a `read_file`
  // round-trip. Skips silently when the plan JSON has no modify array
  // (setup / doc / explain tasks — Gate-on-presence, not task-type branch).
  const modifyTargetsSection = await buildModifyTargetsSection(state);
  if (modifyTargetsSection) {
    lines.push(modifyTargetsSection);
  }

  return lines.join('\n');
}

/**
 * Build Foundation Contract: exported symbol summary from completed foundation task files.
 * Injected into feature tasks so they discover shared utilities and avoid duplicate definitions.
 * Active only in parallel mode (SharedFileBuffer provides cross-worker file info).
 */
async function buildFoundationContract(state: ArchitectGraphState): Promise<string | null> {
  const otherWorkerFiles = state._otherWorkerFiles;
  if (!otherWorkerFiles || otherWorkerFiles.length === 0) return null;

  const completedTasks = state.completedTasksDetails || [];
  const foundationTasks = completedTasks.filter(t => t.priority >= 200 && t.priority <= 299);
  if (foundationTasks.length === 0) return null;

  const foundationTaskNames = new Set(foundationTasks.map(t => t.name));
  const foundationFiles = otherWorkerFiles.filter(
    f => f.taskName && foundationTaskNames.has(f.taskName)
  );
  if (foundationFiles.length === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  const language = getTechTier(state)?.language;

  const sections: string[] = [];
  sections.push('# Foundation Contract (read-only, do NOT modify these files)\n');
  sections.push('The following symbols were defined by the shared foundation task.');
  sections.push('Import and use them — do NOT redefine or create alternatives.\n');

  let symbolCount = 0;

  for (const file of foundationFiles) {
    try {
      const content = await fileSystem.readFile(file.path);
      if (!content) continue;

      const symbols = extractExportedSymbols(content, language);
      if (symbols.length === 0) continue;

      sections.push(`### ${file.path}`);
      for (const sym of symbols) {
        sections.push(`  - ${sym}`);
      }
      sections.push('');
      symbolCount += symbols.length;
    } catch {
      // Non-fatal: skip files that can't be read
    }
  }

  if (symbolCount === 0) return null;

  const result = sections.join('\n');
  console.log(`📋 [Execute] Foundation contract: ${foundationFiles.length} file(s), ${symbolCount} symbol(s), ${result.length} chars`);
  return result;
}

/**
 * Extract exported symbol signatures from source code.
 * Captures only top-level exported declarations (types, functions, constants).
 * For TS/JS: preserves function signatures (parameters + return type) to prevent
 * import hallucination — LLM sees exact names and signatures without read_file.
 */
function extractExportedSymbols(content: string, language?: string): string[] {
  const lines = content.split('\n');
  const symbols: string[] = [];

  if (language === 'go') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^type\s+[A-Z]/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*\{.*$/, ''));
      } else if (/^func\s+(\([^)]+\)\s+)?[A-Z]/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*\{.*$/, ''));
      } else if (/^(var|const)\s+[A-Z]/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*=.*$/, ''));
      }
    }
  } else if (language === 'typescript' || language === 'javascript') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('export ')) continue;

      // export function name(params): ReturnType { ... }
      const fnMatch = trimmed.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))\s*(?::\s*([^{]+))?\s*\{?/);
      if (fnMatch) {
        const retType = fnMatch[3]?.trim() || '';
        symbols.push(`export function ${fnMatch[1]}${fnMatch[2]}${retType ? ': ' + retType : ''}`);
        continue;
      }

      // export class/interface/type/enum/abstract
      if (/^export\s+(class|interface|type|enum|abstract)\s/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*[{=].*$/, ''));
        continue;
      }

      // export const name = (params): ReturnType => ...  (arrow function)
      const arrowMatch = trimmed.match(/^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(\([^)]*\))\s*(?::\s*([^=>{]+))?\s*=>/);
      if (arrowMatch) {
        const retType = arrowMatch[3]?.trim() || '';
        symbols.push(`export const ${arrowMatch[1]} = ${arrowMatch[2]}${retType ? ': ' + retType : ''} => ...`);
        continue;
      }

      // export const/let/var name (non-function)
      if (/^export\s+(const|let|var)\s/.test(trimmed)) {
        symbols.push(trimmed.replace(/\s*=.*$/, ''));
        continue;
      }
    }
  } else {
    return ['(symbol extraction not available — use read_file to inspect)'];
  }

  return symbols;
}

/**
 * Build Schema Anchor: concise table/type summary extracted from migration SQL files.
 * Prevents feature tasks from referencing non-existent columns or tables.
 * Active in parallel mode where SharedFileBuffer surfaces cross-worker migration writes.
 */
async function buildSchemaAnchor(state: ArchitectGraphState): Promise<string | null> {
  const otherWorkerFiles = state._otherWorkerFiles;
  if (!otherWorkerFiles || otherWorkerFiles.length === 0) return null;

  const migrationPaths = new Set<string>();
  for (const f of otherWorkerFiles) {
    if (isMigrationFile(f.path)) migrationPaths.add(f.path);
  }

  if (migrationPaths.size === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  const schemas: string[] = [];
  const sortedPaths = Array.from(migrationPaths).sort();
  for (const filePath of sortedPaths) {
    let content: string | undefined;
    try { content = await fileSystem.readFile(filePath) || undefined; } catch { /* skip */ }
    if (!content) continue;

    const tables = extractTableSchemas(content);
    schemas.push(...tables);
  }

  if (schemas.length === 0) return null;

  const sections = [
    '# Database Schema (from migrations, read-only reference)\n',
    'Use this schema when writing queries. Do NOT reference columns not listed here.\n',
    ...schemas,
  ];

  const result = sections.join('\n');
  console.log(`📋 [Execute] Schema anchor: ${migrationPaths.size} migration(s), ${schemas.length} table/type(s), ${result.length} chars`);
  return result;
}

function isMigrationFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.sql')) return false;
  return lower.includes('migration') || lower.includes('schema') || lower.includes('migrate');
}

function extractTableSchemas(sql: string): string[] {
  const results: string[] = [];

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns: string[] = [];

    for (const rawLine of body.split('\n')) {
      const trimmed = rawLine.trim().replace(/,\s*$/, '');
      if (!trimmed) continue;
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|CONSTRAINT\s)/i.test(trimmed)) continue;
      columns.push(`  ${trimmed}`);
    }

    if (columns.length > 0) {
      results.push(`**${tableName}**:\n${columns.join('\n')}\n`);
    }
  }

  const enumRegex = /CREATE\s+TYPE\s+["'`]?(\w+)["'`]?\s+AS\s+ENUM\s*\(([^)]+)\)/gi;
  while ((match = enumRegex.exec(sql)) !== null) {
    results.push(`**${match[1]}** (ENUM): ${match[2].trim()}\n`);
  }

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers for PromptBuilder vars (pre-formatting injection data)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatLessonsForPrompt(
  lessons?: Array<{ content: string; score: number; relatedFiles: string[]; tags: string[]; timestamp: string; directive?: string }>,
): string {
  if (!lessons?.length) return '';
  return lessons
    .map((l, i) => `### Lesson ${i + 1} (score: ${l.score})\n${l.content}`)
    .join('\n\n');
}

function formatSessionContextForPrompt(sessionContext?: {
  recentRuns: Array<{ runId: number; directive: string; mode: string; output: string }>;
  summary?: string;
  totalRuns: number;
  currentRun: number;
  currentMode: string;
  windowSize: number;
  compressionRatio: number;
}): string {
  if (!sessionContext || sessionContext.totalRuns === 0) return '';

  const parts: string[] = [];
  parts.push(`**Session Run ${sessionContext.currentRun}/${sessionContext.totalRuns}** (mode: ${sessionContext.currentMode})`);
  if (sessionContext.summary) {
    parts.push(`\n**Session Summary:**\n${sessionContext.summary}`);
  }
  if (sessionContext.recentRuns.length > 0) {
    parts.push('\n**Recent Runs:**');
    for (const run of sessionContext.recentRuns) {
      const truncated = run.output.length > 500 ? `${run.output.substring(0, 500)}...` : run.output;
      parts.push(`- Run ${run.runId} (${run.mode}): ${run.directive}\n  Output: ${truncated}`);
    }
  }
  return parts.join('\n');
}

function containsRuntimeErrorPattern(directive: string): boolean {
  const errorPatterns = [
    /Error:/i, /TypeError/i, /ReferenceError/i, /SyntaxError/i,
    /RangeError/i, /ELIFECYCLE/i, /npm ERR!/i,
    /\s+at\s+\S+\s+\(/i, /node_modules/i,
    /failed to/i, /cannot find/i, /undefined is not/i,
    /unexpected token/i, /module not found/i, /command failed/i,
    /compilation error/i, /\$ npm run/i, /\$ node /i,
    /Process exited with code/i, /test.*failed/i,
    /assertion.*failed/i, /expected.*but got/i,
  ];
  return errorPatterns.some(pattern => pattern.test(directive));
}
