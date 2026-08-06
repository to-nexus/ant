/**
 * Planner Tools
 *
 * The planner's OBSERVE surface (read / list / code-search / web) is the
 * SHARED tool catalog: `TOOL_SETS.plannerObserve` advertised via
 * `getToolsByNames`, dispatched by the matrix-built plan registry
 * (`createPlanToolRegistry`). Sharing the catalog names is what makes the
 * common infrastructure apply — duplicate-read elision keys on `read_file`,
 * empty-directory clarity + glob patterns live in the shared `list_files`
 * handler, and `search_code` exists only there (frank-losing-rugby: the
 * former bespoke `read_workspace_file` / `list_workspace_files` fork was
 * excluded from all of it).
 *
 * This file keeps only the planner-BESPOKE write tools:
 * - create_file / append_file: the authoring channel (tool-call protocol)
 * - edit_file: search-replace edits with the planner's codebase write gate
 * - write_file: shadow alias for LLM hallucination recovery → create_file
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileTreeUpdatePort } from '../../../../../core/ports/fileTree';
import type { ChatStatusReporter } from '../../../../common/tool/types';
import type { ToolDefinition as LlmToolSchema } from '../../../../../core/ports/llm';
import { TOOL_SETS } from '../../../../common/tool/toolCatalog';
import { getToolsByNames } from '../../../../common/tool/toolSchemas';

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>, ctx: PlannerToolContext) => Promise<string>;
}

export interface PlannerToolContext {
  featurePath: string;
  fileTreeUpdate?: FileTreeUpdatePort;
  chatStatus: ChatStatusReporter;
}

/**
 * Codebase mutation gate for the planner's bespoke tool system.
 *
 * The planner's job is to produce / refine PRDs and plan documents
 * under `plan/`, `architecture/`, etc. — never to mutate source code
 * under `codebase/`. The architect's `code` job's `execute` phase is
 * the only legitimate writer for `codebase/`. Mirrors the architect-
 * side gate (`agents/common/tool/handlers/codebaseGate.ts`).
 */
function codebaseRejection(toolName: string, displayPath: string): string {
  return (
    `${toolName} blocked: "${displayPath}" is under codebase/, which is read-only for the planner. ` +
    `Edit plan/, architecture/, or other artifact paths instead. ` +
    `Code changes are out of scope here — describe them in the plan/PRD document.`
  );
}

function isCodebasePathArg(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return normalized === 'codebase' || normalized.startsWith('codebase/');
}

const editFile: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit a file by replacing exact text. Provide the relative path from feature root, the exact text to find (old_str), and its replacement (new_str). The old_str must match character-for-character. Use read_file first if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root (e.g., "plan/prd.md")' },
      old_str: { type: 'string', description: 'Exact text to find (must match exactly including whitespace/newlines)' },
      new_str: { type: 'string', description: 'Replacement text. Use empty string to delete.' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  execute: async (args, ctx) => {
    const filePath = path.join(ctx.featurePath, args.path);

    if (!filePath.startsWith(ctx.featurePath)) {
      return 'Error: Path traversal not allowed';
    }

    if (isCodebasePathArg(args.path)) {
      const msg = codebaseRejection('edit_file', args.path);
      await ctx.chatStatus.failFileEdit(args.path, msg);
      return msg;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { applySearchReplace } = await import('../../../../../core/streaming/strategies/common/EditOperations');
      const newContent = applySearchReplace(content, args.old_str, args.new_str, args.path);
      fs.writeFileSync(filePath, newContent, 'utf-8');

      notifyFileTree(ctx);
      await ctx.chatStatus.completeFileEdit(args.path, args.old_str, args.new_str);

      return `✅ Edited ${args.path}. Replaced ${args.old_str.length} → ${args.new_str.length} chars.`;
    } catch (error: any) {
      await ctx.chatStatus.failFileEdit(args.path, (error as Error).message);

      if (error.code === 'ENOENT') {
        return `Error: File not found: ${args.path}`;
      }
      return `Error editing file: ${error.message}\n\nTip: Use read_file to re-read the current content.`;
    }
  },
};

const createFile: ToolDefinition = {
  name: 'create_file',
  description: 'Create a NEW plan/artifact document — the standard way to author a file. Emit the path argument first, then the complete content; the content streams to the user in real time. Fails if the file already exists (use edit_file to modify). For very large documents, emit an initial create_file and continue with append_file calls.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root (e.g., "plan/prd.md"). codebase/ paths are read-only for the planner.' },
      content: { type: 'string', description: 'The complete content of the new file' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, ctx) => {
    return performPlannerWrite(args.path, args.content, { mode: 'create' }, ctx);
  },
};

const appendFile: ToolDefinition = {
  name: 'append_file',
  description: 'Append content to the END of an EXISTING document, verbatim — for continuing a large file started with create_file, or resuming one cut off by the output-token limit. Emit the path argument first. No separators are added.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root of the existing file' },
      content: { type: 'string', description: 'Content appended verbatim to the end of the file' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, ctx) => {
    return performPlannerWrite(args.path, args.content, { mode: 'append' }, ctx);
  },
};

const writeFile: ToolDefinition = {
  name: 'write_file',
  description: 'Shadow alias for LLM hallucination recovery (write_file → create_file)',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, ctx) => {
    const result = await performPlannerWrite(args.path, args.content, { mode: 'create', allowOverwrite: true }, ctx);
    return `${result}\n\n⚠️ "write_file" is not a real tool — use create_file (new files) or append_file (continuations) next time.`;
  },
};

