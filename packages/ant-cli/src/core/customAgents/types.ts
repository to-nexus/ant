/**
 * Custom agent / custom job definition types — BE-internal.
 *
 * The file layout (`.ant/agents/{agentId}/` ⊃ `jobs/{jobId}/`) and the merge
 * rules (agent → job) are the D4 contract of the universal runtime. The
 * BE↔FE summary types live in `@ant/shared/custom-agents.ts`; this module
 * owns the full parsed shapes the loader and the runtime consume.
 */

import type { CustomAgentScope, CustomIntentDef } from '@ant/shared';

/** MCP server connection declaration (secrets are env-var *names*, never values). */
export interface McpServerConfig {
  transport: 'stdio' | 'http';
  /** stdio: executable to spawn. */
  command?: string;
  args?: string[];
  /** stdio: map of child-env key → *host env var name* to forward. */
  env?: Record<string, string>;
  /** http: streamable HTTP endpoint. */
  url?: string;
}

export type ApprovalPolicy = 'always' | 'never';

/** Output contract mode — `contract` declares artifact conventions, not existence. */
export type OutputsMode = 'none' | 'free' | 'contract';

export interface OutputArtifactContract {
  /** Vocabulary name injected into the prompt (e.g. `weekly-report`). */
  kind: string;
  /** Relative dir under `universal/artifacts/` (only `plan/` is reserved). */
  dir: string;
  /** Extension / format (e.g. `md`). */
  format: string;
  /** `llm` = model names the file; any other string = fixed pattern. */
  naming: string;
  /** `in-place` = edits target the existing artifact instead of minting new files. */
  update?: 'in-place' | 'new-file';
}

export interface OutputsContract {
  mode: OutputsMode;
  artifacts?: OutputArtifactContract[];
}

/** Canonical-plane access — read-only opt-in; writes are never allowed. */
export type WorkspaceAccess = 'none' | 'read';

/** Parsed `agent.yaml`. */
export interface CustomAgentYaml {
  id: string;
  name: string;
  description: string;
  version?: number;
  mcp?: { servers?: Record<string, McpServerConfig> };
  tools?: {
    /** Upper bound for member jobs' builtin tools. Absent ⇒ full universal preset. */
    builtin?: string[];
    approval?: Record<string, ApprovalPolicy>;
  };
  workspace?: WorkspaceAccess;
  models?: Record<string, string>;
}

/** Parsed `jobs/{jobId}/job.yaml`. */
export interface CustomJobYaml {
  id: string;
  name: string;
  description: string;
  version?: number;
  outputs?: OutputsContract;
  mcp?: { servers?: Record<string, McpServerConfig> };
  tools?: {
    /** Must be a subset of the agent's bound (which defaults to the full preset). */
    builtin?: string[];
    approval?: Record<string, ApprovalPolicy>;
  };
  workspace?: WorkspaceAccess;
  models?: Record<string, string>;
  /** Plan convention — gates the `plan/{agentId}/{jobId}` prompt section. */
  plan?: 'required' | 'suggested' | 'off';
}

/** One entry of the injections table of contents (body loaded on demand via read_file). */
export interface InjectionTocEntry {
  /** File name relative to its `injections/` dir. */
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
 * The single immutable result of loading + merging agent.yaml → job.yaml.
 * Everything downstream (prompt builder, tool node, respond node) reads this.
 */
export interface ResolvedCustomJob {
  agentId: string;
  jobId: string;
  scope: CustomAgentScope;
  agentName: string;
  jobName: string;
  description: string;
  /** Concatenated agent `base/*.md` + job `base/*.md` (capped, footer on truncation). */
  prose: string;
  /** Union of agent + job injections (job wins on filename collision). */
  injectionsToc: InjectionTocEntry[];
  /**
   * Merged intent catalog (agent ∪ job `intents.yaml`, job entry wins
   * wholesale). Code-exterior data — a per-job runtime vocabulary, never the
   * compile-time `IntentId` union. Empty = classify is skipped entirely.
   */
  intents: CustomIntentDef[];
  /** Union of MCP servers (job definition wins on name collision). */
  mcpServers: Record<string, McpServerConfig>;
  /** Effective builtin allowlist (job ⊆ agent ⊆ universal preset). */
  builtinTools: string[];
  /** Effective approval map — merged stricter-wins; consult via requiresApproval(). */
  approval: Record<string, ApprovalPolicy>;
  workspace: WorkspaceAccess;
  models: Record<string, string>;
  plan: 'required' | 'suggested' | 'off';
  outputs: OutputsContract;
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
