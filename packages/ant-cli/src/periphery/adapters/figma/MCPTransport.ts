/**
 * MCP Transport Abstraction
 * 
 * Provides a unified interface for calling Figma MCP tools,
 * regardless of the transport mechanism (local direct / cloud bridge).
 */

import type { FigmaMCPTool, MCPToolResult } from '@ant/shared';
import { BRIDGE_MCP_REQUEST_TIMEOUT_MS } from '@ant/shared';

export interface MCPTransport {
  callTool(name: FigmaMCPTool, args: Record<string, unknown>): Promise<MCPToolResult>;
  isAvailable(): Promise<boolean>;
}

/**
 * DirectMCPTransport
 * 
 * For local mode (ANT_SERVER_MODE=local): worker calls Figma Desktop MCP
 * directly via HTTP at localhost:3845.
 */
export class DirectMCPTransport implements MCPTransport {
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || 'http://127.0.0.1:3845/mcp';
  }

  async callTool(name: FigmaMCPTool, args: Record<string, unknown>): Promise<MCPToolResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_MCP_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        return { content: null, isError: true };
      }

      const json = await response.json();

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok || res.status === 400;
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
 * 
 * Stub implementation — full Redis pub/sub will be implemented in Phase 3-B.
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
        return { content: parsed.result };
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
