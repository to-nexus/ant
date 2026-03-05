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

import { DesignGraphState } from '../../state';
import { CacheableContent } from '../../../../../../core/ports/llm';
import { buildSourceDocsForTask } from './sourceSelector';
import { DesignTask } from '../../../../types/task';
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

  // System prompt is ALWAYS rebuilt (prevents context loss from history pruning)
  {
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
        let specDocPath = `${state.context.featurePath}/outputs/design/${targetFile}`;
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

    const title = task?.name?.replace(/^Spec: .+ — /, 'Spec: ').replace('Spec: ', '') || 'Feature';
    const systemPrompt = await renderSpecSystemPrompt(state, {
      targetFile,
      title,
      jobMode,
      isFirstSection,
      sectionIndex,
      totalSections,
      sectionScope,
      previousSections,
      userLanguage: state.context.userLanguage || 'en',
    });

    const systemBlock: CacheableContent = {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    };

    const contextParts: string[] = [];

    const sourceDocsForTask = buildSourceDocsForTask(
      (state.currentTask as DesignTask)?.sourceFiles,
      state.sourceDocuments
    );
    
    const taskSourceFiles = (state.currentTask as DesignTask)?.sourceFiles;
    if (taskSourceFiles?.length && !sourceDocsForTask) {
      console.warn(`⚠️ [DocGen] sourceFiles assigned [${taskSourceFiles.join(', ')}] but matched 0 documents in sourceDocuments`);
    }

    if (sourceDocsForTask) {
      contextParts.push(`# Requirements Document (PRD)\n\n${sourceDocsForTask}`);
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
      for (const [filename, content] of Object.entries(state.existingDesignDocs)) {
        if (filename.startsWith('api-contract-') && filename.endsWith('.md')) {
          const name = filename.replace(/^api-contract-/, '').replace(/\.md$/, '');
          contextParts.push(`# Existing API Contract: ${name} (for reference)\n\n${content}`);
        }
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
              isFirstSection,
              sectionIndex,
              totalSections,
              sectionScope: sectionScope.slice(0, 80),
              hasExistingSpec: jobMode === 'refactor',
              hasPrd: !!state.prd,
              hasApiContract: state.existingDesignDocs ? Object.keys(state.existingDesignDocs).some(f => f.startsWith('api-contract-')) : false,
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

    // Skip initial user messages (old system prompt — replaced by fresh rebuild above)
    let skipInitialUserMessages = true;
    const filteredHistory: typeof state.conversationHistory = [];
    for (const msg of state.conversationHistory) {
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      filteredHistory.push(msg);
    }

    const tokenManager = new TokenBudgetManager();
    
    const { result: prunedHistory, wasCompacted } = compactAndPruneHistory(filteredHistory, tokenManager);

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

    // Writing deadline: inject escalating urgency based on call index
    const callIndex = state._docGenCallIndex || 0;
    const SOFT_DEADLINE = 20;
    const HARD_DEADLINE = 30;

    let deadlineMsg = '';
    if (callIndex >= HARD_DEADLINE) {
      deadlineMsg =
        `⚠️ WRITING DEADLINE: You have used ${callIndex} turns exploring. ` +
        `You MUST generate the spec document NOW using <file> or <append> tag, then output <done>true</done>. ` +
        `No more tool calls — write the document with what you have gathered so far.`;
    } else if (callIndex >= SOFT_DEADLINE) {
      deadlineMsg =
        `Note: You have spent ${callIndex} turns exploring the codebase. ` +
        `Start writing the spec document soon. Gather only what is strictly necessary, then produce the document.`;
    }

    // Anthropic API requires conversation to end with a user message.
    // If history ends with assistant (e.g., retry after no <done>), append continuation.
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      const text = deadlineMsg ? `Continue.\n\n${deadlineMsg}` : 'Continue.';
      messages.push({
        role: 'user',
        content: [{ type: 'text', text }],
      });
    } else if (deadlineMsg) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: deadlineMsg }],
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
