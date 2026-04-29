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

export async function buildSpecMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask;
  const targetFile = task?.targetFile || 'spec-feature.md';
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

  console.log(`📋 [DocGen/Spec] Building fresh prompt for ${targetFile} (section ${sectionIndex + 1}/${totalSections})`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build runtime context → vars.runtimeContext
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const specDir = designDirOf(targetFile);
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
      runtimeContext: runtimeLines.join('\n'),
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
  const SOFT_DEADLINE = 20;
  const HARD_DEADLINE = 30;

  let trailingUserMessage = 'Continue.';
  if (callIndex >= HARD_DEADLINE) {
    trailingUserMessage =
      `Continue.\n\n⚠️ WRITING DEADLINE: You have used ${callIndex} turns exploring. ` +
      `You MUST generate the spec document NOW using <file> or <append> tag, then output <done>true</done>. ` +
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
          },
        }
      );
    } catch {
      // Non-critical
    }
  }

  return messages;
}
