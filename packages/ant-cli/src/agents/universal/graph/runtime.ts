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

import { UNIVERSAL_AGENTS_DIRNAME, UNIVERSAL_PIPELINE_RUNS_DIRNAME, parseUniversalAgentRef } from '@ant/shared';
import type { FileSystemPort } from '../../../core/ports/filesystem';
import { ESTIMATE_CHARS_PER_TOKEN } from '../../../core/utils/tokenBudget';
import { findAgentRoot, type CustomAgentScopeRoot } from '../../../core/customAgents/CustomAgentLoader';
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

/**
 * ToolResultManager caps for universal jobs — explicit, at code-execute parity
 * (see code/nodes/tool/utils/managers.ts). The defaults (3000-token reads)
 * would clamp every ranged decompaction read to ~8.4KB, making the outline →
 * read_file(startLine/endLine) cycle lossy.
 */
export const UNIVERSAL_RESULT_LIMITS = {
  maxReadFileTokens: 16_000,
  maxRunCommandTokens: 5_000,
  maxTokensPerResult: 12_000, // generic cap; the spool threshold derives from this
} as const;

/**
 * Derived, not chosen: anything the generic truncator would cut must have been
 * spooled first. UTF-8 `chars ≤ bytes` and `estimateTokens = ceil(chars/2.8)`,
 * so a result that stays inline (bytes ≤ this) estimates ≤ maxTokensPerResult
 * and `truncateGeneric` never touches it — no irrecoverable band between the
 * spool decision (handler, bytes) and truncation (orchestrator, tokens).
 */
export const MCP_SPOOL_THRESHOLD_BYTES = Math.floor(
  UNIVERSAL_RESULT_LIMITS.maxTokensPerResult * ESTIMATE_CHARS_PER_TOKEN,
);
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
      `Read slices with read_file (startLine/endLine, 1-based) or locate rows with search_files; do NOT re-read the whole file at once.\n` +
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
 * One read-only mount in the universal sandbox facade.
 *
 * `resolve` returns the port + port-relative path a mounted path maps to, or
 * `null` when the mount owns the prefix but cannot serve that path (an unknown
 * agent id) — which surfaces as a tool error rather than a silent fall-through
 * to the artifacts root.
 */
export interface UniversalReadOnlyMount {
  /** Merged-view prefix, trailing slash included (`_agent-definition/`). */
  prefix: string;
  resolve(rel: string): { fs: FileSystemPort; path: string } | null;
}

/** The own-definition mount, the shape every caller used before mounts were plural. */
export function definitionMount(definitionFs: FileSystemPort): UniversalReadOnlyMount {
  return {
    prefix: DEFINITION_MOUNT_PREFIX,
    resolve: (rel) => ({ fs: definitionFs, path: rel }),
  };
}

/**
 * Peer-definition mount (`_agents/{agentId}/…`) — read-only view of every agent
 * definition this account can see, resolved through the SAME ordered scope
 * roots (`findAgentRoot`, user > org > builtin) that `GET /account/agents`
 * lists. Read authority is therefore identical to the settings screen's; this
 * mount widens nothing, it only removes an HTTP round trip.
 *
 * An unknown or invalid agent id resolves to `null` — the facade turns that
 * into a tool error instead of falling through to the artifacts root.
 */
export function peerAgentsMount(
  scopeRoots: CustomAgentScopeRoot[],
  createFs: (root: string) => FileSystemPort,
): UniversalReadOnlyMount {
  const cache = new Map<string, FileSystemPort>();
  return {
    prefix: `${UNIVERSAL_AGENTS_DIRNAME}/`,
    resolve: (rel) => {
      const parsed = parseUniversalAgentRef(`${UNIVERSAL_AGENTS_DIRNAME}/${rel}`);
      if (!parsed) return null;
      let fs = cache.get(parsed.agentId);
      if (!fs) {
        const found = findAgentRoot(scopeRoots, parsed.agentId);
        if (!found) return null;
        fs = createFs(found.agentDir);
        cache.set(parsed.agentId, fs);
      }
      return { fs, path: parsed.rest };
    },
  };
}

/** Pipeline run-log mount — the grafted node the explorer already shows, now
 * readable by the tools that were being handed its paths. */
