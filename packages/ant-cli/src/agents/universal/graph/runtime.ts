/**
 * Universal job process-local runtime — MCP connections + tool registry +
 * the sandboxed filesystem facade.
 *
 * A job-runner child runs exactly one job, so these are process singletons
 * (derived from the active custom-job definition; workspace disk is the SSOT).
 *
 * REGISTRY INSTANCE IDENTITY IS A CONTRACT — see {@link buildUniversalRegistry}.
 * The tool node resolves `getUniversalRegistry()` at module-load time and the
 * orchestrator captures that reference for the process lifetime, so the object
 * this module hands out must never be replaced, only populated.
 */

import type { FileSystemPort } from '../../../core/ports/filesystem';
import { McpConnectionManager, type McpToolInfo } from '../../../core/customAgents/McpConnectionManager';
import { DEFINITION_MOUNT_PREFIX } from '../../../core/customAgents/promptBlock';
import { XMLStreamParser } from '../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../core/streaming/strategies/CommonRenderStrategy';
import { StreamOrchestrator } from '../../../core/streaming/StreamOrchestrator';
import type { ChatAPIClient } from '../../../core/adapters/ChatAPIClient';
import { ToolRegistry } from '../../common/tool/registry';
import { createUniversalToolRegistry } from '../../common/tool/presets';
import type { ToolName } from '../../common/tool/toolCatalog';
import type { ToolExecutionContext } from '../../common/tool/types';

// The mount prefix SSOT lives in core (promptBlock.ts) so the settings API
// can render TOC paths without importing the graph; re-exported for the
// existing graph-side consumers.
export { DEFINITION_MOUNT_PREFIX };

let _mcp: McpConnectionManager | null = null;
let _registry: ToolRegistry | null = null;

export function setUniversalMcp(mcp: McpConnectionManager | null): void {
  _mcp = mcp;
}

export function getUniversalMcp(): McpConnectionManager | null {
  return _mcp;
}

/**
 * MCP result spooling — the cross-tool data plane (short form).
 *
 * Without this, every byte an MCP tool returns is forced through the model's
 * context: moving system A's data into a file (or toward system B) means the
 * LLM re-types it, which double-bills tokens, caps out on multi-thousand-row
 * results, and transcribes lossily. Results over the threshold are written to
 * the artifacts sandbox instead, and only the path + shape + a head preview
 * enter the context; the agent then reads slices via read_file/search_files.
 *
 * Spool files are data-plane intermediates, not job outputs: the write goes
 * straight through ctx.fileSystem (no side effects emitted), so it never folds
 * into `_turnToolWrites` — neither the artifact manifest nor an artifact stop
 * hook can be satisfied by a spool. Error results are never spooled — the
 * model plans recovery from the error text itself.
 */
export const MCP_SPOOL_THRESHOLD_BYTES = 32 * 1024;
export const MCP_SPOOL_DIR = 'mcp-results';
const MCP_SPOOL_PREVIEW_CHARS = 1500;

let _mcpSpoolSeq = 0;

async function spoolMcpResult(
  ctx: ToolExecutionContext,
  info: McpToolInfo,
  text: string,
): Promise<{ content: string }> {
  const seq = ++_mcpSpoolSeq;
  const spoolPath = `${MCP_SPOOL_DIR}/${info.serverName}/${info.toolName}-${seq}.txt`;
  try {
    await ctx.fileSystem.writeFile(spoolPath, text);
  } catch (err: any) {
    // Spooling is a context optimization — a failed spool write must not fail
    // the tool call, so fall back to the inline (pre-spooling) behaviour.
    console.warn(`⚠️ [UniversalMCP] Spool write failed (${spoolPath}), returning inline:`, err?.message);
    return { content: text };
  }
  const bytes = Buffer.byteLength(text, 'utf-8');
  const lines = text.split('\n').length;
  const preview = text.slice(0, MCP_SPOOL_PREVIEW_CHARS);
  return {
    content:
      `MCP result too large to return inline — spooled to ${spoolPath} (${bytes} bytes, ${lines} lines).\n` +
      `Read slices with read_file (offset/limit) or locate rows with search_files; do NOT re-read the whole file at once.\n` +
      `--- head preview ---\n${preview}\n--- preview truncated ---`,
  };
}

/**
 * Registers one dispatch handler per connected MCP tool onto the registry
 * singleton. Called once per process, after MCP connect (runner start).
 *
 * MUST register into `getUniversalRegistry()`'s existing instance and MUST NOT
 * replace it: `nodes/tool.ts` passes `registry: getUniversalRegistry()` at
 * module load (the `createToolNode({...})` call is module-top-level, reached via
 * runner → graph → nodes/tool static imports), and `createToolNode` captures it
 * immediately in `new ToolOrchestrator({ registry })`. Swapping in a fresh
 * instance here leaves that orchestrator holding an MCP-less preset registry, so
 * every `mcp__*` call fails `registry.get(name) === undefined` → "Unknown tool"
 * — while the subagent seam (which resolves the registry inside `buildContext`,
 * i.e. per call) still works, producing a confusing asymmetry.
 */
