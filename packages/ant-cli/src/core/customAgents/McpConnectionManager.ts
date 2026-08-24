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
 * relies on pod isolation (documented risk, Phase 3 adds org approval). A stdio
 * child therefore gets a MINIMAL env (see {@link STDIO_EXEC_ENV_KEYS}), not the
 * host's, and secrets travel as `${secret:KEY}` references only (other values
 * are authored plain text) — for http servers through `headers`, for stdio
 * through `env`. Reference resolution goes through
 * {@link McpCredentialResolver} (encrypted per-user store); it never reads
 * process.env, so a definition cannot name-and-exfiltrate host secrets.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDefinition } from '../ports/llm';
import { extractMCPTextContent, extractMCPImageContent } from '../utils/mcpContent';
import { MCP_TOOL_PREFIX } from './universalToolPolicy';
import { parseSecretRef, isForbiddenMcpEnvKey } from '@ant/shared';
import { McpConfigError } from './McpConfigError';
import type { McpCredentialResolver } from './McpCredentialResolver';
import type { McpServerConfig } from './types';
import { assertUserCodeIsolationOrThrow, wrapCommandForChildIdentity } from '../config/childIdentity';

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

/**
 * Host variables a spawned process needs to run at all (resolve executables,
 * find a home dir, decode text). Everything else — provider keys, JWT secret,
 * Redis URL — stays out of the child unless the definition names it in `env`.
 */
export const STDIO_EXEC_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot'] as const;

/**
 * The environment a stdio MCP child receives: the exec baseline plus the
 * ALREADY-RESOLVED declared values, minus loader/interpreter-steering keys.
 * Exported because this allowlist IS the isolation boundary. The SDK layers its
 * own small default set (HOME/PATH/…) underneath; no secret rides through it.
 * Credential decryption happens in the runner process (via
 * {@link McpCredentialResolver}) before this is called; the child only ever sees
 * resolved values, never the store or `ANT_ENCRYPTION_KEY`.
 */
export function buildStdioChildEnv(resolvedEnv: Record<string, string> | undefined): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of STDIO_EXEC_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }
  const safeDeclared: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolvedEnv ?? {})) {
    if (isForbiddenMcpEnvKey(key)) continue; // never let the tenant steer the pre-drop loader
    safeDeclared[key] = value;
  }
  return { ...base, ...safeDeclared };
}

export class McpConnectionManager {
  private clients = new Map<string, Client>();
  private tools: McpToolInfo[] = [];
  private connected = false;

  constructor(
    private readonly servers: Record<string, McpServerConfig>,
    private readonly resolver: McpCredentialResolver,
  ) {}

  /**
   * Resolve declared values: `${secret:KEY}` references go through the
   * encrypted store, everything else passes verbatim as authored plain text.
   * Shared by `env` (stdio child env) and `headers` (http request headers) —
   * one rule, and process.env is never consulted (a reference naming a host
   * secret resolves to a store miss, not a leak).
   */
  private async resolveCredentials(
    declared: Record<string, string> | undefined,
    field: 'env' | 'headers',
    serverName: string,
  ): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    for (const [key, declaredValue] of Object.entries(declared ?? {})) {
      const credentialKey = parseSecretRef(declaredValue);
      if (credentialKey === null) {
        resolved[key] = declaredValue;
        continue;
      }
      const value = await this.resolver.resolve(credentialKey);
      if (value === undefined) {
        throw new McpConfigError(
          `MCP server "${serverName}" ${field} "${key}" references credential key "${credentialKey}" which is not registered — ` +
            `register it via PUT /api/account/mcp-credentials (or the agent settings UI) before starting the job`,
          { serverName },
        );
      }
      resolved[key] = value;
    }
    return resolved;
  }

  /** Connect every declared server and collect its tool list. Fail-loud. */
  async connect(): Promise<void> {
    if (this.connected) return;
    for (const [serverName, cfg] of Object.entries(this.servers)) {
      const client = new Client({ name: 'ant-universal', version: '1.0.0' });
      let transport;
      if (cfg.transport === 'stdio') {
        // A stdio MCP server is arbitrary code execution. The SDK spawns it
        // internally with no uid/gid option, so — fail closed in cloud unless a
        // distinct child UID is configured (H-014), then re-exec under setpriv
        // so the child actually drops off the service UID (its /proc and the
        // shared credential store are otherwise readable by a same-UID child).
        assertUserCodeIsolationOrThrow(`mcp:stdio:${serverName}`);
        const wrapped = wrapCommandForChildIdentity(cfg.command!, cfg.args ?? []);
        transport = new StdioClientTransport({
          command: wrapped.command,
          args: wrapped.args,
          // Declared env ONLY (resolved from the encrypted store), plus the
          // minimum a process needs to execute. Never `...process.env` — that
          // handed every third-party server the host's full secret set (LLM
          // provider keys, JWT secret, Redis URL).
          env: buildStdioChildEnv(await this.resolveCredentials(cfg.env, 'env', serverName)),
        });
      } else {
        transport = new StreamableHTTPClientTransport(new URL(cfg.url!), {
          requestInit: { headers: await this.resolveCredentials(cfg.headers, 'headers', serverName) },
        });
      }

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
