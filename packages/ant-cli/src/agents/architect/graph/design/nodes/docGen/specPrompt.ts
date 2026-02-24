/**
 * Spec Prompt Builder
 * 
 * Builds LLM messages for spec document generation.
 * Unlike system-design (chapter-based, multi-file) or ui-design (JSON, multi-doc),
 * spec produces a single spec-{slug}.md with a fixed structure.
 * 
 * Uses template files (base-spec.md + rules-spec.md) via FilePromptAdapter,
 * following the same WHAT/HOW separation as system-design and ui-design.
 */

import { DesignGraphState } from '../../state';
import { CacheableContent } from '../../../../../../core/ports/llm';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { compactAndPruneHistory } from '../../../../../../core/utils/historyManager';
import { logPrompt } from '../../../../../../core/utils/promptLogger';

const TEMPLATE_PATH = 'design/phases/execute/base-spec';

/**
 * Render the spec system prompt from template files.
 * Accesses promptPort through PromptEngine deps (same pattern as uiDesignPrompt).
 */
async function renderSpecSystemPrompt(
  state: DesignGraphState,
  vars: Record<string, any>
): Promise<string> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('[DocGen/Spec] PromptEngine is required but not available in state.deps');
  }
  
  const promptPort = (promptEngine as any).deps?.promptPort;
  if (!promptPort) {
    throw new Error('[DocGen/Spec] PromptPort is required but not available in PromptEngine.deps');
  }
  
  const rendered = await promptPort.render(TEMPLATE_PATH, vars);
  if (!rendered) {
    throw new Error(`[DocGen/Spec] Failed to render template: ${TEMPLATE_PATH}`);
  }
  
  return rendered;
}

export async function buildSpecMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: CacheableContent[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
  const task = state.currentTask;
  const targetFile = task?.targetFile || 'spec-feature.md';
  const directive = state.overrideDirective || state.directive || '';
  const jobMode = state.detectionReport?.jobMode || 'generate';

  if (!state.conversationHistory || state.conversationHistory.length === 0) {
    console.log(`📋 [DocGen/Spec] Building fresh prompt for ${targetFile}`);

    const title = task?.name?.replace('Spec: ', '') || 'Feature';
    const systemPrompt = await renderSpecSystemPrompt(state, {
      targetFile,
      title,
      jobMode,
    });

    const systemBlock: CacheableContent = {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    };

    const contextParts: string[] = [];

    if (state.prd) {
      contextParts.push(`# Requirements Document (PRD)\n\n${state.prd}`);
    }

    if (jobMode === 'refactor') {
      try {
        const pathModule = await import('path');
        if (state.deps?.fileSystem && state.context.featurePath) {
          let specDocPath = `${state.context.featurePath}/outputs/design/${targetFile}`;
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

    if (state.existingDesignDocs) {
      const apiContract = state.existingDesignDocs['api-contract.md'];
      if (apiContract) {
        contextParts.push(`# Existing API Contract (for reference)\n\n${apiContract}`);
      }
    }

    const contextBlock: CacheableContent = contextParts.length > 0
      ? { type: 'text', text: contextParts.join('\n\n---\n\n'), cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: '(No additional context documents available)' };

    const runtimeParts: string[] = [];

    runtimeParts.push(`# Target Document`);
    runtimeParts.push(`Write to: \`outputs/design/${targetFile}\``);
    runtimeParts.push(`Use: <file path="outputs/design/${targetFile}">...</file>`);
    runtimeParts.push('');

    if (task) {
      runtimeParts.push(`# Current Task`);
      runtimeParts.push(`**${task.name}**`);
      if (task.description) runtimeParts.push(task.description);
      runtimeParts.push('');
    }

    runtimeParts.push(`# User Directive`);
    runtimeParts.push(directive);
    runtimeParts.push('');

    const runtimeBlock: CacheableContent = {
      type: 'text',
      text: runtimeParts.join('\n'),
    };

    const jobId = state.jobId || state._httpJobId || 'unknown';
    if (state.context.featurePath) {
      try {
        await logPrompt(
          state.context.featurePath,
          jobId,
          'design',
          'docGen-spec',
          systemPrompt.length + contextParts.join('').length + runtimeParts.join('').length,
          {
            taskId: task?.id,
            taskName: task?.name,
            templatePath: TEMPLATE_PATH,
            usedTemplates: [
              'design/phases/execute/rules-spec',
            ],
            injectedVariables: {
              targetFile,
              jobMode,
              hasExistingSpec: jobMode === 'refactor',
              hasPrd: !!state.prd,
              hasApiContract: !!state.existingDesignDocs?.['api-contract.md'],
            },
          }
        );
      } catch {
        // Non-critical
      }
    }

    messages.push({
      role: 'user',
      content: [systemBlock, contextBlock, runtimeBlock],
    });
  }

  if (state.conversationHistory && state.conversationHistory.length > 0) {
    console.log(`📋 [DocGen/Spec] Appending conversation history (${state.conversationHistory.length} messages)`);

    const tokenManager = new TokenBudgetManager();
    
    const { result: prunedHistory, wasCompacted } = compactAndPruneHistory(state.conversationHistory, tokenManager);

    let isFirstMsg = true;
    for (const msg of prunedHistory) {
      if (typeof msg.content === 'string') {
        const shouldCache = wasCompacted && isFirstMsg && msg.role === 'assistant'
          && msg.content.startsWith('[Auto-compacted:');
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text',
            text: msg.content,
            ...(shouldCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
          }],
        });
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
      isFirstMsg = false;
    }

    // Anthropic API requires conversation to end with a user message.
    // If history ends with assistant (e.g., retry after no <done>), append continuation.
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }],
      });
    }

    const estimation = tokenManager.checkBudget(messages as any);
    if (estimation.isOverBudget) {
      throw new Error(
        `[DocGen/Spec] Token budget exceeded after compaction: ${estimation.totalTokens.toLocaleString()} tokens`
      );
    }
  } else {
    const tokenManager = new TokenBudgetManager();
    tokenManager.checkBudget(messages as any);
  }

  return messages;
}
