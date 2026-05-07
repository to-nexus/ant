/**
 * Spec Prompt Builder
 *
 * Builds LLM messages for spec document generation.
 * Supports chapter-based decomposition: each DesignTask may represent a single
 * section of the spec document. Sections are appended sequentially to the same
 * spec-{slug}.md file.
 *
 * - sectionIndex === 0 (first): uses <file> tag to create the document
 * - sectionIndex > 0: uses <append> tag, provides previous sections as context
 * - totalSections === 1 (no decomposition): identical to original behaviour
 */

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { MessageContentBlock } from '../../../../../../../core/ports/llm';
import { DesignTask } from '../../../../../types/task';
import { designDirOf, ARTIFACT_PREFIX } from '@ant/shared';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';
import type { PromptBuildConfig } from '../../../../../../../core/prompt/builder/PromptBuildConfig';
import { buildCacheableBlocks } from '../../../../../../../core/prompt/builder/CacheBlockMapper';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { selectArtifacts, selectArtifactsWithPolicy, ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';
import { buildSelfCheckTrailingMessage } from './selfCheck';

export async function buildSpecMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask;
  const targetFile = task?.targetFile;
  if (!targetFile) {
    throw new Error('[DocGen/Spec] currentTask.targetFile is required');
  }
  const directive = state.overrideDirective || state.directive || '';
  const jobMode = state.resolvedAction?.mode || 'generate';

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[DocGen/Spec] PromptBuilder is required but not available in state.deps');
  }

  // ─── Chapter decomposition fields ───────────────────────────────────────
  const sectionIndex: number = (task as any)?.sectionIndex ?? 0;
  const totalSections: number = (task as any)?.totalSections ?? 1;
  const sectionScope: string = (task as any)?.sectionScope ?? '';
  const isFirstSection = sectionIndex === 0;

  // ─── Load previous sections content if this is a continuation ───────────
  let previousSections = '';
  if (!isFirstSection && state.deps?.fileSystem && state.context.featurePath) {
    try {
      const pathModule = await import('path');
      const specOutputDir = designDirOf(targetFile);
      let specDocPath = `${state.context.featurePath}/${specOutputDir}/${targetFile}`;
      const rootPath = state.deps.fileSystem.getRootPath?.();
      if (rootPath && pathModule.isAbsolute(specDocPath)) {
        specDocPath = pathModule.relative(rootPath, specDocPath);
      }
      if (await state.deps.fileSystem.fileExists(specDocPath)) {
        previousSections = (await state.deps.fileSystem.readFile(specDocPath)) || '';
        console.log(`📋 [DocGen/Spec] Loaded existing spec for context: ${targetFile} (${previousSections.length} chars)`);
      }
    } catch (error) {
      console.warn(`⚠️  [DocGen/Spec] Could not load previous sections:`, error);
    }
  }

  const sealedPlanLen = state.planText?.trim().length ?? 0;
  console.log(
    `📋 [DocGen/Spec] Building fresh prompt for ${targetFile} (section ${sectionIndex + 1}/${totalSections}) ` +
    `· sealedPlan=${sealedPlanLen > 0 ? `${sealedPlanLen} chars (top-injected, plan-gated rules)` : 'none (fallback rules)'}`,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build runtime context — split into two vars so the sealed plan
  // (binding upstream decision) renders ABOVE rules in base.md while
  // task / directive details render at the prompt tail. The sealed
  // plan body is exposed through the existing `planText` Handlebars
  // var (mirrors code job's `state.planText` naming — see
  // `.claude/plans/plan-docgen-parallel-spring.md` and
  // `code/nodes/execute/buildMessages.ts` for the parallel pattern).
  // The template's `{{#if planText}}` gate fires on Handlebars
  // string-truthiness, so no separate "hasSealedPlan" flag is needed.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const specDir = designDirOf(targetFile);
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
    runtimeLines.push(`# Current Task`);
    runtimeLines.push(`**${task.name}**`);
    if (task.description) runtimeLines.push(task.description);
    runtimeLines.push('');
  }
  runtimeLines.push(`# User Directive`);
  runtimeLines.push(directive);
  runtimeLines.push('');

  const title = task?.name?.replace(/^Spec: .+ — /, 'Spec: ').replace('Spec: ', '') || 'Feature';

  // Artifact selection via artifactPolicy (role-aware) or include (flat)
  const currentTask = state.currentTask as DesignTask | undefined;
  const taskSourceFiles = currentTask?.sourceFiles;

  let selectedArtifacts = currentTask?.artifactPolicy
    ? selectArtifactsWithPolicy(state.artifacts || [], currentTask.artifactPolicy)
    : selectArtifacts(state.artifacts || [], { include: currentTask?.include || [ARTIFACT_PREFIX.SOURCES] });

  if (taskSourceFiles?.length) {
    const planPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
    selectedArtifacts = selectedArtifacts.filter(a =>
      !a.path.startsWith(ARTIFACT_PREFIX.SOURCES) ||
      taskSourceFiles.some(f => a.path.endsWith('/' + f) || a.path === planPrefix + f),
    );
  }

  const config: PromptBuildConfig = {
    templates: {
      base: 'jobs/design/nodes/execute/variants/spec/base',
      rules: 'jobs/design/nodes/execute/variants/spec/rules',
      system: 'jobs/design/base/system',
    },
    pipeline: {
      sanitizeInput: true,
      applyPolicyGuardrails: false,
    },
    artifacts: selectedArtifacts,
    vars: {
      targetFile,
      title,
      detectedMode: jobMode,
      isFirstSection,
      sectionIndex,
      totalSections,
      sectionScope,
      previousSections,
      userLanguage: state.context.userLanguage || 'en',
      figmaAvailable: state.figmaAvailable === true,
      figmaFileKey: state.figmaFileKey,
      figmaStartNodeId: state.figmaStartNodeId,
      resolvedAction: state.resolvedAction,
      // Plan→docGen handoff vars (see plan-docgen-parallel-spring plan):
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

  // Existing spec for refactor mode (load from disk — pool may not have latest version)
  if (jobMode === 'refactor') {
    try {
      const pathModule = await import('path');
      if (state.deps?.fileSystem && state.context.featurePath) {
        const refactorOutputDir = designDirOf(targetFile);
        let specDocPath = `${state.context.featurePath}/${refactorOutputDir}/${targetFile}`;
        const rootPath = state.deps.fileSystem.getRootPath?.();
        if (rootPath && pathModule.isAbsolute(specDocPath)) {
          specDocPath = pathModule.relative(rootPath, specDocPath);
        }
        if (await state.deps.fileSystem.fileExists(specDocPath)) {
          const existingContent = await state.deps.fileSystem.readFile(specDocPath);
          if (existingContent) {
            contextParts.push(`# Existing Spec Document (to be modified)\n\n${existingContent}`);
            console.log(`📋 [DocGen/Spec] Loaded existing spec: ${targetFile} (${existingContent.length} chars)`);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  [DocGen/Spec] Failed to load existing spec:`, error);
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
  const callIndex = state._docGenCallIndex || 0;
  // When `planText` is sealed, docGen's role is "render the decision +
  // verify a few exact paths" — exploration was already done by plan.
  // Tighten the deadlines so the LLM commits to writing within ~8
  // turns. When no plan is sealed (legacy / dispatcher fallback), keep
  // the lax 30/40 budget so the original Codebase Exploration heuristic
  // has room to run. See `.claude/plans/plan-docgen-parallel-spring.md`.
  const SOFT_DEADLINE = planText ? 8 : 30;
  const HARD_DEADLINE = planText ? 12 : 40;

  // R5 self-check trailing message: takes precedence over deadline
  // reminders because resolving a pending-done-check is the higher-
  // priority signal. See `selfCheck.ts` for the helper.
  const targetArtifactPath = `architecture/spec/${targetFile}`;
  const selfCheck = buildSelfCheckTrailingMessage(state, {
    artifactPath: targetArtifactPath,
    sectionScope,
  });

  let trailingUserMessage = 'Continue.';
  if (selfCheck) {
    trailingUserMessage = selfCheck;
  } else if (callIndex >= HARD_DEADLINE) {
    trailingUserMessage =
      `Continue.\n\n⚠️ WRITING DEADLINE: You have used ${callIndex} turns exploring. ` +
      `Write the spec document now using <file> or <append> tag, then output <done>true</done>. ` +
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
    priorTurns: getConv(state.conversations, CONV_KEYS.NODE_DOCGEN) as any,
    trailingUserMessage,
  });

  // ✅ Log prompt structure
  const TEMPLATE_PATH = 'jobs/design/nodes/execute/variants/spec/base';
  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'docGen-spec',
        blocks.reduce((sum, b) => sum + (b.type === 'text' ? b.text.length : 0), 0),
        {
          taskId: task?.id,
          taskName: task?.name,
          templatePath: TEMPLATE_PATH,
          usedTemplates: [
            'jobs/design/nodes/execute/variants/spec/rules',
          ],
          injectedVariables: {
            targetFile,
            detectedMode: jobMode,
            isFirstSection,
            sectionIndex,
            totalSections,
            sectionScope: sectionScope.slice(0, 80),
            hasExistingSpec: jobMode === 'refactor',
            hasPrd: new ArtifactPoolView(state.artifacts || []).hasSources(),
            hasApiContract: state.existingDesignDocs ? Object.keys(state.existingDesignDocs).some(f => f.startsWith('api-contract-')) : false,
            // Sealed plan injection visibility — mirrors system.ts so an
            // operator can confirm the plan→docGen handoff at a glance.
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
