/**
 * Spec Prompt Builder
 * 
 * Builds LLM messages for spec document generation.
 * Unlike system-design (chapter-based, multi-file) or ui-design (JSON, multi-doc),
 * spec produces a single spec-{slug}.md with a fixed structure.
 */

import { DesignGraphState } from '../../state';
import { CacheableContent } from '../../../../../../core/ports/llm';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { compactAndPruneHistory } from '../../../../../../core/utils/historyManager';
import { logPrompt } from '../../../../../../core/utils/promptLogger';

const SPEC_SYSTEM_PROMPT = `You are an expert software architect and technical writer.
Your task is to create a detailed, actionable specification document (spec doc) for a specific feature or task.

The spec doc will be consumed by a Code Job that implements the feature.
Write clearly and precisely so an LLM or developer can implement the feature without ambiguity.

## Output Format

Write the spec document as a Markdown file wrapped in XML file tags:

<file path="outputs/design/{{targetFile}}">
# Spec: {{title}}

## Overview
Brief description of the feature/change.

## Requirements
- Functional requirements (what it should do)
- Non-functional requirements (performance, security, etc.)

## Scope
- What is included in this work
- What is explicitly excluded

## Technical Approach
- Architecture changes needed
- Data model changes
- API changes (new endpoints, modified contracts)
- Dependencies on existing code/systems

## Implementation Tasks
1. Task 1: Description
2. Task 2: Description
...

## Acceptance Criteria
- Criterion 1
- Criterion 2
</file>

## Codebase Exploration Protocol

**Principle**: You have read-only tools available (read_file, list_files, search_code) to inspect the existing codebase. A spec grounded in actual code produces actionable implementation tasks. A spec written without codebase knowledge produces generic placeholders.

**Observation targets** (use tools to investigate):

| Target | What to observe |
|--------|----------------|
| **Architecture boundary** | Where does the requested feature touch existing modules? |
| **Data flow** | How does data currently move through the relevant area? |
| **Naming conventions** | What patterns do existing modules follow? |
| **Integration points** | Which existing files need modification vs new files needed? |

**Constraint**: Do NOT assume code structure. When the directive describes changes to an existing system, use search_code and read_file to verify actual structure before specifying Technical Approach and Implementation Tasks.

**Constraint**: When you need to inspect multiple files, issue ALL needed tool calls in ONE response. Do NOT discover incrementally when the context already reveals the needed set.

**Constraint**: Do NOT explore the entire codebase. Focus only on the area directly relevant to the directive.

⚠️ **Blind spot**: LLMs tend to write specs from imagination rather than observation. If the directive references existing functionality, ALWAYS verify with tools before writing the spec.

## Rules

1. Be specific and concrete. Use your tools to discover actual file paths, function names, and data structures. Reference them in the spec.
2. Break down the implementation into ordered, atomic tasks that can each be executed independently.
3. If you need more information from the user to write a complete spec, wrap your questions in a <clarify> tag:
   <clarify>
   - Question 1?
   - Question 2?
   </clarify>
   When using <clarify>, do NOT output the spec file. Only ask questions.
4. Do NOT include generic placeholder content. If a section requires codebase knowledge, use tools to gather it first. Every section must contain actionable, project-specific information.
5. The spec should be self-contained: a reader should understand the full scope without needing other documents.
`;

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

    // Resolve system prompt with target file name
    const systemPrompt = SPEC_SYSTEM_PROMPT
      .replace('{{targetFile}}', targetFile)
      .replace('{{title}}', task?.name?.replace('Spec: ', '') || 'Feature');

    const systemBlock: CacheableContent = {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    };

    // Context block: PRD, existing design docs, codebase info
    const contextParts: string[] = [];

    if (state.prd) {
      contextParts.push(`# Requirements Document (PRD)\n\n${state.prd}`);
    }

    // Load existing spec content for refactor mode
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

    // Supplementary design docs (api-contract only, for context)
    if (state.existingDesignDocs) {
      const apiContract = state.existingDesignDocs['api-contract.md'];
      if (apiContract) {
        contextParts.push(`# Existing API Contract (for reference)\n\n${apiContract}`);
      }
    }

    const contextBlock: CacheableContent = contextParts.length > 0
      ? { type: 'text', text: contextParts.join('\n\n---\n\n'), cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: '(No additional context documents available)' };

    // Runtime block: directive and task info
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

    if (jobMode === 'refactor') {
      runtimeParts.push(`# Mode: Refactor`);
      runtimeParts.push(`You are MODIFYING an existing spec document. Apply the user's requested changes while preserving the overall structure.`);
      runtimeParts.push('');
    }

    const runtimeBlock: CacheableContent = {
      type: 'text',
      text: runtimeParts.join('\n'),
    };

    // Log prompt
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

  // Append conversation history (for clarify continuation)
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    console.log(`📋 [DocGen/Spec] Appending conversation history (${state.conversationHistory.length} messages)`);

    const tokenManager = new TokenBudgetManager();
    
    // Universal 3-step compaction: microcompact → auto-compact → prune
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
