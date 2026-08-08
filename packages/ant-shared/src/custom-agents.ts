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

/** Summary of one custom job inside an agent (chip label / tooltip / catalog row). */
export interface CustomJobSummary {
  /** `[a-z0-9-]+`, equals the `jobs/{jobId}/` directory name. */
  id: string;
  /** UI chip label. */
  name: string;
  /** Chip tooltip; Phase 2 triage catalog row. */
  description: string;
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
