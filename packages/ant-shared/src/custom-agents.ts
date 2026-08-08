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
 * sample tree shipped with Ant — lowest priority, so any writable scope
 * shadows it wholesale.
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
 * One intent declared in an `intents.yaml` catalog (agent-shared or per-job).
 * The catalog is code-exterior data: ids are a per-job runtime string
 * vocabulary — they never join the compile-time canonical `IntentId` union.
 */
export interface CustomIntentDef {
  /** `[a-z0-9][a-z0-9-]*`, unique within its file; `'general'` is reserved. */
  id: string;
  /** Classification matching criterion — rendered verbatim as a catalog row. */
  description: string;
  /** `injections/*.md` filenames inlined in full while this intent is active. */
  injections?: string[];
}

/** Implicit fallback intent — reserved, never declarable, maps no injections. */
export const GENERAL_INTENT = 'general' as const;

/** The dedicated single-file intent catalog name (agent root and job dir). */
export const INTENTS_FILE_NAME = 'intents.yaml' as const;

/** Summary of one custom job inside an agent (chip label / tooltip / catalog row). */
export interface CustomJobSummary {
  /** `[a-z0-9-]+`, equals the `jobs/{jobId}/` directory name. */
  id: string;
  /** UI chip label. */
  name: string;
  /** Chip tooltip; Phase 2 triage catalog row. */
  description: string;
  /**
   * Merged intent catalog (agent ∪ job, job wins) for `@intent:` mention
   * vocabulary. Filled by lenient discovery parsing — omitted when the
   * catalog fails to parse (fail-loud belongs to load/validate).
   */
  intents?: Pick<CustomIntentDef, 'id' | 'description'>[];
}

/** Summary of one custom agent and its jobs, as listed by the discovery API. */
export interface CustomAgentSummary {
  /** `[a-z0-9-]+`, equals the `.ant/agents/{agentId}/` directory name. */
  id: string;
  name: string;
  description: string;
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

/** id charset for both agentId and jobId (must equal the directory name). */
export const CUSTOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidCustomId(id: string): boolean {
  return CUSTOM_ID_PATTERN.test(id);
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
 * Write whitelist for definition files — the single vocabulary of paths the
 * settings API may create or edit inside an agent dir:
 *   agent.yaml | intents.yaml | base/*.md | injections/*.md
 *   jobs/{jobId}/(job.yaml | intents.yaml | base/*.md | injections/*.md)
 */
export function isAllowedDefinitionPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  const MD_NAME = /^[^/]+\.md$/;
  const parts = normalized.split('/');
  if (parts.length === 1) return parts[0] === 'agent.yaml' || parts[0] === INTENTS_FILE_NAME;
  if (parts.length === 2) {
    return (parts[0] === 'base' || parts[0] === 'injections') && MD_NAME.test(parts[1]);
  }
  if (parts[0] !== 'jobs' || !isValidCustomId(parts[1])) return false;
  if (parts.length === 3) return parts[2] === 'job.yaml' || parts[2] === INTENTS_FILE_NAME;
  if (parts.length === 4) {
    return (parts[2] === 'base' || parts[2] === 'injections') && MD_NAME.test(parts[3]);
  }
  return false;
}
