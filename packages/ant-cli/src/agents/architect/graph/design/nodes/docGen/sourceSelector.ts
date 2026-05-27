/**
 * Source Document Selection for Design Job
 *
 * Design-specific orchestration: tool definitions and thresholds.
 * The generic tool-use loop lives in `agents/common/llm/callLLMWithToolLoop.ts`
 * and is shared with detect (`inferRacWithTools`).
 * Pure combining functions are in core/utils/sourceDocuments.ts (shared with code job).
 */

import type { ToolDefinition } from '../../../../../../core/ports/llm';

// Re-export combining functions from shared module for backward compatibility
export {
  buildSourceDocsForTask,
  buildAllSourceDocs,
  buildCondensedSourceDocs,
  buildSourceFileIndex,
  getSourceDocsSize,
  handleReadSourceFile,
} from '../../../../../../core/utils/sourceDocuments';

// Re-export tool-loop runner for backward compatibility — new code should
// import directly from `agents/common/llm/callLLMWithToolLoop`.
export {
  callLLMWithToolLoop,
  type ToolLoopOptions,
} from '../../../../../common/llm/callLLMWithToolLoop';

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
