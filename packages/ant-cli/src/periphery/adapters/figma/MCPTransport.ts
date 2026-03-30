/**
 * MCP Transport Abstraction
 * 
 * Provides a unified interface for calling Figma MCP tools,
 * regardless of the transport mechanism (local direct / cloud bridge).
 */

import type { FigmaMCPTool, MCPToolResult } from '@ant/shared';
import { BRIDGE_MCP_REQUEST_TIMEOUT_MS, FIGMA_MCP_ENDPOINT } from '@ant/shared';
import { FigmaMCPAdapter } from './FigmaMCPAdapter';

export interface MCPTransport {
  callTool(name: FigmaMCPTool, args: Record<string, unknown>): Promise<MCPToolResult>;
  isAvailable(): Promise<boolean>;
}

/**
 * Extract the actual text content from an MCP tool result.
 * MCP tools wrap results as: { content: [{ type: "text", text: "..." }] }
 * or after one unwrap: [{ type: "text", text: "..." }].
 * Returns the concatenated text from all text items, or null if none found.
 */
export function extractMCPTextContent(content: unknown): string | null {
  if (!content) return null;

  if (typeof content === 'string') return content;

  // { content: [...] } wrapper
  if (typeof content === 'object' && !Array.isArray(content)) {
    const arr = (content as any).content;
    if (Array.isArray(arr)) return extractMCPTextContent(arr);
  }

  // [{ type: "text", text: "..." }, ...] MCP content items
  if (Array.isArray(content)) {
    const texts = content
      .filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
      .map((item: any) => item.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }

  return null;
}

/**
 * Known Figma MCP soft-error messages.
 * These are returned as successful JSON-RPC responses (no `error` field),
 * but the text content indicates the tool could not produce real data.
 */
const FIGMA_SOFT_ERROR_PATTERNS = [
  'no figma window open',
  'no file open',
  'plugin not running',
  'only available if your active tab',
];

export function isFigmaMCPSoftError(text: string): boolean {
  if (!text || text.length > 300) return false;
  const lower = text.toLowerCase();
  return FIGMA_SOFT_ERROR_PATTERNS.some(p => lower.includes(p));
}

/**
 * Positive-validation heuristic: detect responses that are NOT valid data.
 *
 * Instead of maintaining an ever-growing list of error patterns, this checks
 * whether the response looks like actual structured data (XML, JSON).
 * A short plain-text response that isn't structured data is almost certainly
 * an error message from the MCP server.
 */
export function isLikelyMCPErrorResponse(text: string): boolean {
  if (!text || text.length > 500) return false;
  if (isFigmaMCPSoftError(text)) return true;
  const trimmed = text.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return true;
}

const MCP_ACCEPT = 'application/json, text/event-stream';

/**
 * Parse a Figma MCP response body that may be SSE or plain JSON.
 * SSE format: `event: message\ndata: {json}\n\n`
 */
function parseMCPResponse(text: string, contentType: string | null): any {
  if (contentType?.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        return JSON.parse(line.slice(6));
      }
    }
    throw new Error('No data line in SSE response');
  }
  return JSON.parse(text);
}

/**
 * DirectMCPTransport
 * 
 * For local mode (ANT_SERVER_MODE=local): worker calls Figma Desktop MCP
 * directly via HTTP at localhost:3845.
 */