export function pipelineRunsMount(
  runsRoot: string,
  createFs: (root: string) => FileSystemPort,
): UniversalReadOnlyMount {
  const fs = createFs(runsRoot);
  return {
    prefix: `${UNIVERSAL_PIPELINE_RUNS_DIRNAME}/`,
    resolve: (rel) => ({ fs, path: rel }),
  };
}

/**
 * N-root sandbox facade: `universal/artifacts/` read-write, plus read-only
 * mounts (the agent's own definition dir at {@link DEFINITION_MOUNT_PREFIX},
 * peer definitions at `_agents/`, run logs at `pipeline-runs/`). Everything
 * else delegates verbatim to the artifacts adapter (whose `resolveAbsolute`
 * supplies path-traversal protection for every root).
 *
 * The mount set is the AGENT PLANE — the same set `resolveUniversalAgentPlanePath`
 * admits, and therefore the same set the composer may attach. Adding a mount
 * here without teaching that resolver (or the reverse) re-creates the
 * attachable-but-unreadable class of bug this replaced.
 */
export function createUniversalFileSystem(
  artifactsFs: FileSystemPort,
  mounts: UniversalReadOnlyMount[],
): FileSystemPort {
  const mountFor = (p: string): UniversalReadOnlyMount | undefined =>
    mounts.find((m) => p.startsWith(m.prefix));

  const readOnly = (op: string, prefix: string): never => {
    throw new Error(`${op}: the ${prefix} mount is read-only`);
  };

  /** Resolve a mounted path, or throw the mount's own "cannot serve this" error. */
  const target = (m: UniversalReadOnlyMount, p: string): { fs: FileSystemPort; path: string } => {
    const t = m.resolve(p.slice(m.prefix.length));
    if (!t) throw new Error(`Cannot resolve mounted path: ${p}`);
    return t;
  };

  /** Read op: route to the owning mount, else the artifacts adapter. */
  const read = <T>(p: string, onMount: (fs: FileSystemPort, rel: string) => T, onArtifacts: () => T): T => {
    const m = mountFor(p);
    if (!m) return onArtifacts();
    const t = target(m, p);
    return onMount(t.fs, t.path);
  };

  /** Write op: refuse if EITHER operand is mounted. */
  const write = <T>(paths: string[], op: string, run: () => T): T => {
    const m = paths.map(mountFor).find(Boolean);
    if (m) return readOnly(op, m.prefix);
    return run();
  };

  return {
    readFile: (p, opts) => read(p, (fs, rel) => fs.readFile(rel, opts), () => artifactsFs.readFile(p, opts)),
    fileExists: (p) => read(p, (fs, rel) => fs.fileExists(rel), () => artifactsFs.fileExists(p)),
    readDirectory: (p) => read(p, (fs, rel) => fs.readDirectory(rel), () => artifactsFs.readDirectory(p)),
    listFiles: (p, exclude) => read(p, (fs, rel) => fs.listFiles(rel, exclude), () => artifactsFs.listFiles(p, exclude)),
    isDirectory: (p) => read(p, (fs, rel) => fs.isDirectory(rel), () => artifactsFs.isDirectory(p)),
    writeFile: (p, c) => write([p], 'writeFile', () => artifactsFs.writeFile(p, c)),
    deleteFile: (p) => write([p], 'deleteFile', () => artifactsFs.deleteFile(p)),
    createDirectory: (p) => write([p], 'createDirectory', () => artifactsFs.createDirectory(p)),
    copyFile: (src, dest, overwrite) => write([src, dest], 'copyFile', () => artifactsFs.copyFile(src, dest, overwrite)),
    moveFile: (src, dest, overwrite) => write([src, dest], 'moveFile', () => artifactsFs.moveFile(src, dest, overwrite)),
    copyDirectory: (src, dest) => write([src, dest], 'copyDirectory', () => artifactsFs.copyDirectory(src, dest)),
    moveDirectory: (src, dest) => write([src, dest], 'moveDirectory', () => artifactsFs.moveDirectory(src, dest)),
    getRootPath: () => artifactsFs.getRootPath(),
    resolveAbsolute: (p) => read(p, (fs, rel) => fs.resolveAbsolute(rel), () => artifactsFs.resolveAbsolute(p)),
  };
}
