/**
 * Custom agent / custom job definition types — BE-internal.
 *
 * The file layout (`.ant/agents/{agentId}/` ⊃ `jobs/{jobId}/`) is the D4
 * contract of the universal runtime. The agent contributes identity (name),
 * always-on `base/*.md` prose, and shared MCP connections; everything else —
 * tools, intents, injections — is job-owned, mirroring the canonical system
 * where tool sets and intents belong to jobs. The BE↔FE summary types live in
 * `@ant/shared/custom-agents.ts`; this module owns the full parsed shapes the
 * loader and the runtime consume.
 */

import type { CustomAgentScope, CustomIntentDef, McpServerConfig } from '@ant/shared';

// The MCP shape and its rules live in `@ant/shared` — the settings screen edits
// them structurally, so type and validator have one owner across BE↔FE.
export type { McpServerConfig };

export type ApprovalPolicy = 'always' | 'never';

/** Parsed `agent.yaml` — identity + shared MCP connections only. */
export interface CustomAgentYaml {
  id: string;
  name: string;
  version?: number;
  /** Shared connection config unioned into every member job (job wins on name collision). */
  mcp?: { servers?: Record<string, McpServerConfig> };
}

/** Parsed `jobs/{jobId}/job.yaml`. */
export interface CustomJobYaml {
  id: string;
  name: string;
  version?: number;
  mcp?: { servers?: Record<string, McpServerConfig> };
  tools?: {
    /** Builtin allowlist — validates directly against the universal preset. Absent ⇒ full preset. */
    builtin?: string[];
    approval?: Record<string, ApprovalPolicy>;
  };
}

/** One entry of the injections table of contents (body loaded on demand via read_file). */
export interface InjectionTocEntry {
  /** File name relative to the job's `injections/` dir. */
  file: string;
  /** First non-empty line of the file — the loader's one-line summary. */
  summary: string;
  /** Absolute path, for the read-only definition sandbox. */
  absolutePath: string;
  /** Intent ids that inline this file (reverse mapping from `intents.yaml`). */
  intents?: string[];
  /**
   * Full body, preloaded ONLY for intent-mapped entries — the loader already
   * reads the file for its summary, so this is free; the prompt builder must
   * never re-read the disk mid-job.
   */
  body?: string;
}

/**
 * The single immutable result of loading agent.yaml + job.yaml.
 * Everything downstream (prompt builder, tool node, respond node) reads this.
 */
export interface ResolvedCustomJob {
  agentId: string;
  jobId: string;
  scope: CustomAgentScope;
  agentName: string;
  jobName: string;
  /** Concatenated agent `base/*.md` + job `base/*.md` (capped, footer on truncation). */
  prose: string;
  /** The job's `injections/*.md` TOC. */
  injectionsToc: InjectionTocEntry[];
  /**
   * Job intent catalog (`jobs/{jobId}/intents.yaml`). Code-exterior data — a
   * per-job runtime vocabulary, never the compile-time `IntentId` union.
   * Empty = every turn runs as `general`, so all injections stay on the TOC.
   */
  intents: CustomIntentDef[];
  /** Union of MCP servers (job definition wins on name collision). */
  mcpServers: Record<string, McpServerConfig>;
  /** Effective builtin allowlist (job ⊆ universal preset). */
  builtinTools: string[];
  /** Job-declared approval map; consult via requiresApproval(). */
  approval: Record<string, ApprovalPolicy>;
  /** Absolute path of the agent definition dir — read-only sandbox root. */
  agentDir: string;
  /** Absolute path of the job definition dir. */
  jobDir: string;
}

/** Loader failure — surfaces as HTTP 400 at job-accept (fail-loud). */
export class CustomAgentValidationError extends Error {
  constructor(
    message: string,
    readonly agentId?: string,
    readonly jobId?: string,
  ) {
    super(message);
    this.name = 'CustomAgentValidationError';
  }
}
