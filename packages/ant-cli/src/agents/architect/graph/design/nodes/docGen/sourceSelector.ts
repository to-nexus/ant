/**
 * Source Document Selection for Design Job
 *
 * Mirrors the code job's designSelector.ts pattern:
 *   task.packages + buildDesignDocForTask  ↔  task.sourceFiles + buildSourceDocsForTask
 *
 * - task.sourceFiles set: only listed files injected (with filename headers)
 * - task.sourceFiles NOT set: all files injected (fallback)
 *
 * Hybrid strategy for decompose phases:
 *   - Small projects (< DECOMPOSE_SOURCE_THRESHOLD): inject all inline
 *   - Large projects: inject file index + provide read_source_doc tool
 */

import type { LLMClient, ToolDefinition, LLMStreamEvent, MessageContentBlock } from '../../../../../../core/ports/llm';
import { generateFileOutline } from '../../../../../../core/utils/fileOutline';
import type { TaskTokenUsage } from '@ant/shared';

/**
 * Character threshold for switching decompose from inline injection to tool-use.
 * 200K chars at ~2.0 chars/token (Korean) = ~100K tokens → leaves ~100K for template+response.
 */
export const DECOMPOSE_SOURCE_THRESHOLD = 200_000;

/**
 * Character threshold for switching execute phase from inline injection to tool-use.
 * Same rationale: 200K chars ≈ 100K tokens (Korean), leaving headroom for templates + response.
 */
export const EXECUTE_SOURCE_THRESHOLD = 200_000;

/**
 * Cumulative character budget for tool results within one decompose session.
 * 300K chars ≈ ~150K tokens at worst-case ratio → prevents token overflow on subsequent turns.
 */
const TOOL_RESULT_BUDGET = 300_000;

export const READ_SOURCE_DOC_TOOL: ToolDefinition = {
  name: 'read_source_doc',
  description: 'Read a source document by filename. Use startLine/endLine to read BROAD ranges (300-500+ lines per call). Prefer fewer large reads over many small ones — you have a limited call budget and MUST start writing output by call 5-7.',
  input_schema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Exact filename from the source file index',
      },
      startLine: {
        type: 'number',
        description: 'Start line number (1-based, inclusive). Use broad ranges (300-500+ lines).',
      },
      endLine: {
        type: 'number',
        description: 'End line number (1-based, inclusive). Use broad ranges (300-500+ lines).',
      },
    },
    required: ['filename'],
  },
};

/**
 * Build formatted source documents string for a design task.
 *
 * @param sourceFiles - Files assigned to this task by decompose (1 or more).
 *                      undefined/empty = inject all (fallback).
 * @param sourceDocuments - All source files from inputs/sources/ (filename -> content).
 */
export function buildSourceDocsForTask(
  sourceFiles: string[] | undefined,
  sourceDocuments?: Record<string, string>
): string {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return '';

  const filesToInclude = sourceFiles && sourceFiles.length > 0
    ? sourceFiles.filter(f => sourceDocuments[f])
    : Object.keys(sourceDocuments);

  if (filesToInclude.length === 0) return '';

  const sorted = [...filesToInclude].sort((a, b) => {
    if (a === 'prd.md') return -1;
    if (b === 'prd.md') return 1;
    return a.localeCompare(b);
  });

  return sorted
    .map(f => `--- ${f} ---\n\n${sourceDocuments[f]}`)
    .join('\n\n');
}

/**
 * Build full source documents string (all files). Used by execute tasks
 * that need the complete picture for their assigned source files.
 */
export function buildAllSourceDocs(
  sourceDocuments?: Record<string, string>
): string {
  return buildSourceDocsForTask(undefined, sourceDocuments);
}

/**
 * Build budget-constrained source documents string.
 * Used by detect/decompose phases where full content may exceed the 200K token API limit.
 *
 * Strategy:
 *   1. If total content fits within budget, return all docs in full (no truncation)
 *   2. prd.md included in full (highest priority for classification)
 *   3. Two-pass redistribution: small files use only what they need,
 *      surplus budget is redistributed to larger files
 *
 * @param sourceDocuments - All source files (filename -> content)
 * @param maxChars - Character budget. Default 350K is safe for Korean-heavy content
 *                   where the actual ratio is ~2.0 chars/token (not the 3.5 used in estimates).
 *                   350K chars / 2.0 = 175K tokens → leaves ~25K tokens for template overhead.
 */
