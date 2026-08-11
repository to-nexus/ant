/**
 * Custom Agent / Custom Job definitions — BE↔FE contract.
 *
 * Custom agents are file-defined (`.ant/agents/{agentId}/`) groupings of
 * custom jobs (`jobs/{jobId}/`) that all execute through the single
 * `jobType='universal'` runtime. They never mint a new JobType — the job
 * reference travels as an opaque `{agentId}/{jobId}` composite key
 * (`customJobRef`) alongside `jobType: 'universal'`.
 *
 * Scope model (D8): definitions are account/org-owned, never project-owned.
 * They are discovered across an ordered list of scope roots; closer scopes
 * win id collisions (user > org > builtin). `org` is structurally reserved
 * from day one but only activated in Phase 3. `builtin` is the read-only
 * sample tree shipped with Ant. Pre-existing on-disk id collisions still
 * resolve by scope priority, but CREATING a new agent under an id any scope
 * already owns (builtin included) is refused with 409 — silent shadowing has
 * no UI story.
 */

/** Where a custom agent definition lives — determines ownership and editability. */
export type CustomAgentScope = 'user' | 'org' | 'builtin';

/** Scope priority for id collisions — earlier wins. */
export const CUSTOM_AGENT_SCOPE_PRIORITY: readonly CustomAgentScope[] = [
  'user',
  'org',
  'builtin',
];

/**
 * One intent declared in a job's `intents.yaml` catalog (job-only — mirrors
 * the canonical system where intents belong to jobs, never agents).
 * The catalog is code-exterior data: ids are a per-job runtime string
 * vocabulary — they never join the compile-time canonical `IntentId` union.
 */
export interface CustomIntentDef {
  /** {@link CUSTOM_ID_PATTERN}, unique within its file; `'general'` is reserved. */
  id: string;
  /** Classification matching criterion — rendered verbatim as a catalog row. */
  description: string;
  /** The job's `injections/*.md` filenames inlined in full while this intent is active. */
  injections?: string[];
}

/** Implicit fallback intent — reserved, never declarable, maps no injections. */
export const GENERAL_INTENT = 'general' as const;

/** The dedicated single-file intent catalog name (job dir only). */
export const INTENTS_FILE_NAME = 'intents.yaml' as const;

/**
 * Summary of one custom job inside an agent (chip label / catalog row).
 *
 * There is no `description`: the job shows its name only, and what the job is
 * plus how it works lives in `jobs/{jobId}/base/*.md` prose — the same single
 * authoring home `agent.yaml` already enforces for the agent's persona.
 */
export interface CustomJobSummary {
  /** {@link CUSTOM_ID_PATTERN}, equals the `jobs/{jobId}/` directory name. */
  id: string;
  /** UI chip label. */
  name: string;
  /**
   * Job intent catalog (`jobs/{jobId}/intents.yaml`) for `@intent:` mention
   * vocabulary and the settings tree. Filled by lenient discovery parsing —
   * omitted when the catalog fails to parse (fail-loud belongs to load/validate).
   */
  intents?: Pick<CustomIntentDef, 'id' | 'description'>[];
}

/** Summary of one custom agent and its jobs, as listed by the discovery API. */
export interface CustomAgentSummary {
  /** {@link CUSTOM_ID_PATTERN}, equals the `.ant/agents/{agentId}/` directory name. */
  id: string;
  name: string;
  /** Which scope root this definition was resolved from. */
  scope: CustomAgentScope;
  /** True when the scope forbids editing through the API (e.g. org members). */
  readonly: boolean;
  jobs: CustomJobSummary[];
}

/**
 * The constant pseudo-feature that rides the `:feature` slot for universal
 * (workspace) projects — canonical projects have real features; a workspace
 * has exactly one chat/session container at `{project}/universal`.
 */
export const UNIVERSAL_FEATURE = 'universal' as const;