export function buildUniversalRegistry(mcp: McpConnectionManager | null): ToolRegistry {
  const registry = getUniversalRegistry();
  if (mcp) {
    for (const info of mcp.listToolInfos()) {
      // MCP names are dynamic — the registry map is string-keyed at runtime.
      registry.register(info.name as ToolName, async (ctx, args) => {
        const result = await mcp.callTool(info.name, args as Record<string, unknown>);
        if (result.isError) {
          return {
            content: result.text || '(empty MCP result)',
            error: result.text || 'MCP tool returned an error',
          };
        }
        const text = result.text || '';
        if (Buffer.byteLength(text, 'utf-8') > MCP_SPOOL_THRESHOLD_BYTES) {
          return spoolMcpResult(ctx, info, text);
        }
        return { content: text || '(empty MCP result)' };
      });
    }
  }
  return registry;
}

export function getUniversalRegistry(): ToolRegistry {
  if (!_registry) {
    _registry = createUniversalToolRegistry();
  }
  return _registry;
}

/**
 * TURN-scoped streaming pipeline (A14). The agent→tool→agent loop re-invokes
 * the agent node once per round; a per-round parser loses its tag context at
 * the round boundary, so a `<reply>` opened before a tool call and closed
 * after it leaks both raw delimiters into the assistant message. One parser +
 * renderer per TURN (process = one job turn in the runner child) lets the
 * late `</reply>` land on the same `insideReply` state. The agent node calls
 * `orchestrator.beginRound()` at each round start.
 */
let _turnStreaming: StreamOrchestrator | null = null;

export function getOrCreateUniversalTurnStreaming(
  chatAPI: ChatAPIClient,
  language: 'ko' | 'en',
): StreamOrchestrator {
  if (!_turnStreaming) {
    const parser = new XMLStreamParser();
    const renderStrategy = new CommonRenderStrategy(chatAPI, language);
    _turnStreaming = new StreamOrchestrator({ parser, renderStrategy });
  }
  return _turnStreaming;
}

export function _resetUniversalRuntimeForTests(): void {
  _mcp = null;
  _registry = null;
  _turnStreaming = null;
  _mcpSpoolSeq = 0;
}

/**
 * Two-root sandbox facade: `universal/artifacts/` read-write, plus the custom
 * agent definition dir mounted read-only at {@link DEFINITION_MOUNT_PREFIX}.
 * Everything else delegates verbatim to the artifacts adapter (whose
 * `resolveAbsolute` supplies path-traversal protection for both roots).
 */
export function createUniversalFileSystem(
  artifactsFs: FileSystemPort,
  definitionFs: FileSystemPort,
): FileSystemPort {
  const strip = (p: string): string => p.slice(DEFINITION_MOUNT_PREFIX.length);
  const isMounted = (p: string): boolean => p.startsWith(DEFINITION_MOUNT_PREFIX);
  const readOnly = (op: string): never => {
    throw new Error(`${op}: the agent definition mount (${DEFINITION_MOUNT_PREFIX}) is read-only`);
  };

  return {
    readFile: (p) => (isMounted(p) ? definitionFs.readFile(strip(p)) : artifactsFs.readFile(p)),
    fileExists: (p) => (isMounted(p) ? definitionFs.fileExists(strip(p)) : artifactsFs.fileExists(p)),
    readDirectory: (p) => (isMounted(p) ? definitionFs.readDirectory(strip(p)) : artifactsFs.readDirectory(p)),
    listFiles: (p, exclude) => (isMounted(p) ? definitionFs.listFiles(strip(p), exclude) : artifactsFs.listFiles(p, exclude)),
    isDirectory: (p) => (isMounted(p) ? definitionFs.isDirectory(strip(p)) : artifactsFs.isDirectory(p)),
    writeFile: (p, c) => (isMounted(p) ? readOnly('writeFile') : artifactsFs.writeFile(p, c)),
    deleteFile: (p) => (isMounted(p) ? readOnly('deleteFile') : artifactsFs.deleteFile(p)),
    createDirectory: (p) => (isMounted(p) ? readOnly('createDirectory') : artifactsFs.createDirectory(p)),
    copyFile: (src, dest, overwrite) =>
      isMounted(src) || isMounted(dest) ? readOnly('copyFile') : artifactsFs.copyFile(src, dest, overwrite),
    moveFile: (src, dest, overwrite) =>
      isMounted(src) || isMounted(dest) ? readOnly('moveFile') : artifactsFs.moveFile(src, dest, overwrite),
    copyDirectory: (src, dest) =>
      isMounted(src) || isMounted(dest) ? readOnly('copyDirectory') : artifactsFs.copyDirectory(src, dest),
    moveDirectory: (src, dest) =>
      isMounted(src) || isMounted(dest) ? readOnly('moveDirectory') : artifactsFs.moveDirectory(src, dest),
    getRootPath: () => artifactsFs.getRootPath(),
    resolveAbsolute: (p) => (isMounted(p) ? definitionFs.resolveAbsolute(strip(p)) : artifactsFs.resolveAbsolute(p)),
  };
}
