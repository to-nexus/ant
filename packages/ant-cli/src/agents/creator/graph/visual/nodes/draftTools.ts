/**
 * Draft inspection tools for the visual direct node.
 *
 * Provides list_draft_images and read_draft_image tools so the LLM
 * can visually inspect draft candidates when determining how to
 * craft the engineeredPrompt.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ToolDefinition,
  ToolResultContentBlock,
  CacheableContent,
  ImageContentBlock,
} from '../../../../../core/ports/llm.js';
import type { VisualGraphState } from '../types.js';

export const VISUAL_DRAFT_TOOLS: ToolDefinition[] = [
  {
    name: 'list_draft_images',
    description: 'List available draft candidate images with index and file info',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_draft_image',
    description: 'Load a specific draft image for visual inspection. Returns the image as multimodal content.',
    input_schema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: '0-based draft index',
        },
      },
      required: ['index'],
    },
  },
];

/**
 * Execute a draft tool and return a properly typed ToolResultContentBlock.
 */
export function executeDraftTool(
  toolUseId: string,
  toolName: string,
  input: Record<string, any>,
  state: VisualGraphState,
): ToolResultContentBlock {
  if (toolName === 'list_draft_images') {
    return executeListDrafts(toolUseId, toolName, state);
  }
  if (toolName === 'read_draft_image') {
    return executeReadDraft(toolUseId, toolName, input.index, state);
  }
  return buildToolResult(toolUseId, toolName, `Unknown tool: ${toolName}`, true);
}

function executeListDrafts(
  toolUseId: string,
  toolName: string,
  state: VisualGraphState,
): ToolResultContentBlock {
  const paths = state.availableDraftPaths;
  if (!paths || paths.length === 0) {
    return buildToolResult(toolUseId, toolName, 'No draft images available.');
  }

  const list = paths.map((p, i) => {
    const filename = path.basename(p);
    const fullPath = path.isAbsolute(p) ? p : path.join(state.featurePath, p);
    let sizeKB = '?';
    try {
      const stat = fs.statSync(fullPath);
      sizeKB = (stat.size / 1024).toFixed(1);
    } catch { /* file may not exist */ }
    return `[${i}] ${filename} (${sizeKB} KB)`;
  });

  return buildToolResult(
    toolUseId,
    toolName,
    `${paths.length} draft(s) available:\n${list.join('\n')}\n\nUse read_draft_image with the index to visually inspect a specific draft.`,
  );
}

function executeReadDraft(
  toolUseId: string,
  toolName: string,
  index: number,
  state: VisualGraphState,
): ToolResultContentBlock {
  const paths = state.availableDraftPaths;
  if (!paths || paths.length === 0) {
    return buildToolResult(toolUseId, toolName, 'No draft images available.', true);
  }

  if (index < 0 || index >= paths.length) {
    return buildToolResult(
      toolUseId,
      toolName,
      `Index ${index} out of range. Valid range: 0–${paths.length - 1}`,
      true,
    );
  }

  const draftPath = paths[index];
  const fullPath = path.isAbsolute(draftPath)
    ? draftPath
    : path.join(state.featurePath, draftPath);

  try {
    if (!fs.existsSync(fullPath)) {
      return buildToolResult(toolUseId, toolName, `Draft file not found: ${draftPath}`, true);
    }

    const data = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mediaType: ImageContentBlock['source']['media_type'] =
      ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    const base64 = data.toString('base64');

    console.log(`🖼️ [DraftTools] Loaded draft #${index}: ${path.basename(fullPath)} (${(data.length / 1024).toFixed(1)} KB)`);

    const content: CacheableContent[] = [
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      },
      {
        type: 'text',
        text: `Draft #${index} loaded: ${path.basename(fullPath)}. Analyze its visual characteristics to inform your engineeredPrompt.`,
      },
    ];

    return buildToolResult(toolUseId, toolName, content);
  } catch (err: any) {
    return buildToolResult(toolUseId, toolName, `Failed to read draft: ${err.message}`, true);
  }
}

function buildToolResult(
  toolUseId: string,
  toolName: string,
  content: CacheableContent[] | string,
  isError?: boolean,
): ToolResultContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    tool_name: toolName,
    content,
    is_error: isError,
  };
}