/**
 * id charset for agentId / jobId / intentId / MCP server name — strict
 * kebab-case: `a-z0-9` segments joined by SINGLE hyphens, no leading or
 * trailing hyphen. agent and job ids are directory names, so a doubled or
 * dangling hyphen would be a legal directory that reads as a typo everywhere
 * it is echoed back (`@intent:` mentions, `{agentId}/{jobId}` refs).
 */
export const CUSTOM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Human-readable form of {@link CUSTOM_ID_PATTERN} for error copy. */
export const CUSTOM_ID_HINT = 'lowercase kebab-case (a-z, 0-9, single hyphens)';

export function isValidCustomId(id: string): boolean {
  return CUSTOM_ID_PATTERN.test(id);
}

/** Coerce free text (a display name) into a valid {@link CUSTOM_ID_PATTERN} id. */
export function toCustomId(text: string, maxLength = 40): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}

/**
 * MCP server connection declaration (secrets are credential *key names*, never
 * values — the value lives in the encrypted per-user credential store and is
 * registered via `PUT /api/account/mcp-credentials` or the settings UI).
 * Shared because the settings screen edits this shape structurally —
 * one type and ONE validator for the loader, the pre-write gate, and the form.
 */
export interface McpServerConfig {
  transport: 'stdio' | 'http';
  /** stdio: executable to spawn. */
  command?: string;
  args?: string[];
  /** stdio: map of child-env key → *credential key name* to resolve and forward. */
  env?: Record<string, string>;
  /** http: streamable HTTP endpoint. */
  url?: string;
  /**
   * http: map of request-header name → *credential key name* whose stored
   * value fills the header. The ONE authentication mechanism for HTTP MCP
   * servers (`Authorization`, `X-Api-Key`, …). Same key-name rule as
   * {@link McpServerConfig.env}, so a literal credential in the definition
   * file fails validation.
   */
  headers?: Record<string, string>;
}

export const MCP_TRANSPORTS = ['stdio', 'http'] as const;

/**
 * env/headers values name a credential key in the encrypted store — the
 * pattern that keeps secrets out of the file. (Same shape as an env-var name;
 * resolution never touches process.env.)
 */
export const MCP_ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** HTTP header names accepted in `headers` keys (RFC token subset). */
export const MCP_HEADER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Every rule the loader enforces, as plain messages. Empty = valid. Callers
 * decide the shape of the failure: the loader throws
 * `CustomAgentValidationError`, the HTTP gate answers 400, the form disables
 * saving.
 */
export function validateMcpServers(servers: Record<string, McpServerConfig> | undefined): string[] {
  const errors: string[] = [];
  for (const [name, cfg] of Object.entries(servers ?? {})) {
    if (!isValidCustomId(name)) {
      errors.push(`MCP server name "${name}" must be ${CUSTOM_ID_HINT}`);
    }
    if (cfg?.transport === 'stdio') {
      if (!cfg.command) errors.push(`MCP server "${name}": stdio transport requires "command"`);
      if (cfg.headers && Object.keys(cfg.headers).length > 0) {
        errors.push(`MCP server "${name}": "headers" applies to http transport only — stdio auth goes through "env"`);
      }
    } else if (cfg?.transport === 'http') {
      if (!cfg.url) errors.push(`MCP server "${name}": http transport requires "url"`);
    } else {
      errors.push(`MCP server "${name}": transport must be "stdio" | "http"`);
    }
    for (const [key, value] of Object.entries(cfg?.env ?? {})) {
      if (typeof value !== 'string' || !MCP_ENV_VAR_NAME_PATTERN.test(value)) {
        errors.push(
          `MCP server "${name}": env.${key} must name a credential KEY registered in the encrypted store (got: ${String(value)}) — secrets never live in the definition file`,
        );
      }
    }
    for (const [key, value] of Object.entries(cfg?.headers ?? {})) {
      if (!MCP_HEADER_NAME_PATTERN.test(key)) {
        errors.push(`MCP server "${name}": headers."${key}" is not a valid HTTP header name`);
      }
      if (typeof value !== 'string' || !MCP_ENV_VAR_NAME_PATTERN.test(value)) {
        errors.push(
          `MCP server "${name}": headers.${key} must name a credential KEY registered in the encrypted store (got: ${String(value)}) — secrets never live in the definition file`,
        );
      }
    }
  }
  return errors;
}

