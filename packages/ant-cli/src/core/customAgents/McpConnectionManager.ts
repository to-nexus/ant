/**
 * MCP connection manager — universal-job overlay tools.
 *
 * Connects to the servers declared in the resolved custom job (`mcp.servers`,
 * D4 merge of agent + job), lists their tools, and exposes them to the agent
 * round under the `mcp__{server}__{tool}` naming convention. The tool node
 * routes any `mcp__`-prefixed call here; everything else stays builtin.
 *
 * Trust model: an MCP stdio server is arbitrary code execution, equivalent to
 * run_command — acceptable under the workspace trust model; cloud multitenancy
 * relies on pod isolation (documented risk, Phase 3 adds org approval).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDefinition } from '../ports/llm';
import { extractMCPTextContent, extractMCPImageContent } from '../utils/mcpContent';
import { MCP_TOOL_PREFIX } from './universalToolPolicy';
import type { McpServerConfig } from './types';

const CONNECT_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;

export interface McpToolInfo {
  /** Prefixed name advertised to the LLM: `mcp__{server}__{tool}`. */
  name: string;
  serverName: string;
  /** Raw tool name on the server. */
  toolName: string;
  definition: ToolDefinition;
  /** MCP annotation hint — feeds the approval default (read-only ⇒ no gate). */
  readOnlyHint?: boolean;
}

export interface McpCallResult {
  text: string;
  image?: { base64: string; mimeType: string };
  isError: boolean;
}

function buildPrefixedName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

/** Split `mcp__{server}__{tool}` → { serverName, toolName }; null if not MCP-shaped. */
export function parseMcpToolName(prefixed: string): { serverName: string; toolName: string } | null {
  if (!prefixed.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = prefixed.slice(MCP_TOOL_PREFIX.length);
  const sep = rest.indexOf('__');
  if (sep <= 0) return null;
  return { serverName: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Resolve declared env-var *names* to values from the host environment. */
function resolveEnv(declared: Record<string, string> | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, varName] of Object.entries(declared ?? {})) {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(
        `MCP server env "${key}" references host env var "${varName}" which is not set — set it before starting the job`,
      );
    }
    resolved[key] = value;
  }
  return resolved;
}

export class McpConnectionManager {
  private clients = new Map<string, Client>();
  private tools: McpToolInfo[] = [];
  private connected = false;

  constructor(private readonly servers: Record<string, McpServerConfig>) {}

  /** Connect every declared server and collect its tool list. Fail-loud. */
  async connect(): Promise<void> {
    if (this.connected) return;
    for (const [serverName, cfg] of Object.entries(this.servers)) {
      const client = new Client({ name: 'ant-universal', version: '1.0.0' });
      const transport =
        cfg.transport === 'stdio'
          ? new StdioClientTransport({
              command: cfg.command!,
              args: cfg.args ?? [],
              env: { ...process.env as Record<string, string>, ...resolveEnv(cfg.env) },
            })
          : new StreamableHTTPClientTransport(new URL(cfg.url!));

      console.log(`🔌 [MCP] Connecting to server "${serverName}" (${cfg.transport})`);
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP connect "${serverName}"`);
      this.clients.set(serverName, client);

      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP tools/list "${serverName}"`);
      for (const tool of listed.tools) {
        this.tools.push({
          name: buildPrefixedName(serverName, tool.name),
          serverName,
          toolName: tool.name,
          readOnlyHint: tool.annotations?.readOnlyHint === true,
          definition: {
            name: buildPrefixedName(serverName, tool.name),
            description: tool.description ?? `MCP tool ${tool.name} on server ${serverName}`,
            input_schema: (tool.inputSchema ?? { type: 'object', properties: {} }) as ToolDefinition['input_schema'],
          },
        });
      }
      console.log(`🔌 [MCP] "${serverName}" connected — ${listed.tools.length} tool(s)`);
    }
    this.connected = true;
  }

  listToolInfos(): McpToolInfo[] {
    return this.tools;
  }

  getToolInfo(prefixedName: string): McpToolInfo | undefined {
    return this.tools.find((t) => t.name === prefixedName);
  }

  /** Dispatch one `mcp__`-prefixed call. Throws on unknown server/tool. */
  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const parsed = parseMcpToolName(prefixedName);
    if (!parsed) throw new Error(`Not an MCP tool name: ${prefixedName}`);
    const client = this.clients.get(parsed.serverName);
    if (!client) throw new Error(`MCP server not connected: ${parsed.serverName}`);

    const result = await withTimeout(
      client.callTool({ name: parsed.toolName, arguments: args }),
      CALL_TIMEOUT_MS,
      `MCP call ${prefixedName}`,
    );
    const text = extractMCPTextContent(result.content) ?? '';
    const image = extractMCPImageContent(result.content) ?? undefined;
    return { text, image, isError: result.isError === true };
  }

  /** Close all connections (job end / abort). Never throws. */
  async close(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
      } catch (e) {
        console.warn(`⚠️ [MCP] Error closing server "${name}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.clients.clear();
    this.connected = false;
  }
}
