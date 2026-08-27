/**
 * Custom agent / custom job definition types — BE-internal.
 *
 * The file layout (`.ant/agents/{agentId}/` ⊃ `jobs/{jobId}/`) is the D4
 * contract of the universal runtime. The agent contributes identity (name),
 * always-on `base/*.md` prose, and shared MCP connections; everything else —
 * tools and intents — is job-owned, mirroring the canonical system where tool
 * sets and intents belong to jobs. The BE↔FE summary types live in
 * `@ant/shared/custom-agents.ts`; this module owns the full parsed shapes the
 * loader and the runtime consume.
 */

import type { CustomAgentScope, CustomIntentDef, McpServerConfig, RestApiServerConfig } from '@ant/shared';

// The MCP/API shapes and their rules live in `@ant/shared` — the settings
// screen edits them structurally, so type and validator have one owner across BE↔FE.
export type { McpServerConfig, RestApiServerConfig };

export type ApprovalPolicy = 'always' | 'never';

/** Parsed `agent.yaml` — identity + shared MCP connections only. */
export interface CustomAgentYaml {
  id: string;
  name: string;
  version?: number;
  /** Shared connection config unioned into every member job (job wins on name collision). */
  mcp?: { servers?: Record<string, McpServerConfig> };
  /** Shared declared REST API connections, unioned like `mcp.servers`. */
  apis?: Record<string, RestApiServerConfig>;
  /**
   * Clarify-tool default for every member job. `false` declares the agent's
   * jobs autonomous/unattended (no blocking questions; proceed with
   * defaults). Job-level `clarify` wins over this.
   */
  clarify?: boolean;
}

/** Parsed `jobs/{jobId}/job.yaml`. */
export interface CustomJobYaml {
  id: string;
  name: string;
  version?: number;
  mcp?: { servers?: Record<string, McpServerConfig> };
  /** Declared REST API connections (job wins over agent on name collision). */
  apis?: Record<string, RestApiServerConfig>;
  tools?: {
    /** Builtin allowlist — validates directly against the universal preset. Absent ⇒ full preset. */
    builtin?: string[];
    approval?: Record<string, ApprovalPolicy>;
  };
  /**
   * Clarify-tool opt-out. `false` declares this job autonomous/unattended:
   * the agent never asks a blocking question and proceeds with defaults.
   * Wins over the agent-level default; active intents' `clarify` wins over
   * this. Default enabled.
   */
  clarify?: boolean;
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
  /**
   * Job intent catalog (`jobs/{jobId}/intents/{intentId}/`). Code-exterior
   * data — a per-job runtime vocabulary, never the compile-time `IntentId`
   * union. Empty = every turn runs as `general`.
   */
  intents: CustomIntentDef[];
  /**
   * `prompt.md` bodies of intents that have one, preloaded at job load — the
   * prompt builder never re-reads disk mid-job (same rule the retired
   * injections TOC bodies followed). Keyed by intent id.
   */
  intentPrompts: Record<string, string>;
  /** Union of MCP servers (job definition wins on name collision). */
  mcpServers: Record<string, McpServerConfig>;
  /** Union of declared REST API connections (job wins on name collision). */
  apiServers: Record<string, RestApiServerConfig>;
  /**
   * Definition-relative paths of `on-demand/` documents (agent-level +
   * this job's), collected at load. Rendered as a paths-only index in the
   * system block — never inlined (that is the whole point: progressive
   * disclosure for large API/domain specs, at zero prompt budget).
   */
  onDemandDocs: string[];
  /** Effective builtin allowlist (job ⊆ universal preset). */
  builtinTools: string[];
  /** Job-declared approval map; consult via requiresApproval(). */
  approval: Record<string, ApprovalPolicy>;
  /**
   * Effective clarify-tool default: `job.clarify ?? agent.clarify ?? true`.
   * Active intents that declare `clarify` override this per turn — see
   * `isClarifyEnabled` in universalToolPolicy.ts.
   */
  clarifyDefault: boolean;
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