/**
 * Composite reference `{agentId}/{jobId}` — the single value that flows
 * HTTP body → queue payload → `ANT_CUSTOM_JOB_REF` env → job-runner.
 */
export interface CustomJobRef {
  agentId: string;
  jobId: string;
}

export function formatCustomJobRef(ref: CustomJobRef): string {
  return `${ref.agentId}/${ref.jobId}`;
}

/** Returns null on malformed input — callers decide whether that is a 400 or a throw. */
export function parseCustomJobRef(raw: string | undefined | null): CustomJobRef | null {
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length !== 2) return null;
  const [agentId, jobId] = parts;
  if (!isValidCustomId(agentId) || !isValidCustomId(jobId)) return null;
  return { agentId, jobId };
}

/**
 * Explicit per-turn metadata for universal jobs — `@intent:` mentions
 * (multiple allowed, catalog-validated at accept) and `@ctx:` artifact paths
 * (existence-checked at accept). Applies to the mentioning run only; travels
 * HTTP body → queue payload → `ANT_UNIVERSAL_TURN_META` env (single JSON —
 * paths may contain commas, so never CSV) → job-runner.
 */
export interface UniversalTurnMeta {
  intents: string[];
  context: string[];
  /**
   * Per-turn plan-mode request (composer `@plan` mention) — this run produces
   * a plan document under `plan/`, not the work itself; the runtime confines
   * file writes to `plan/` for the turn.
   */
  plan?: boolean;
}

// ── Definition file surface (account-scoped agent settings API) ─────────────

/** One node of a custom agent definition file tree (agent settings screen). */
export interface CustomAgentDefinitionFileNode {
  name: string;
  /** Path relative to the agent dir (e.g. `jobs/research/base/system.md`). */
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: CustomAgentDefinitionFileNode[];
}

/** Result of validating a definition save (syntax gate + load dry-run). */
export interface DefinitionValidationResult {
  valid: boolean;
  /** Semantic errors from the `loadCustomJob` dry-run over affected jobs. */
  errors: string[];
}

/**
 * Composed-prompt preview for one job (`GET …/jobs/:jobId/prompt-preview`) —
 * the `<custom_job_instructions>` block exactly as the runtime injects it for
 * the given active intents, plus the partition of injection files.
 */
export interface CustomJobPromptPreview {
  agentId: string;
  jobId: string;
  /** Intent ids the preview was rendered with (empty = pre-classify TOC-only view). */
  activeIntents: string[];
  /** Assembled system block text. */
  system: string;
  /** Harness template paths that wrap the block (names only, not rendered). */
  harnessTemplates: string[];
  /** `injections/*.md` inlined in full for the given intents. */
  inlined: string[];
  /** `injections/*.md` left as TOC pointers. */
  toc: string[];
}

/**
 * Write whitelist for definition files — the single vocabulary of paths the
 * settings API may create or edit inside an agent dir:
 *   agent.yaml | base/*.md
 *   jobs/{jobId}/(job.yaml | intents.yaml | base/*.md | injections/*.md)
 * Intents and injections are job-only — agent-level `intents.yaml` and
 * `injections/` are legacy and rejected.
 */
export function isAllowedDefinitionPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  const MD_NAME = /^[^/]+\.md$/;
  const parts = normalized.split('/');
  if (parts.length === 1) return parts[0] === 'agent.yaml';
  if (parts.length === 2) {
    return parts[0] === 'base' && MD_NAME.test(parts[1]);
  }
  if (parts[0] !== 'jobs' || !isValidCustomId(parts[1])) return false;
  if (parts.length === 3) return parts[2] === 'job.yaml' || parts[2] === INTENTS_FILE_NAME;
  if (parts.length === 4) {
    return (parts[2] === 'base' || parts[2] === 'injections') && MD_NAME.test(parts[3]);
  }
  return false;
}