export function buildCondensedSourceDocs(
  sourceDocuments?: Record<string, string>,
  maxChars: number = 350_000
): string {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return '';

  const HEADER_OVERHEAD = 20;
  const SEPARATOR_OVERHEAD = 4;

  const allFiles = Object.keys(sourceDocuments).sort((a, b) => {
    if (a === 'prd.md') return -1;
    if (b === 'prd.md') return 1;
    return a.localeCompare(b);
  });

  const totalContentSize = allFiles.reduce((sum, f) => {
    return sum + sourceDocuments[f].length + HEADER_OVERHEAD + SEPARATOR_OVERHEAD;
  }, 0);

  if (totalContentSize <= maxChars) {
    return allFiles
      .map(f => `--- ${f} ---\n\n${sourceDocuments[f]}`)
      .join('\n\n');
  }

  const prdKey = allFiles.find(f => f === 'prd.md');
  const otherFiles = allFiles.filter(f => f !== 'prd.md');

  let usedChars = 0;
  const parts: string[] = [];

  if (prdKey) {
    const prdContent = sourceDocuments[prdKey];
    const prdBlock = `--- ${prdKey} ---\n\n${prdContent}`;
    parts.push(prdBlock);
    usedChars += prdBlock.length + SEPARATOR_OVERHEAD;
  }

  if (otherFiles.length === 0) {
    return parts.join('\n\n');
  }

  const remainingBudget = maxChars - usedChars;
  if (remainingBudget <= 0) {
    return parts.join('\n\n');
  }

  const fileSizes = otherFiles.map(f => ({
    name: f,
    content: sourceDocuments[f],
    size: sourceDocuments[f].length,
  }));

  const allocations = redistributeBudget(fileSizes, remainingBudget, HEADER_OVERHEAD + SEPARATOR_OVERHEAD);

  for (const { name, content, budget } of allocations) {
    const header = `--- ${name} ---\n\n`;
    if (content.length <= budget) {
      parts.push(header + content);
    } else {
      const truncated = content.slice(0, budget);
      const lastNewline = truncated.lastIndexOf('\n');
      const cleanCut = lastNewline > budget * 0.5 ? truncated.slice(0, lastNewline) : truncated;
      const omitted = content.length - cleanCut.length;
      parts.push(header + cleanCut + `\n\n[... truncated (${omitted.toLocaleString()} chars omitted)]`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Two-pass budget redistribution: small files take only what they need,
 * surplus flows to larger files that need more space.
 */
function redistributeBudget(
  files: { name: string; content: string; size: number }[],
  totalBudget: number,
  perFileOverhead: number
): { name: string; content: string; budget: number }[] {
  let remaining = totalBudget;
  const results: { name: string; content: string; budget: number }[] = [];
  const pending = [...files];

  while (pending.length > 0) {
    const perDocBudget = Math.floor(remaining / pending.length) - perFileOverhead;
    const nextRound: typeof pending = [];
    let roundUsed = 0;

    for (const file of pending) {
      if (file.size <= perDocBudget) {
        results.push({ name: file.name, content: file.content, budget: file.size });
        roundUsed += file.size + perFileOverhead;
      } else {
        nextRound.push(file);
      }
    }

    if (nextRound.length === pending.length) {
      for (const file of nextRound) {
        const budget = Math.floor(remaining / nextRound.length) - perFileOverhead;
        results.push({ name: file.name, content: file.content, budget: Math.max(0, budget) });
        remaining -= budget + perFileOverhead;
      }
      break;
    }

    remaining -= roundUsed;
    pending.length = 0;
    pending.push(...nextRound);
  }

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Decompose RAG: file index + on-demand tool-use
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Build a compact file index for large source document sets.
 * Contains filename, size, and a short preview — enough for LLM to decide which files to read.
 */
export function buildSourceFileIndex(
  sourceDocuments: Record<string, string>,
  previewLines: number = 8,
  options?: { includeLineNumbers?: boolean },
): string {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return '';

  const includeLineNumbers = options?.includeLineNumbers ?? false;

  const sorted = Object.keys(sourceDocuments).sort((a, b) => {
    if (a === 'prd.md') return -1;
    if (b === 'prd.md') return 1;
    return a.localeCompare(b);
  });

  const totalChars = Object.values(sourceDocuments).reduce((s, c) => s + c.length, 0);

  const lines = [
    `**${sorted.length} source documents** (${totalChars.toLocaleString()} chars total)`,
    '',
    '| # | Filename | Size | Preview |',
    '|---|----------|------|---------|',
  ];

  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i];
    const content = sourceDocuments[name];
    const totalLines = content.split('\n').length;
    const preview = content
      .split('\n')
      .filter(l => l.trim().length > 0)
      .slice(0, previewLines)
      .join(' ')
      .slice(0, 200)
      .replace(/\|/g, '\\|');
    const sizeStr = includeLineNumbers
      ? `${content.length.toLocaleString()} chars (${totalLines} lines)`
      : `${content.length.toLocaleString()} chars`;
    lines.push(`| ${i + 1} | \`${name}\` | ${sizeStr} | ${preview}... |`);

    if (includeLineNumbers) {
      const outline = generateFileOutline(content, name);
      if (outline) {
        const compactOutline = outline
          .split('\n')
          .slice(0, 30)
          .join(' / ')
          .replace(/\|/g, '\\|')
          .slice(0, 800);
        lines.push(`|   |  |  | ${compactOutline} |`);
      }
    } else {
      const headings = content
        .split('\n')
        .filter(l => /^#{1,3} /.test(l))
        .map(l => l.trim())
        .join(' / ');
      if (headings) {
        lines.push(`|   |  |  | Outline: ${headings.slice(0, 500)} |`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Compute total character size of source documents.
 */
export function getSourceDocsSize(sourceDocuments?: Record<string, string>): number {
  if (!sourceDocuments) return 0;
  return Object.values(sourceDocuments).reduce((sum, c) => sum + c.length, 0);
}

/**
 * Handle read_source_doc tool call by reading from in-memory source documents.
 * Supports optional startLine/endLine for selective reading of large documents.
 *
 * Shared by both execute-phase (tool.ts) and decompose-phase (decomposeWithToolLoop).
 */
export function handleReadSourceFile(
  filename: string,
  sourceDocuments: Record<string, string>,
  startLine?: number,
  endLine?: number,
): string {
  const content = sourceDocuments[filename];
  if (!content) {
    const available = Object.keys(sourceDocuments).join(', ');
    return `Error: File "${filename}" not found. Available: ${available}`;
  }

  const lines = content.split('\n');
  const totalLines = lines.length;

  if (startLine || endLine) {
    const start = Math.max(1, startLine || 1);
    const end = Math.min(totalLines, endLine || totalLines);
    const slice = lines.slice(start - 1, end).join('\n');
    return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
  }

  return `[Total: ${totalLines} lines]\n\n${content}`;
}

/**
 * Merge two TokenUsage objects by summing all fields.
 */
function mergeTokenUsage(
  a: TaskTokenUsage | undefined,
  b: TaskTokenUsage | undefined,
): TaskTokenUsage | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
    cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
    cacheCreationTokens: (a.cacheCreationTokens || 0) + (b.cacheCreationTokens || 0),
  };
}

export interface DecomposeToolLoopOptions {
  temperature: number;
  maxTokens: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  maxRounds?: number;
}

/**
 * Run a decompose LLM call with tool-use loop.
 *
 * The LLM can call read_source_doc (or read_design_doc) to fetch documents
 * on-demand. Loop continues until the LLM produces a final text response
 * without tool calls, or maxRounds is reached.
 *
 * @param llm - LLM client (must support stream with tools)
 * @param messages - Initial messages (system + user)
 * @param tools - Tool definitions (e.g., [READ_SOURCE_DOC_TOOL])
 * @param toolHandler - Function that executes a tool call and returns result string
 * @param options - LLM call options + loop constraints
 */
export async function decomposeWithToolLoop(
  llm: LLMClient,
  messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
  tools: ToolDefinition[],
  toolHandler: (name: string, args: Record<string, any>) => string,
  options: DecomposeToolLoopOptions,
): Promise<{ response: string; usage?: TaskTokenUsage }> {
  const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
  const maxRounds = options.maxRounds ?? 5;
  let allMessages = [...messages];
  let totalUsage: TaskTokenUsage | undefined;
  let cumulativeToolResultChars = 0;

  for (let round = 0; round < maxRounds; round++) {
    let response = '';
    let thinking = '';
    let thinkingSignature = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, any> }> = [];
    let roundUsage: TaskTokenUsage | undefined;

    for await (const event of llm.stream(allMessages, {
      tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      enableThinking: options.enableThinking,
      thinkingBudget: options.thinkingBudget,
    })) {
      if (event.type === 'retry') {
        response = '';
        thinking = '';
        thinkingSignature = '';
        toolCalls.length = 0;
        roundUsage = undefined;
        continue;
      }
      if (event.text) response += event.text;
      if (event.thinking) thinking += event.thinking;
      if (event.signature) thinkingSignature = event.signature;
      if (event.type === 'tool_use' && event.toolUse) {
        toolCalls.push({
          id: event.toolUse.id,
          name: event.toolUse.name,
          input: event.toolUse.input,
        });
      }
      const u = extractTokenUsageFromStreamEvent(event);
      if (u) roundUsage = u;
    }

    totalUsage = mergeTokenUsage(totalUsage, roundUsage);

    if (toolCalls.length === 0) {
      return { response, usage: totalUsage };
    }

    console.log(`🔧 [Decompose RAG] Round ${round + 1}: ${toolCalls.length} tool call(s)`);

    const assistantContent: any[] = [];
    if (thinking) {
      assistantContent.push({ type: 'thinking', thinking, signature: thinkingSignature });
    }
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }

    const toolResults: any[] = [];
    for (const tc of toolCalls) {
      let result = toolHandler(tc.name, tc.input);
      cumulativeToolResultChars += result.length;

      if (cumulativeToolResultChars > TOOL_RESULT_BUDGET) {
        const overBy = cumulativeToolResultChars - TOOL_RESULT_BUDGET;
        if (result.length > overBy) {
          result = result.slice(0, result.length - overBy)
            + `\n\n[... truncated — cumulative tool result budget (${TOOL_RESULT_BUDGET.toLocaleString()} chars) reached]`;
        }
        console.warn(`⚠️ [Decompose RAG] Tool result budget reached (${cumulativeToolResultChars.toLocaleString()} chars)`);
      }

      console.log(`   📄 ${tc.name}(${JSON.stringify(tc.input)}) → ${result.length.toLocaleString()} chars`);
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, tool_name: tc.name, content: result });
    }

    allMessages.push(
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    );
  }

  throw new Error(`[Decompose RAG] Exceeded maximum rounds (${maxRounds}) without final response`);
}