function notifyFileTree(ctx: PlannerToolContext): void {
  if (!ctx.fileTreeUpdate) return;
  const projectId = process.env.ANT_PROJECT_ID;
  const featureName = process.env.ANT_FEATURE_NAME;
  if (projectId && featureName) {
    ctx.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
  }
}

/**
 * Shared write path for the planner's authoring tools. Direct fs (the
 * planner is single-writer — no SharedFileBuffer), codebase gate enforced,
 * terminal chat card emitted via completeFileCreation so the live shell
 * opened by ToolFileStreamer settles on the same path.
 */
async function performPlannerWrite(
  filePath: string,
  content: string,
  opts: { mode: 'create' | 'append'; allowOverwrite?: boolean },
  ctx: PlannerToolContext,
): Promise<string> {
  const toolName = opts.mode === 'append' ? 'append_file' : 'create_file';

  if (!content) {
    const msg = `Error: ${toolName} called without content.`;
    await ctx.chatStatus.failFileCreation(filePath, msg);
    return msg;
  }

  const resolvedPath = path.join(ctx.featurePath, filePath);

  if (!resolvedPath.startsWith(ctx.featurePath)) {
    return 'Error: Path traversal not allowed';
  }

  if (isCodebasePathArg(filePath)) {
    const msg = codebaseRejection(toolName, filePath);
    await ctx.chatStatus.failFileCreation(filePath, msg);
    return msg;
  }

  try {
    if (opts.mode === 'append') {
      if (!fs.existsSync(resolvedPath)) {
        const msg = `Error: append_file target "${filePath}" does not exist. Use create_file to author a new file.`;
        await ctx.chatStatus.failFileCreation(filePath, msg);
        return msg;
      }
      const existing = fs.readFileSync(resolvedPath, 'utf-8');
      fs.writeFileSync(resolvedPath, existing + content, 'utf-8');
      notifyFileTree(ctx);
      await ctx.chatStatus.completeFileCreation(filePath, content);
      return `✅ Appended ${content.length} chars to ${filePath}.`;
    }

    if (fs.existsSync(resolvedPath) && !opts.allowOverwrite) {
      const msg = `Error: "${filePath}" already exists. Use edit_file to modify it, or append_file to extend it.`;
      await ctx.chatStatus.failFileCreation(filePath, msg);
      return msg;
    }

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, content, 'utf-8');

    notifyFileTree(ctx);
    await ctx.chatStatus.completeFileCreation(filePath, content);
    return `✅ File created: ${filePath} (${content.length} chars).`;
  } catch (error: any) {
    await ctx.chatStatus.failFileCreation(filePath, error.message);
    return `Error writing file: ${error.message}`;
  }
}

/**
 * Bespoke write tools registered as registry OVERLAYS on top of the shared
 * matrix handlers (`nodes/tool.ts::getRegistry`). `edit_file` overrides the
 * shared handler to enforce the planner's codebase write gate; the shadow
 * tools exist only here.
 */
export const PLANNER_BESPOKE_TOOLS: ToolDefinition[] = [
  editFile,
  createFile,
  appendFile,
  writeFile,
];

/** Map-based dispatch for efficient tool lookup */
export const PLANNER_TOOL_MAP: ReadonlyMap<string, ToolDefinition> = new Map(
  PLANNER_BESPOKE_TOOLS.map(t => [t.name, t]),
);

/** Reshape a bespoke ToolDefinition into the LLM wire schema. */
function toWireSchema(t: ToolDefinition, opts?: { eagerInputStreaming?: boolean }): LlmToolSchema {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
    ...(opts?.eagerInputStreaming ? { eagerInputStreaming: true } : {}),
  } as LlmToolSchema;
}

/**
 * The planner's read-only observe surface (shared catalog names, wire-shaped).
 * Advertised by the plan node for ALL modes, and by execute for
 * generate/explain.
 */
export function plannerObserveTools(): LlmToolSchema[] {
  return getToolsByNames(TOOL_SETS.plannerObserve) as LlmToolSchema[];
}

/**
 * Tools advertised to the LLM by the execute node, per mode (tool-call
 * authoring protocol):
 * - `generate` authors NEW documents via `create_file` (+ `append_file` for
 *   chunked continuation / truncation resume). No `edit_file` — nothing
 *   exists to edit yet, and a failing edit wastes the authoring turn.
 * - `refactor` (rev-plan) modifies an EXISTING document via `edit_file`,
 *   with `append_file` for tail additions.
 * - `explain` is read-only.
 * SSOT for the mode split — the execute node consumes this, never re-derives it.
 */
export function plannerToolsForMode(
  planMode: 'generate' | 'refactor' | 'explain',
): LlmToolSchema[] {
  const base = plannerObserveTools();
  switch (planMode) {
    case 'generate':
      return [
        ...base,
        toWireSchema(createFile, { eagerInputStreaming: true }),
        toWireSchema(appendFile, { eagerInputStreaming: true }),
      ];
    case 'refactor':
      return [
        ...base,
        toWireSchema(editFile, { eagerInputStreaming: true }),
        toWireSchema(appendFile, { eagerInputStreaming: true }),
      ];
    default:
      return base;
  }
}