export class DirectMCPTransport implements MCPTransport {
  private endpoint: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sessionId: string | null = null;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || 'http://127.0.0.1:3845/mcp';
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': MCP_ACCEPT,
    };
    if (this.sessionId) {
      h['Mcp-Session-Id'] = this.sessionId;
    }
    return h;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const initRes = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': MCP_ACCEPT,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ant-cli', version: '1.0.0' },
          },
          id: `init-${Date.now()}`,
        }),
      });

      if (!initRes.ok) {
        throw new Error(`MCP initialize returned HTTP ${initRes.status}`);
      }

      const sid = initRes.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;

      const ct = initRes.headers.get('content-type');
      const text = await initRes.text();
      const json = parseMCPResponse(text, ct);

      if (json.error) {
        throw new Error(`MCP initialize rejected: ${json.error.message || JSON.stringify(json.error)}`);
      }

      await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      this.initialized = true;
    })();

    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  async callTool(name: FigmaMCPTool, args: Record<string, unknown>): Promise<MCPToolResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_MCP_REQUEST_TIMEOUT_MS);

    try {
      await this.ensureInitialized();

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name, arguments: args },
          id: `direct-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        return { content: `HTTP ${response.status}: ${errorBody}`, isError: true };
      }

      const ct = response.headers.get('content-type');
      const text = await response.text();
      const json = parseMCPResponse(text, ct);

      if (json.error) {
        return { content: json.error.message || json.error, isError: true };
      }

      return { content: json.result?.content ?? json.result };
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        return { content: `MCP request timed out after ${BRIDGE_MCP_REQUEST_TIMEOUT_MS}ms`, isError: true };
      }
      return { content: error.message || 'MCP transport error', isError: true };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': MCP_ACCEPT,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ant-cli', version: '1.0.0' },
          },
          id: `avail-${Date.now()}`,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * BridgeMCPTransport
 * 
 * For cloud mode: worker publishes MCP request to Redis,
 * Realtime forwards to Ant Desktop WebSocket, response comes back via Redis.
 * MCP initialization is handled by the companion app (ant-desktop).
 */
export class BridgeMCPTransport implements MCPTransport {
  private userId: string;
  private redis: any;

  constructor(userId: string, redis: any) {
    this.userId = userId;
    this.redis = redis;
  }

  async callTool(name: FigmaMCPTool, args: Record<string, unknown>): Promise<MCPToolResult> {
    const requestId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const request = {
      requestId,
      userId: this.userId,
      tool: name,
      args,
    };

    // Publish to user-scoped channel (cloud-safe: only the Pod with this user's WS receives it)
    await this.redis.publish(`bridge:mcp:request:${this.userId}`, JSON.stringify(request));

    // Wait for response on Redis key (blocking read with timeout)
    const responseKey = `bridge:mcp:response:${requestId}`;
    const timeoutMs = BRIDGE_MCP_REQUEST_TIMEOUT_MS;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const raw = await this.redis.get(responseKey);
      if (raw) {
        await this.redis.del(responseKey);
        const parsed = JSON.parse(raw);
        if (parsed.error) {
          return { content: parsed.error, isError: true };
        }
        return { content: parsed.result?.content ?? parsed.result };
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return { content: `Bridge MCP request timed out after ${timeoutMs}ms`, isError: true };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const sessionKey = `ant:bridge:session:${this.userId}`;
      const raw = await this.redis.get(sessionKey);
      if (!raw) return false;
      const session = JSON.parse(raw);
      return session.status === 'connected' && session.figmaDesktopReachable === true;
    } catch {
      return false;
    }
  }
}

/**
 * Create the appropriate MCPTransport based on server mode.
 */
export function createMCPTransport(options: {
  serverMode: 'local' | 'cloud';
  userId?: string;
  redis?: any;
  mcpEndpoint?: string;
}): MCPTransport {
  if (options.serverMode === 'local') {
    return new DirectMCPTransport(options.mcpEndpoint);
  }
  if (!options.userId || !options.redis) {
    throw new Error('BridgeMCPTransport requires userId and redis');
  }
  return new BridgeMCPTransport(options.userId, options.redis);
}

/**
 * Check if Figma Desktop MCP is reachable (local mode only).
 * Sends a minimal HTTP request to localhost:3845.
 */
export async function checkLocalMCPAvailability(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(FIGMA_MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

let _cachedAdapter: { key: string; adapter: FigmaMCPAdapter } | null = null;

/**
 * Create a shared FigmaMCPAdapter with module-level caching.
 * Reuses the adapter for the same serverMode + userId combination.
 */
export function createMCPAdapter(opts: { userId?: string; redis?: any }): FigmaMCPAdapter {
  const serverMode = (process.env.ANT_SERVER_MODE || 'local') as 'local' | 'cloud';
  const cacheKey = `${serverMode}:${opts.userId || 'local'}`;

  if (_cachedAdapter?.key === cacheKey) {
    return _cachedAdapter.adapter;
  }

  const transport = createMCPTransport({ serverMode, userId: opts.userId, redis: opts.redis });
  const adapter = new FigmaMCPAdapter(transport);
  _cachedAdapter = { key: cacheKey, adapter };
  return adapter;
}
