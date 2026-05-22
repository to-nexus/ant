/**
 * Sketch inspection tools for the visual direct node.
 *
 * Provides list_sketch_images and read_sketch_image tools so the LLM
 * can visually inspect sketch candidates when determining how to
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
import { detectImageMimeFromBuffer } from '../../../../../core/utils/imageMime.js';

export const VISUAL_SKETCH_TOOLS: ToolDefinition[] = [
  {
    name: 'list_sketch_images',
    description: 'List available sketch candidate images with index and file info',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_sketch_image',
    description: 'Load a specific sketch image for visual inspection. Returns the image as multimodal content.',
    input_schema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: '0-based sketch index',
        },
      },
      required: ['index'],
    },
  },
];

/**
 * Execute a sketch tool and return a properly typed ToolResultContentBlock.
 */
export function executeSketchTool(
  toolUseId: string,
  toolName: string,
  input: Record<string, any>,
  state: VisualGraphState,
): ToolResultContentBlock {
  if (toolName === 'list_sketch_images') {
    return executeListSketches(toolUseId, toolName, state);
  }
  if (toolName === 'read_sketch_image') {
    return executeReadSketch(toolUseId, toolName, input.index, state);
  }
  return buildToolResult(toolUseId, toolName, `Unknown tool: ${toolName}`, true);
}

function executeListSketches(
  toolUseId: string,
  toolName: string,
  state: VisualGraphState,
): ToolResultContentBlock {
  const paths = state.availableSketchPaths;
  if (!paths || paths.length === 0) {
    return buildToolResult(toolUseId, toolName, 'No sketch images available.');
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
    `${paths.length} sketch(es) available:\n${list.join('\n')}\n\nUse read_sketch_image with the index to visually inspect a specific sketch.`,
  );
}

function executeReadSketch(
  toolUseId: string,
  toolName: string,
  index: number,
  state: VisualGraphState,
): ToolResultContentBlock {
  const paths = state.availableSketchPaths;
  if (!paths || paths.length === 0) {
    return buildToolResult(toolUseId, toolName, 'No sketch images available.', true);
  }

  if (index < 0 || index >= paths.length) {
    return buildToolResult(
      toolUseId,
      toolName,
      `Index ${index} out of range. Valid range: 0–${paths.length - 1}`,
      true,
    );
  }

  const sketchPath = paths[index];
  const fullPath = path.isAbsolute(sketchPath)
    ? sketchPath
    : path.join(state.featurePath, sketchPath);

  try {
    if (!fs.existsSync(fullPath)) {
      return buildToolResult(toolUseId, toolName, `Sketch file not found: ${sketchPath}`, true);
    }

    const data = fs.readFileSync(fullPath);
    // Sniff magic bytes — Anthropic 400 rejects extension/content mismatch
    // (sage-orbiting-grain RCA).
    const detected = detectImageMimeFromBuffer(data);
    if (detected !== 'image/png' && detected !== 'image/jpeg' && detected !== 'image/webp') {
      return buildToolResult(
        toolUseId,
        toolName,
        `Sketch file format not supported (must be PNG/JPEG/WEBP): ${sketchPath}`,
        true,
      );
    }
    const mediaType: ImageContentBlock['source']['media_type'] = detected;

    const base64 = data.toString('base64');

    console.log(`🖼️ [SketchTools] Loaded sketch #${index}: ${path.basename(fullPath)} (${(data.length / 1024).toFixed(1)} KB)`);

    const content: CacheableContent[] = [
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      },
      {
        type: 'text',
        text: `Sketch #${index} loaded: ${path.basename(fullPath)}. Analyze its visual characteristics to inform your engineeredPrompt.`,
      },
    ];

    return buildToolResult(toolUseId, toolName, content);
  } catch (err: any) {
    return buildToolResult(toolUseId, toolName, `Failed to read sketch: ${err.message}`, true);
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
