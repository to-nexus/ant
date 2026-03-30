/**
 * Shared Figma MCP Handler
 *
 * Unified cache / in-flight dedup / rate-limit detection / debug logging
 * for Figma MCP tool calls. Used by both code and design jobs.
 *
 * Periphery layer (`periphery/adapters/figma/`) handles transport (HTTP / Redis).
 * This module handles application-level policy on top of it.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createMCPAdapter, extractMCPTextContent, isFigmaMCPSoftError, isLikelyMCPErrorResponse } from '../../../periphery/adapters/figma/MCPTransport';
import type { FigmaMCPAdapter } from '../../../periphery/adapters/figma/FigmaMCPAdapter';
import { FigmaRateLimitError, isRateLimitResponse } from '../../../periphery/adapters/figma/errors';
import { getSessionDebugDir } from '../../../core/utils/sessionPaths';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface FigmaMCPCallOpts {
  userId?: string;
  redis?: any;
  taskId?: string;
}

interface FigmaMCPLogEntry {
  ts: string;
  tool: string;
  cacheKey: string;
  result: 'cache_hit' | 'inflight_dedup' | 'mcp_call' | 'rate_limited' | 'error';
  elapsedMs?: number;
  taskId?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module-level state (process-scoped; isolated per job via child process)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FIGMA_TOOL_METHOD_MAP: Record<string, keyof FigmaMCPAdapter> = {
  figma_get_metadata: 'getMetadata',
  figma_get_design_context: 'getDesignContext',
  figma_get_screenshot: 'getScreenshot',
  figma_get_variable_defs: 'getVariableDefs',
};

const _figmaResponseCache = new Map<string, string>();
const _figmaInflightRequests = new Map<string, Promise<string>>();
let _figmaRateLimited = false;

const _figmaMCPLog: FigmaMCPLogEntry[] = [];
let _figmaMCPLogSaved = false;

function logMCPEvent(entry: FigmaMCPLogEntry): void {
  _figmaMCPLog.push(entry);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create/reuse a FigmaMCPAdapter instance.
 * Use this when you need raw adapter access (e.g. figmaExplore bypassing cache).
 */
export function getFigmaMCPAdapter(opts: { userId?: string; redis?: any }): FigmaMCPAdapter {
  return createMCPAdapter({ userId: opts.userId, redis: opts.redis });
}

/**
 * Execute a Figma MCP tool call with cache, in-flight dedup, and rate-limit detection.
 * Throws FigmaRateLimitError on rate limit (must be re-thrown by caller for TaskOrchestrator).
 */
export async function callFigmaMCPTool(
  opts: FigmaMCPCallOpts,
  toolName: string,
  fileKey: string,
  nodeId: string,
): Promise<string> {
  if (!fileKey || !nodeId) {
    throw new Error(`${toolName} requires fileKey and nodeId`);
  }

  const { taskId } = opts;

  if (_figmaRateLimited) {
    logMCPEvent({ ts: new Date().toISOString(), tool: toolName, cacheKey: `${toolName}:${fileKey}:${nodeId}`, result: 'rate_limited', taskId });
    throw new FigmaRateLimitError();
  }

  const normalizedNodeId = nodeId.replace(/:/g, '-');
  const cacheKey = `${toolName}:${fileKey}:${normalizedNodeId}`;
  const cached = _figmaResponseCache.get(cacheKey);
  if (cached) {
    console.log(`🔧 [FigmaMCP] Cache hit: ${toolName} (${fileKey}:${nodeId})`);
    logMCPEvent({ ts: new Date().toISOString(), tool: toolName, cacheKey, result: 'cache_hit', taskId });
    return cached;
  }

  const inflight = _figmaInflightRequests.get(cacheKey);
  if (inflight) {
    console.log(`🔧 [FigmaMCP] In-flight dedup: ${toolName} (${fileKey}:${nodeId})`);
    logMCPEvent({ ts: new Date().toISOString(), tool: toolName, cacheKey, result: 'inflight_dedup', taskId });
    try { return await inflight; }
    catch { /* inflight request failed, fall through to make own request */ }
  }

  if (_figmaRateLimited) {
    logMCPEvent({ ts: new Date().toISOString(), tool: toolName, cacheKey, result: 'rate_limited', taskId });
    throw new FigmaRateLimitError();
  }

  const callStart = Date.now();
  const promise = executeFigmaMCPCall(opts, toolName, fileKey, nodeId);
  _figmaInflightRequests.set(cacheKey, promise);
  try {
    const result = await promise;
    _figmaResponseCache.set(cacheKey, result);
    logMCPEvent({ ts: new Date().toISOString(), tool: toolName, cacheKey, result: 'mcp_call', elapsedMs: Date.now() - callStart, taskId });
    return result;
  } catch (err) {
    logMCPEvent({ ts: new Date().toISOString(), tool: toolName, cacheKey, result: err instanceof FigmaRateLimitError ? 'rate_limited' : 'error', elapsedMs: Date.now() - callStart, taskId });
    throw err;
  } finally {
    _figmaInflightRequests.delete(cacheKey);
  }
}

