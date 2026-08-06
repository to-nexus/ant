/**
 * PRD-Sync Prompt Builder (design job)
 *
 * Builds LLM messages for a cross-intent PRD-sync `doc` task — the single-owner
 * task decompose appends when the design directive asks to keep a `plan/*.md`
 * doc in sync (see `decompose/prdSync.ts`). Dispatched from `execute/index.ts`
 * on `isPrdSyncTask(currentTask)`, BEFORE the intentGroup split, so a sync task
 * in any design job (spec / system / ui / game-art) gets the reframed
 * full-rewrite prompt instead of that intent's authoring prompt.
 *
 * The current on-disk content of the target doc is injected as a context block
 * so the LLM can re-emit the COMPLETE updated document via create_file.
 */

import { DesignGraphState } from '../../../state';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { MessageContentBlock } from '../../../../../../../core/ports/llm';
import { DesignTask } from '../../../../../types/task';
import type { PromptBuildConfig } from '../../../../../../../core/prompt/builder/PromptBuildConfig';
import { buildCacheableBlocks } from '../../../../../../../core/prompt/builder/CacheBlockMapper';
import { composeMessages } from '../../../../../../../core/utils/messageComposer';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';
import { deriveExecuteCompactParams } from './executeCompaction';
import { loadExistingDesignDoc } from '../../checkTaskStatus/loadExistingDesignDoc';
import { logPrompt, measurePromptChars } from '../../../../../../../core/utils/promptLogger';

export async function buildPrdSyncMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  const task = state.currentTask as DesignTask | undefined;
  const targetFile = task?.targetFile;
  const targetDir = task?.targetDir ?? 'plan';
  if (!targetFile) {
    throw new Error('[Execute/PrdSync] currentTask.targetFile is required');
  }

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Execute/PrdSync] PromptBuilder is required but not available in state.deps');
  }

  const targetPath = `${targetDir}/${targetFile}`;
  const directive = state.overrideDirective || state.directive || '';

  // Current doc content is injected so the LLM edits against the full baseline
  // (anti-clobber rejects a truncated body). Missing/unreadable → author from
  // the pool copy; the length guard no-ops when there is no prior content.
  const currentContent = await loadExistingDesignDoc(state, targetFile, targetDir);
  if (!currentContent) {
    console.warn(`⚠️  [Execute/PrdSync] Current plan doc not readable: ${targetPath} — proceeding without disk baseline`);
  }

  const runtimeLines: string[] = [];
  runtimeLines.push(`# Target Planning Document`);
  runtimeLines.push(`Write the COMPLETE updated document to: \`${targetPath}\``);
  runtimeLines.push(`Use: create_file { "path": "${targetPath}", "content": "...", "overwrite": true }`);
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

  const config: PromptBuildConfig = {
    templates: TEMPLATE_PATHS.designPrdSync,
    pipeline: {
      sanitizeInput: true,
      applyPolicyGuardrails: false,
    },
    // Content is injected via contextParts (disk baseline) below, not the pool,
    // so the full current document is guaranteed regardless of pool compaction.
    artifacts: [],
    vars: {
      userLanguage: state.context.userLanguage || 'en',
      resolvedAction: state.resolvedAction,
      runtimeContext: runtimeLines.join('\n'),
      // Codebase Channel SSOT — flow workspace state to the codebase-channel
      // partial / AutoInjectionResolver gate.
      workspaceState: state.workspaceState,
    },
  };

  const promptResult = await promptBuilder.build(config);

  const contextParts: string[] = [];
  if (currentContent) {
    contextParts.push(`# Current Planning Document (to be updated)\n\n${currentContent}`);
    console.log(`📋 [Execute/PrdSync] Loaded current plan doc: ${targetPath} (${currentContent.length} chars)`);
  }

  const blocks = buildCacheableBlocks(promptResult, {
    contextParts: contextParts.length > 0 ? contextParts : undefined,
  });

  const { messages } = composeMessages({
    initialBlocks: blocks,
    priorTurns: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE) as any,
    trailingUserMessage: 'Re-emit the COMPLETE updated planning document now via a create_file call (overwrite: true), then output <done>true</done>.',
    compactParams: deriveExecuteCompactParams(state),
  });

  const jobId = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'design',
        'execute-prd-sync',
        measurePromptChars(messages as any[]),
        {
          taskId: task?.id,
          taskName: task?.name,
          callIndex: state._executeCallIndex || 0,
          templatePath: TEMPLATE_PATHS.designPrdSync.base,
          usedTemplates: [TEMPLATE_PATHS.designPrdSync.rules!],
          injectedVariables: {
            targetPath,
            hasCurrentContent: !!currentContent,
            prdSyncTargets: task?.prdSyncTargets,
          },
        },
      );
    } catch {
      // Non-critical
    }
  }

  return messages;
}
