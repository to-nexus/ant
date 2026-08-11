/**
 * buildServer() — the heart a department copies and refills with its own
 * tools. Rules that must survive the copy:
 *
 * - `registerTool` only (`server.tool()` is deprecated in SDK 1.30).
 * - `inputSchema` is a flat ZodRawShape (plain object of zod fields, NOT
 *   z.object()) — the SDK validates each call and rejects violations as
 *   JSON-RPC -32602 before the handler runs.
 * - `annotations` pass through tools/list verbatim. Ant treats
 *   `readOnlyHint: true` as "no approval needed"; a WRITE-shaped tool must
 *   NOT carry annotations (Ant then fail-closes until the job author
 *   declares `approval: never` for it).
 * - HTTP mode builds a fresh server per request (stateless transports
 *   cannot be reused in SDK 1.30) — keep this factory cheap and stateless;
 *   shared state (e.g. the idempotency map) lives at module scope in
 *   tools.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResult } from './tools.js';
import { createIncident, debugEnv, getSlaMetrics, listIncidents } from './tools.js';
import { log } from './log.js';

export const SERVER_INFO = { name: 'ops-reference', version: '0.1.0' } as const;

function timed<A extends object>(tool: string, fn: (args: A) => ToolResult) {
  return async (args: A) => {
    const startedAt = performance.now();
    try {
      const result = fn(args);
      log('tool_call', { tool, ok: !result.isError, ms: Math.round(performance.now() - startedAt) });
      return result;
    } catch (err) {
      log('tool_call', { tool, ok: false, ms: Math.round(performance.now() - startedAt) });
      return {
        content: [
          {
            type: 'text' as const,
            text: `The ${tool} tool failed unexpectedly: ${err instanceof Error ? err.message : String(err)}.`,
          },
        ],
        isError: true,
      };
    }
  };
}

export function buildServer(opts: { debugEnvEnabled: boolean }): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'list_incidents',
    {
      description:
        'List operational incidents opened within a time window, newest data is fixture-stable. ' +
        'Returns at most 20 rows per page with total/has_more for paging.',
      inputSchema: {
        since: z.enum(['7d', '30d']).describe('How far back to look'),
        status: z.enum(['open', 'acknowledged', 'resolved']).optional().describe('Filter by lifecycle status'),
        page: z.number().int().min(1).optional().describe('1-based page number (default 1)'),
      },
      annotations: { readOnlyHint: true },
    },
    timed('list_incidents', listIncidents),
  );

  server.registerTool(
    'get_sla_metrics',
    {
      description:
        'Service-level metrics (availability, MTTA, MTTR, severity breakdown, SLO breaches) for a period. ' +
        'Incident counts always agree with list_incidents over the same window.',
      inputSchema: {
        period: z.enum(['7d', '30d', '90d']).describe('Reporting period'),
      },
      annotations: { readOnlyHint: true },
    },
    timed('get_sla_metrics', getSlaMetrics),
  );

  // Deliberately NO annotations key: Ant must fail-close on this tool until
  // the job author declares approval explicitly. Do not "fix" by adding one.
  server.registerTool(
    'create_incident',
    {
      description:
        'Create an incident record. Fixture server: echoes the would-be record, persists nothing. ' +
        'Requires an idempotency_key (>=8 chars); replays with the same key return the same id. ' +
        'dry_run defaults to true.',
      inputSchema: {
        title: z.string().min(1).describe('Incident title'),
        severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Severity classification'),
        idempotency_key: z.string().min(8).describe('Caller-chosen replay-dedup key (>=8 chars)'),
        dry_run: z.boolean().optional().describe('Default true — echo without recording'),
      },
    },
    timed('create_incident', createIncident),
  );

  if (opts.debugEnvEnabled) {
    server.registerTool(
      'debug_env',
      {
        description:
          'List the environment variable NAMES visible to this server process (never their values). ' +
          'Registered only when SKELETON_DEBUG_ENV=1 — E2E env-isolation checks only.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      timed('debug_env', debugEnv),
    );
  }

  return server;
}
