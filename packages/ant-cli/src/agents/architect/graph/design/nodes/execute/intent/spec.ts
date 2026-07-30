/**
 * Spec Prompt Builder
 *
 * Builds LLM messages for spec document generation.
 * Supports chapter-based decomposition: each DesignTask may represent a single
 * section of the spec document. Sections are appended sequentially to the same
 * spec file (currently `architecture/spec/{slug}.md`, no `spec-` prefix; legacy
 * workspaces may still hold `spec-{slug}.md` from before the prefix was dropped).
 *
 * - sectionIndex === 0 (first): uses <file> tag to create the document
 * - sectionIndex > 0: uses <append> tag, provides previous sections as context
 * - totalSections === 1 (no decomposition): identical to original behaviour
 */

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { MessageContentBlock } from '../../../../../../../core/ports/llm';
import { DesignTask } from '../../../../../types/task';
import { designDirOf, ARTIFACT_PREFIX, getConfigSlots, pickAssetsRoot } from '@ant/shared';
import { formatAssetInventoryBlock } from '../../../../../../../infrastructure/workspace/assetInventory';
import { logPrompt, measurePromptChars } from '../../../../../../../core/utils/promptLogger';
import type { PromptBuildConfig } from '../../../../../../../core/prompt/builder/PromptBuildConfig';
import { buildCacheableBlocks } from '../../../../../../../core/prompt/builder/CacheBlockMapper';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { selectArtifacts, ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';
import { buildSelfCheckTrailingMessage } from './selfCheck';
import { deriveExecuteCompactParams } from './executeCompaction';
import { referenceCatalogVars } from '../../../../../../common/tool/reference/catalogVars';
import { loadExistingDesignDoc } from '../../checkTaskStatus/loadExistingDesignDoc';

export async function buildSpecMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask;
  const targetFile = task?.targetFile;
  if (!targetFile) {
    throw new Error('[Execute/Spec] currentTask.targetFile is required');
  }
  const directive = state.overrideDirective || state.directive || '';
  const jobMode = state.resolvedAction?.mode || 'generate';

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Execute/Spec] PromptBuilder is required but not available in state.deps');
  }

  // ─── Chapter decomposition fields ───────────────────────────────────────
  const sectionIndex: number = (task as any)?.sectionIndex ?? 0;
  const totalSections: number = (task as any)?.totalSections ?? 1;
  const isFirstSection = sectionIndex === 0;

  // ─── Load previous sections content if this is a continuation ───────────
  let previousSections = '';
  if (!isFirstSection && state.deps?.fileSystem && state.context.featurePath) {
    try {
      const pathModule = await import('path');
      const specOutputDir = task?.targetDir ?? designDirOf(targetFile);
      let specDocPath = `${state.context.featurePath}/${specOutputDir}/${targetFile}`;
      const rootPath = state.deps.fileSystem.getRootPath?.();
      if (rootPath && pathModule.isAbsolute(specDocPath)) {
        specDocPath = pathModule.relative(rootPath, specDocPath);
      }
      if (await state.deps.fileSystem.fileExists(specDocPath)) {
        previousSections = (await state.deps.fileSystem.readFile(specDocPath)) || '';
        console.log(`📋 [Execute/Spec] Loaded existing spec for context: ${targetFile} (${previousSections.length} chars)`);
      }
    } catch (error) {
      console.warn(`⚠️  [Execute/Spec] Could not load previous sections:`, error);
    }
  }

  const sealedPlanLen = state.planText?.trim().length ?? 0;
  console.log(
    `📋 [Execute/Spec] Building fresh prompt for ${targetFile} (section ${sectionIndex + 1}/${totalSections}) ` +
    `· sealedPlan=${sealedPlanLen > 0 ? `${sealedPlanLen} chars (top-injected, plan-gated rules)` : 'none (fallback rules)'}`,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build runtime context — split into two vars so the sealed plan
  // (binding upstream decision) renders ABOVE rules in base.md while
  // task / directive details render at the prompt tail. The sealed
  // plan body is exposed through the existing `planText` Handlebars
  // var (mirrors code job's `state.planText` naming — see
  // `.claude/plans/plan-execute-parallel-spring.md` and
  // `code/nodes/execute/buildMessages.ts` for the parallel pattern).
  // The template's `{{#if planText}}` gate fires on Handlebars
  // string-truthiness, so no separate "hasSealedPlan" flag is needed.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const specDir = task?.targetDir ?? designDirOf(targetFile);
  const planText = state.planText && state.planText.trim().length > 0 ? state.planText : '';

  // runtimeContext carries Target Document / Current Task / User
  // Directive only. The sealed plan was previously prepended here;
  // it now renders separately near the top of base.md via {{#if
  // planText}}.
  const runtimeLines: string[] = [];
  runtimeLines.push(`# Target Document`);
  runtimeLines.push(`Write to: \`${specDir}/${targetFile}\``);
  runtimeLines.push(`Use: <file path="${specDir}/${targetFile}">...</file>`);
  runtimeLines.push('');
  if (task) {
    // Name only — the task's scope (description) renders exactly once, in the
    // template's CURRENT TASK SCOPE block ({{taskDescription}}). A second
    // render here would duplicate it (Task Description Authorship SSOT).
    runtimeLines.push(`# Current Task`);
    runtimeLines.push(`**${task.name}**`);
    runtimeLines.push('');
  }
  runtimeLines.push(`# User Directive`);
  runtimeLines.push(directive);
  runtimeLines.push('');

  const title = task?.name?.replace(/^Spec: .+ — /, 'Spec: ').replace('Spec: ', '') || 'Feature';

  // Single injection SSOT — `task.include` (code-derived for design tasks —
  // see specDecompose.ts, unlike the code job's LLM-authored includes),
  // SOURCES fallback.
  const currentTask = state.currentTask as DesignTask | undefined;
  const taskSourceFiles = currentTask?.sourceFiles;

  let selectedArtifacts = selectArtifacts(state.artifacts || [], {
    include: currentTask?.include?.length ? currentTask.include : [ARTIFACT_PREFIX.SOURCES],
  });

  if (taskSourceFiles?.length) {
    const planPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
    selectedArtifacts = selectedArtifacts.filter(a =>
      !a.path.startsWith(ARTIFACT_PREFIX.SOURCES) ||
      taskSourceFiles.some(f => a.path.endsWith('/' + f) || a.path === planPrefix + f),
    );
  }

  const refCat = await referenceCatalogVars(state);
  const config: PromptBuildConfig = {
    templates: TEMPLATE_PATHS.designSpec,
    pipeline: {
      sanitizeInput: true,
      applyPolicyGuardrails: false,
    },
    artifacts: selectedArtifacts,
    vars: {
      ...refCat,
      targetFile,
      title,
      detectedMode: jobMode,
      isFirstSection,
      sectionIndex,
      totalSections,
      taskDescription: task?.description ?? '',
      previousSections,
      userLanguage: state.context.userLanguage || 'en',
      // Implementation-altitude domain identifier guide (Game-Activation T2-b).
      // TS-computed partial name (no domain literal in the template →
      // Domain-Branching Locality). game → game identifiers grounded on
      // the game PRD / game system-design / game-art-spec; else → service.
      specImplGuidePartial: state.resolvedAction?.domain === 'game'
        ? 'jobs/design/nodes/execute/injections/spec-impl-guide-game'
        : 'jobs/design/nodes/execute/injections/spec-impl-guide-service',
      figmaAvailable: state.figmaAvailable === true,
      figmaFileKey: state.figmaFileKey,
      figmaStartNodeId: state.figmaStartNodeId,
      resolvedAction: state.resolvedAction,
      // Plan→execute handoff vars (see plan-execute-parallel-spring plan):
      //   - `planText` is the sealed `<plan>` JSON body (or empty
      //     string when no plan was sealed). The base.md and rules.md
      //     templates gate on `{{#if planText}}` to distinguish
      //     plan-anchored rendering from the dispatcher-only fallback.
      //     Naming mirrors code job's `state.planText` (see
      //     `code/nodes/execute/buildMessages.ts:177`).
      //   - `runtimeContext` carries Target Document / Task / Directive
      //     only (the sealed plan is no longer prepended here).
      //   - `verificationAxis` is the spec-flavoured vocabulary used by
      //     the shared `sealed-plan-rules` partial's Allowed column.
      //     System-design uses contract-flavoured vocabulary instead.
      planText,
      runtimeContext: runtimeLines.join('\n'),
      verificationAxis: 'exact import paths, function signatures, file conventions',
      // Codebase Channel SSOT — flow workspace state to the
      // codebase-channel partial / AutoInjectionResolver gate.
      workspaceState: state.workspaceState,
    },
  };

  const promptResult = await promptBuilder.build(config);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build context parts for Block 2 (disk-only data not in pool)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const contextParts: string[] = [];

  // TechTier grounding — a spec written against an existing codebase must
  // reference the real stack's conventions (routing, global prefix, entry
  // points). Rendered via `renderBasis` (the same SSOT the code plan node uses)
  // rather than build()'s techContext path, which would re-trigger
  // AutoInjectionResolver and double-render spec base.md's manual
  // action-context / document-language partials. The `gen-spec` / `rev-spec`
  // basis slot is `SYS_TIERS` (techTier active); greenfield basis (no techTier)
  // renders empty, so this is silent when there is nothing to ground.
  //
  // Spec tasks carry no per-task techTiers, so pass them through as-is
  // (undefined) and let renderBasis fall back to the full basis.techTier —
  // both slots for a fullstack codebase. Collapsing via getTechTier
  // (frontend-priority) would drop backend grounding for a fullstack spec.
  const taskTechTiers = (state.currentTask as DesignTask | undefined)?.techTiers;
  const basisSlot = state.resolvedAction?.intent
    ? getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'design',
    taskTechTiers,
    state.resolvedAction?.domain,
    basisSlot,
    // Spec is implementation-altitude — skip the policy-altitude design-job
    // domain overlay (jobs/design/domain/{d}.md). The implementation-altitude
    // identifier guide is injected in base.md instead (Game-Activation T2-b).
    { skipJobDomainOverlay: true },
  );
  if (basisSection) contextParts.push(basisSection);

  // Real asset pool inventory — the spec rules demand an Asset inventory
  // section, so the data source must be injected (mirrors ui.ts/game-art.ts;
  // spec was the one intent whose prompt never surfaced attached assets —
  // fierce-gaining-gully).
  const assetBlock = formatAssetInventoryBlock(state.assetInventory, {
    assetsRoot: pickAssetsRoot({
      workspaceDomain: (state.workspaceConfig as { domain?: any } | undefined)?.domain,
      racDomain: state.resolvedAction?.domain,
      intentGroup: state.resolvedAction?.intentGroup,
    }),
    usage:
      'Record the ones the feature uses in the spec\'s Asset inventory section with their exact `assets/...` paths (use `list_assets` for detail) — the Code Job sees only what you write down. Do NOT invent asset paths that no file backs.',
  });
  if (assetBlock) contextParts.push(assetBlock);

  // Existing spec for refactor mode (load from disk — pool may not have latest version)
  if (jobMode === 'refactor') {
    const existingContent = await loadExistingDesignDoc(state, targetFile, task?.targetDir);
    if (existingContent) {
      contextParts.push(`# Existing Spec Document (to be modified)\n\n${existingContent}`);
      console.log(`📋 [Execute/Spec] Loaded existing spec: ${targetFile} (${existingContent.length} chars)`);
    } else {
      console.warn(`⚠️  [Execute/Spec] Existing spec not readable for refactor: ${targetFile}`);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Assemble blocks via CacheBlockMapper
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const blocks = buildCacheableBlocks(promptResult, {
    contextParts: contextParts.length > 0 ? contextParts : undefined,
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Deadline message for trailing user
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const callIndex = state._executeCallIndex || 0;
  // When `planText` is sealed, execute's role is "render the decision +
  // verify a few exact paths" — exploration was already done by plan.
  // Tighten the deadlines so the LLM commits to writing within ~8
  // turns. When no plan is sealed (legacy / dispatcher fallback), keep
  // the lax 30/40 budget so the original Codebase Exploration heuristic
  // has room to run. See `.claude/plans/plan-execute-parallel-spring.md`.
  const SOFT_DEADLINE = planText ? 8 : 30;
  const HARD_DEADLINE = planText ? 12 : 40;

  // R5 self-check trailing message: takes precedence over deadline
  // reminders because resolving a pending-done-check is the higher-
  // priority signal. See `selfCheck.ts` for the helper.
  const targetArtifactPath = `architecture/spec/${targetFile}`;
  const selfCheck = buildSelfCheckTrailingMessage(state, {
    artifactPath: targetArtifactPath,
    scope: task?.description ?? '',
  });

  // Section-correct write tag: refactor-mode and first-section tasks must
  // replace via <file>; only continuation sections (sectionIndex > 0) may
  // <append>. Offering both unconditionally let refactor runs append a full
  // second document below the first (duplicate-root corruption).
  const writeTag = isFirstSection ? '<file>' : '<append>';

  let trailingUserMessage = 'Continue.';
  if (selfCheck) {
    trailingUserMessage = selfCheck;
  } else if (callIndex >= HARD_DEADLINE) {
    trailingUserMessage =
      `Continue.\n\n⚠️ WRITING DEADLINE: You have used ${callIndex} turns exploring. ` +
      `Write the spec document now using the ${writeTag} tag, then output <done>true</done>. ` +
      `No more tool calls — write the document with what you have gathered so far.`;
  } else if (callIndex >= SOFT_DEADLINE) {
    trailingUserMessage =
      `Continue.\n\nNote: You have spent ${callIndex} turns exploring the codebase. ` +
      `Start writing the spec document soon. Gather only what is strictly necessary, then produce the document.`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Compose messages via MessageComposer
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { messages } = composeMessages({
    initialBlocks: blocks,
    priorTurns: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE) as any,
    trailingUserMessage,
    // Window-keyed threshold — the 50K default evicts gathered reads mid-task
    // and refuels the no-output loop (see executeCompaction.ts).
    compactParams: deriveExecuteCompactParams(state),
  });

  // ✅ Log prompt structure
  const TEMPLATE_PATH = TEMPLATE_PATHS.designSpec.base;
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'execute-spec',
        measurePromptChars(messages as any[]),
        {
          taskId: task?.id,
          taskName: task?.name,
          callIndex,
          templatePath: TEMPLATE_PATH,
          usedTemplates: [
            TEMPLATE_PATHS.designSpec.rules!,
          ],
          injectedVariables: {
            targetFile,
            detectedMode: jobMode,
            isFirstSection,
            sectionIndex,
            totalSections,
            taskDescription: (task?.description ?? '').slice(0, 80),
            hasExistingSpec: jobMode === 'refactor',
            hasPrd: new ArtifactPoolView(state.artifacts || []).hasSources(),
            hasApiContract: state.existingDesignDocs ? Object.keys(state.existingDesignDocs).some(f => f.startsWith('api-contract-')) : false,
            // Sealed plan injection visibility — mirrors system.ts so an
            // operator can confirm the plan→execute handoff at a glance.
            // `undefined` = no sealed plan (legacy/dispatchOnly path).
            planText: state.planText && state.planText.trim().length > 0 ? `[${state.planText.length} chars]` : undefined,
          },
        }
      );
    } catch {
      // Non-critical
    }
  }

  return messages;
}