/**
 * Flush MCP debug log to disk. Call once at job completion (learn node).
 */
export async function saveFigmaMCPDebugLog(featurePath: string, jobId: string): Promise<void> {
  if (_figmaMCPLogSaved || _figmaMCPLog.length === 0) return;
  if (!featurePath || !jobId) return;

  _figmaMCPLogSaved = true;
  const cacheHits = _figmaMCPLog.filter(e => e.result === 'cache_hit').length;
  const dedupHits = _figmaMCPLog.filter(e => e.result === 'inflight_dedup').length;
  const mcpCalls = _figmaMCPLog.filter(e => e.result === 'mcp_call').length;
  const rateLimits = _figmaMCPLog.filter(e => e.result === 'rate_limited').length;
  const errors = _figmaMCPLog.filter(e => e.result === 'error').length;

  const data = {
    jobId,
    summary: { totalEvents: _figmaMCPLog.length, cacheHits, dedupHits, mcpCalls, rateLimits, errors },
    calls: _figmaMCPLog,
  };

  try {
    const dir = getSessionDebugDir(featurePath, 'architect', 'figma');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `mcp-${jobId}.json`), JSON.stringify(data, null, 2));
  } catch { /* non-blocking */ }
}

/**
 * Reset module-level state. Call if you need a clean slate within the same process.
 * Normally not needed — each job runs in a separate child process.
 */
export function resetFigmaMCPState(): void {
  _figmaResponseCache.clear();
  _figmaInflightRequests.clear();
  _figmaRateLimited = false;
  _figmaMCPLog.length = 0;
  _figmaMCPLogSaved = false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function executeFigmaMCPCall(
  opts: FigmaMCPCallOpts,
  toolName: string,
  fileKey: string,
  nodeId: string,
): Promise<string> {
  const adapter = getFigmaMCPAdapter({ userId: opts.userId, redis: opts.redis });

  const method = FIGMA_TOOL_METHOD_MAP[toolName];
  if (!method) {
    throw new Error(`No MCP method mapping for tool: ${toolName}`);
  }

  const mcpResult = await (adapter[method] as Function)(fileKey, nodeId);

  const rawContent = mcpResult.content;
  const extracted = extractMCPTextContent(rawContent);
  const textForCheck = extracted
    ?? (typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent));

  // Rate limit: Figma MCP Bridge may return isError:false for rate limits,
  // so check extracted content regardless of the isError flag.
  if (isRateLimitResponse(textForCheck)) {
    _figmaRateLimited = true;
    throw new FigmaRateLimitError(`Figma MCP rate limit (${toolName}): ${textForCheck}`);
  }

  if (mcpResult.isError) {
    throw new Error(`Figma MCP error (${toolName}): ${textForCheck}`);
  }

  const result = extracted
    ?? (typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2));

  if (isFigmaMCPSoftError(result) || isLikelyMCPErrorResponse(result)) {
    throw new Error(`Figma Desktop is not accessible: ${result}. Open a design file in Figma Desktop and retry.`);
  }

  return result;
}
