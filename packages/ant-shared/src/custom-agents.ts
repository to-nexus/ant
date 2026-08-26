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
 * One intent of a job's catalog — declared as its own directory
 * `jobs/{jobId}/intents/{intentId}/` holding `infer.md` (REQUIRED — optional
 * `clarify` frontmatter + prose body = the inference criterion), an optional
 * `prompt.md` (prose inlined while the intent is active), and an optional
 * `hooks.yaml` (job-only — mirrors the canonical system where intents belong
 * to jobs, never agents).
 * The catalog is code-exterior data: ids are a per-job runtime string
 * vocabulary — they never join the compile-time canonical `IntentId` union.
 */
export interface CustomIntentDef {
  /** {@link CUSTOM_ID_PATTERN} — IS the `intents/{intentId}/` directory name (never declared in a file); `'general'` is reserved. */
  id: string;
  /**
   * Inference criterion — the `infer.md` prose body, rendered into the Intent
   * Catalog every turn as `applies when: …`.
   *
   * PROMPT TEXT, NOT UI COPY. It is never posted as a user message (a job
   * directive is minted from a localized template), never a chip or tab
   * subtitle, and never a job description. The field is deliberately NOT
   * called `description` — that name is what let it leak into all three.
   */
  infer: string;
  /**
   * Clarify-tool opt-out at intent granularity (`infer.md` frontmatter).
   * `false` declares turns under this intent autonomous/unattended: the agent
   * never asks a blocking question and proceeds with sensible defaults.
   * Omitted = inherit the job/agent default. When several active intents
   * declare the knob, disabled wins.
   */
  clarify?: boolean;
  /**
   * Stop-hook contract for turns under this intent: every declared entry
   * must hold at the turn's stop point (AND), verified deterministically by
   * the runtime from observed tool evidence. Unmet hooks bounce the agent a
   * bounded number of times, then end the turn as a resumable pause
   * (`universal_stop_hook_unmet`).
   */
  hooks?: IntentHooks;
  /** Whether `intents/{id}/prompt.md` exists with a non-blank body. */
  hasPrompt?: boolean;
}

/**
 * One stop-hook entry: a predicate the runtime verifies from tool
 * side-effects at the turn's stop point — never from LLM claims
 * (completion-signal = actual-write principle).
 *   - `artifact`: an artifact-root-relative glob (`*` = one segment,
 *     `**` = any depth) that a REAL file write this turn must match.
 *   - `action`: a tool name (universal preset builtin or full
 *     `mcp__{server}__{tool}`) that must have been SUCCESSFULLY called.
 * v2 reserves a `command` hook (author-defined verification command) — an
 * execution surface deferred by design; v1 hooks only observe evidence.
 */
export type IntentStopHook =
  | { artifact: string }
  | { action: string };

/** Cap on stop-hook entries per intent (all must hold — AND). */
export const INTENT_STOP_HOOKS_CAP = 8;

/**
 * Per-intent hook declarations, keyed by event. v1 supports only `stop`
 * (the turn's stop point); the event-keyed shape reserves schema room for
 * future events without breaking authored files.
 *
 * Hooks are PER-INTENT BY DESIGN — there is no job- or agent-level hook
 * declaration, and none should be added: a job-wide hook would bind the
 * reserved `general` (plain-conversation) turns, dragging chat turns into
 * bounce/pause loops, which is why the runtime's active-hook derivation
 * excludes `general` deliberately. A turn whose lane needs a contract pins
 * the intent explicitly (`@intent:` mention / `UniversalTurnMeta.intents`) —
 * there is no catalog default.
 */
export interface IntentHooks {
  stop: IntentStopHook[];
}

// ── stop-hook syntax validation (single rule set, BE loader + FE editor) ─────

/** Bounded length for artifact hook globs (H2). */
export const ARTIFACT_GLOB_MAX = 200;
/** Whole-pattern charset for artifact hook globs (H5). */
export const ARTIFACT_GLOB_CHARSET = /^[A-Za-z0-9._\-/*]+$/;
/** Full `mcp__{server}__{tool}` action name — same vocabulary as the approval map and the advertised tool list. */
export const MCP_ACTION_PATTERN = /^mcp__[a-z0-9]+(?:-[a-z0-9]+)*__[A-Za-z0-9_-]+$/;
/** Full `api__{server}__{get|request}` action name — the two tools synthesized per declared REST API. */
export const API_ACTION_PATTERN = /^api__[a-z0-9]+(?:-[a-z0-9]+)*__(?:get|request)$/;

export interface IntentHooksValidationOptions {
  /**
   * Predicate for H6's builtin-tool arm. The BE loader injects the universal
   * preset check. Callers without the preset list (e.g. a form validating a
   * draft) omit it, which DEFERS the builtin judgement: only names shaped as
   * mcp actions (`mcp__` prefix) are pattern-checked, everything else passes
   * and the authoritative save gate re-judges it.
   */
  isKnownBuiltinAction?: (name: string) => boolean;
}

/**
 * Validate + normalize one `hooks.stop` entry (the per-entry slice of H1–H6).
 * Returns the trimmed, key-canonical entry or an error message (no thrown
 * errors — the caller owns failure framing).
 */
export function validateStopHookEntry(
  entry: unknown,
  opts: IntentHooksValidationOptions = {},
): { normalized?: IntentStopHook; error?: string } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { error: 'hooks.stop entries must be mappings with exactly one of "artifact" | "action"' };
  }
  const keys = Object.keys(entry as Record<string, unknown>);
  const kindKeys = keys.filter((k) => k === 'artifact' || k === 'action');
  if (kindKeys.length !== 1 || keys.length !== 1) {
    return {
      error: `hooks.stop entry {${keys.join(', ')}} must carry exactly one of "artifact" | "action" and no other keys`,
    };
  }
  const kind = kindKeys[0] as 'artifact' | 'action';
  const value = (entry as Record<string, unknown>)[kind];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { error: `hooks.stop ${kind} must be a non-empty string` };
  }
  const v = value.trim();

  if (kind === 'artifact') {
    // H2 — bounded length.
    if (v.length > ARTIFACT_GLOB_MAX) {
      return { error: `hooks.stop artifact glob exceeds ${ARTIFACT_GLOB_MAX} chars` };
    }
    // H3 — posix relative path shape: no backslashes, no leading '/',
    // no empty/'.'/'..' segments (globs address the artifact root only).
    if (v.includes('\\')) {
      return { error: `hooks.stop artifact "${v}" must use posix separators (no backslashes)` };
    }
    if (v.startsWith('/')) {
      return { error: `hooks.stop artifact "${v}" must be relative to the artifact root (no leading /)` };
    }
    const segments = v.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) {
      return { error: `hooks.stop artifact "${v}" has an empty, "." or ".." path segment` };
    }
    // H5 — charset, and '**' only as a whole segment.
    if (!ARTIFACT_GLOB_CHARSET.test(v)) {
      return { error: `hooks.stop artifact "${v}" has characters outside [A-Za-z0-9._-/*]` };
    }
    if (segments.some((s) => s.includes('**') && s !== '**')) {
      return { error: `hooks.stop artifact "${v}": "**" must stand as a whole path segment` };
    }
    // H4 — sessions/ is not writable by tools, so the hook could never hold.
    if (segments[0] === 'sessions') {
      return {
        error: `hooks.stop artifact "${v}" targets sessions/ — a reserved, non-writable area (the hook could never be met)`,
      };
    }
    return { normalized: { artifact: v } };
  }

  // H6 — builtin from the universal preset, a full mcp__{server}__{tool}
  // name, or an api__{server}__{get|request} synthesized tool. `clarify` is a
  // control tool outside the preset, so it is naturally excluded. Without a
  // builtin predicate the judgement is deferred: only mcp/api-shaped names
  // are pattern-checked.
  if (opts.isKnownBuiltinAction) {
    if (!opts.isKnownBuiltinAction(v) && !MCP_ACTION_PATTERN.test(v) && !API_ACTION_PATTERN.test(v)) {
      return {
        error: `hooks.stop action "${v}" is neither a universal builtin tool, a full mcp__{server}__{tool} name, nor an api__{server}__{get|request} name`,
      };
    }
  } else if (v.startsWith('mcp__') && !MCP_ACTION_PATTERN.test(v)) {
    return { error: `hooks.stop action "${v}" is not a full mcp__{server}__{tool} name` };
  } else if (v.startsWith('api__') && !API_ACTION_PATTERN.test(v)) {
    return { error: `hooks.stop action "${v}" is not a full api__{server}__{get|request} name` };
  }
  return { normalized: { action: v } };
}

/**
 * Validate one intent's `hooks` declaration — the intra-file syntax rules
 * H1–H6 (cross-file satisfiability H7/H8 stays in the BE loader, which sees
 * the job's tool/MCP surface). Structural (H1) errors short-circuit; entry
 * errors are collected in declaration order, so `errors[0]` matches the old
 * fail-fast behaviour. `normalized` is present only when `errors` is empty.
 */
export function validateIntentHooks(
  raw: unknown,
  opts: IntentHooksValidationOptions = {},
): { normalized?: IntentHooks; errors: string[] } {
  // H1 — event-keyed mapping; only `stop` is a known event (unknown = error,
  // so an author immediately learns the knob does not exist).
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['hooks must be a mapping of event → entries (e.g. hooks: { stop: [...] })'] };
  }
  const events = Object.keys(raw as Record<string, unknown>);
  const unknownEvents = events.filter((e) => e !== 'stop');
  if (unknownEvents.length > 0) {
    return { errors: [`hooks declares unknown event(s) "${unknownEvents.join(', ')}" — only "stop" is supported`] };
  }
  const stop = (raw as Record<string, unknown>).stop;
  if (!Array.isArray(stop) || stop.length === 0) {
    return { errors: ['hooks.stop must be a non-empty list of hook entries'] };
  }
  if (stop.length > INTENT_STOP_HOOKS_CAP) {
    return { errors: [`hooks.stop has ${stop.length} entries — cap is ${INTENT_STOP_HOOKS_CAP}`] };
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const entries: IntentStopHook[] = [];
  for (const entry of stop as unknown[]) {
    const { normalized, error } = validateStopHookEntry(entry, opts);
    if (!normalized) {
      errors.push(error as string);
      continue;
    }
    const [kind, v] = 'artifact' in normalized ? ['artifact', normalized.artifact] : ['action', normalized.action];
    const dedupKey = `${kind}:${v}`;
    if (seen.has(dedupKey)) {
      errors.push(`hooks.stop declares duplicate entry ${dedupKey}`);
      continue;
    }
    seen.add(dedupKey);
    entries.push(normalized);
  }
  return errors.length > 0 ? { errors } : { normalized: { stop: entries }, errors: [] };
}

/** Implicit fallback intent — reserved, never declarable, maps no injections. */
export const GENERAL_INTENT = 'general' as const;

/** Per-job intent catalog directory (job dir only) — one subdirectory per intent. */
export const INTENTS_DIR_NAME = 'intents' as const;

/**
 * Required per-intent criterion file inside `intents/{intentId}/` — optional
 * YAML frontmatter (only `clarify: <bool>`) + prose body = the inference
 * criterion ("applies when"). The intent id is the directory name; no file
 * declares it.
 */
export const INTENT_INFER_FILE_NAME = 'infer.md' as const;

/** Optional per-intent prompt file — prose inlined while the intent is active. */
export const INTENT_PROMPT_FILE_NAME = 'prompt.md' as const;

/** Optional per-intent hook declaration file inside `intents/{intentId}/`. */
export const INTENT_HOOKS_FILE_NAME = 'hooks.yaml' as const;

/**
 * Split an optional leading `---` YAML frontmatter fence off a markdown doc.
 * Frontmatter exists iff the FIRST line is exactly `---`; it ends at the next
 * line that is exactly `---`. Returns the RAW (unparsed) frontmatter — YAML
 * parsing stays caller-side so this package keeps zero runtime deps.
 * `unterminated: true` when the fence opens but never closes (callers fail
 * loud). BE loader and FE editor MUST both consume this splitter so the same
 * bytes never parse two ways.
 */
export function splitFrontmatter(raw: string): { frontmatter: string | null; body: string; unterminated?: boolean } {
  if (!/^---\r?\n/.test(raw)) return { frontmatter: null, body: raw };
  const m = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!m) return { frontmatter: null, body: raw, unterminated: true };
  return { frontmatter: m[1] ?? '', body: raw.slice(m[0].length) };
}

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
   * Job intent catalog (`jobs/{jobId}/intents/{intentId}/`) for `@intent:`
   * mention vocabulary, the settings tree, and the actions-tab intent detail
   * (which needs the full defs — hooks, clarify, hasPrompt). Filled by
   * lenient discovery parsing — omitted when the catalog fails to parse
   * (fail-loud belongs to load/validate). Bounded: 32 intents × 8 hooks.
   */
  intents?: CustomIntentDef[];
}

/**
 * Caller-specific permissions carried only by scope-`org` agents that live in
 * a per-org ACL-governed root. Edit authority = agent owner (the promoter) ∨
 * delegated editor ∨ live org admin/owner role.
 */
export interface CustomAgentOrgPermissions {
  /** Promoter userId (email) — implicit editor, never removable. */
  owner?: string;
  /** owner ∨ editor ∨ org admin/owner (live role, never the JWT claim). */
  canEdit: boolean;
  /** owner ∨ org admin/owner — may manage the editors list. */
  canManageEditors: boolean;
  /** Delegated editor userIds — present only when `canManageEditors`. */
  editors?: string[];
}

/** Summary of one custom agent and its jobs, as listed by the discovery API. */
export interface CustomAgentSummary {
  /** {@link CUSTOM_ID_PATTERN}, equals the `.ant/agents/{agentId}/` directory name. */
  id: string;
  name: string;
  /** Which scope root this definition was resolved from. */
  scope: CustomAgentScope;
  /**
   * Effective editability FOR THE CALLING USER — org agents flip this per
   * caller (owner/editor/admin see false), builtin/env-dir stay true.
   */
  readonly: boolean;
  /** Per-caller org permissions — only on ACL-governed scope-`org` agents. */
  org?: CustomAgentOrgPermissions;
  jobs: CustomJobSummary[];
}

/**
 * The constant pseudo-feature that rides the `:feature` slot for universal
 * (workspace) projects — canonical projects have real features; a workspace
 * has exactly one chat/session container at `{project}/universal`.
 */
export const UNIVERSAL_FEATURE = 'universal' as const;

/**
 * Reserved top-level node in the universal artifacts tree — the grafted
 * pipeline run-log folder (BE grafts `{actRoot}/{projectId}/runs` under this
 * name; read-only on every mutation surface). BE↔FE name SSOT.
 */
export const UNIVERSAL_PIPELINE_RUNS_DIRNAME = 'pipeline-runs' as const;

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
 * MCP server connection declaration. env/header values are either plain text
 * (stored verbatim in the definition file) or a `${secret:KEY}` reference to
 * the encrypted per-user credential store (registered via
 * `PUT /api/account/mcp-credentials` or the settings UI) — the author declares
 * which, never a pattern guess. Shared because the settings screen edits this
 * shape structurally — one type and ONE validator for the loader, the
 * pre-write gate, and the form.
 */
export interface McpServerConfig {
  transport: 'stdio' | 'http';
  /** stdio: executable to spawn. */
  command?: string;
  args?: string[];
  /** stdio: map of child-env key → literal value or `${secret:KEY}` reference. */
  env?: Record<string, string>;
  /** http: streamable HTTP endpoint. */
  url?: string;
  /**
   * http: map of request-header name → literal value or `${secret:KEY}`
   * reference whose stored value fills the header (`Authorization`,
   * `X-Api-Key`, …). Same value rule as {@link McpServerConfig.env}, so a
   * literal secret only ends up in the definition file if the author
   * explicitly chose plain text.
   */
  headers?: Record<string, string>;
}

export const MCP_TRANSPORTS = ['stdio', 'http'] as const;

/**
 * Shape of a credential KEY inside a `${secret:KEY}` reference. (Same shape
 * as an env-var name; resolution never touches process.env.)
 */
export const MCP_ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * The ONE marker that turns an env/header value into a credential-store
 * lookup. Anything else is a literal. Explicit by design: credential-ness is
 * authored, never inferred from the value's shape.
 */
export const MCP_SECRET_REF_PATTERN = /^\$\{secret:([A-Z][A-Z0-9_]*)\}$/;

/** Returns the credential key when `value` is a `${secret:KEY}` reference, else null. */
export function parseSecretRef(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  return MCP_SECRET_REF_PATTERN.exec(value)?.[1] ?? null;
}

export function formatSecretRef(key: string): string {
  return `\${secret:${key}}`;
}

/** HTTP header names accepted in `headers` keys (RFC token subset). */
export const MCP_HEADER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** Env-var NAME shape accepted as a stdio MCP `env` key. */
export const MCP_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Env names refused on an MCP `env`: they steer a dynamic loader or interpreter
 * and so run attacker-chosen code inside the UID-drop launcher BEFORE it drops
 * off the service identity (H-014). Any `LD_*` / `DYLD_*` is refused by prefix;
 * the set below covers the node/shell/python launchers. The stdio child-env
 * assembler strips the same keys as a second line of defense.
 */
export const MCP_FORBIDDEN_ENV_KEYS = new Set([
  'NODE_OPTIONS', 'BASH_ENV', 'ENV', 'PYTHONSTARTUP', 'GCONV_PATH',
]);

/** True when `key` may hijack the pre-drop launcher and must be refused on MCP `env`. */
export function isForbiddenMcpEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.startsWith('LD_') || upper.startsWith('DYLD_') || MCP_FORBIDDEN_ENV_KEYS.has(upper);
}

/**
 * One rule for env and headers on BOTH declaration channels (`mcp.servers`
 * and `apis`): `${secret:KEY}` reference or non-empty literal. Pushes
 * messages onto `errors`; `label` names the declaring channel.
 */
function checkSecretableValue(errors: string[], label: string, name: string, slot: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} "${name}": ${slot} must be a non-empty string (got: ${String(value)})`);
    return;
  }
  if (MCP_SECRET_REF_PATTERN.test(value)) return;
  if (value.startsWith('${secret:')) {
    errors.push(
      `${label} "${name}": ${slot} looks like a credential reference but is malformed — use \${secret:KEY} with KEY matching ${String(MCP_ENV_VAR_NAME_PATTERN)}`,
    );
  }
}

/**
 * Every rule the loader enforces, as plain messages. Empty = valid. Callers
 * decide the shape of the failure: the loader throws
 * `CustomAgentValidationError`, the HTTP gate answers 400, the form disables
 * saving.
 */
export function validateMcpServers(servers: Record<string, McpServerConfig> | undefined): string[] {
  const errors: string[] = [];
  const checkValue = (name: string, slot: string, value: unknown): void =>
    checkSecretableValue(errors, 'MCP server', name, slot, value);
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
      if (!MCP_ENV_KEY_PATTERN.test(key)) {
        errors.push(`MCP server "${name}": env key "${key}" is not a valid environment variable name`);
      } else if (isForbiddenMcpEnvKey(key)) {
        errors.push(
          `MCP server "${name}": env key "${key}" is not allowed — loader/interpreter variables ` +
          `(LD_*, DYLD_*, NODE_OPTIONS, …) can run code in the launcher before the privilege drop`,
        );
      }
      checkValue(name, `env.${key}`, value);
    }
    for (const [key, value] of Object.entries(cfg?.headers ?? {})) {
      if (!MCP_HEADER_NAME_PATTERN.test(key)) {
        errors.push(`MCP server "${name}": headers."${key}" is not a valid HTTP header name`);
      }
      checkValue(name, `headers.${key}`, value);
    }
  }
  return errors;
}

// ── Declared REST API connections (`apis`) ──────────────────────────────────

/**
 * One declared REST API connection — the SECOND capability-extension channel
 * next to `mcp.servers`, for systems that speak plain HTTP and have no MCP
 * server (legacy ERP, internal REST services). The declaration carries
 * connectivity ONLY (where + as-whom + optionally how-far); the API's
 * knowledge (endpoints, fields, call sequences) is prose — intent prompt.md
 * and `reference/` files — that the model reads and composes calls from.
 *
 * The runtime synthesizes two generic tools per entry, in-process (no child
 * process, no MCP handshake): `api__{name}__get` (GET/HEAD, read-only,
 * approval-exempt) and `api__{name}__request` (writes, fail-closed approval).
 */
export interface RestApiServerConfig {
  /** Absolute http(s) base URL. A path prefix is allowed; query/fragment are not. */
  baseUrl: string;
  /**
   * Request-header name → literal value or `${secret:KEY}` reference — the
   * single auth mechanism, same value rule as {@link McpServerConfig.headers}.
   * Resolved values are injected at request time and never enter the model's
   * context; per-call headers may not override a declared name.
   */
  headers?: Record<string, string>;
  /**
   * Optional method+path scope, one rule per line: `METHOD PATTERN` (see
   * {@link parseRestAllowLine}). Absent = every method+path under baseUrl
   * (reads free, writes behind the approval gate as usual). Enforced
   * mechanically in the executor before any request is sent.
   */
  allow?: string[];
}

export const REST_ALLOW_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', '*'] as const;
export type RestAllowMethod = (typeof REST_ALLOW_METHODS)[number];

export interface RestAllowRule {
  method: RestAllowMethod;
  /** `*` (any path) or a `/`-rooted pattern: literal segments, `*` (one segment), `**` (any suffix). */
  pattern: string;
}

/**
 * Parse one allow line — `METHOD SP PATTERN`. Returns the rule or an error
 * message (string). The single grammar for the validator, the executor, and
 * the settings form. `GET` implies `HEAD` at match time.
 */
export function parseRestAllowLine(line: unknown): RestAllowRule | string {
  if (typeof line !== 'string' || line.trim() === '') {
    return 'allow rule must be a non-empty string "METHOD PATTERN" (e.g. "GET *", "POST /vouchers/**")';
  }
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 2) {
    return `allow rule "${line.trim()}" must be exactly "METHOD PATTERN" (e.g. "GET *", "POST /vouchers/**")`;
  }
  const method = parts[0].toUpperCase();
  const pattern = parts[1];
  if (!(REST_ALLOW_METHODS as readonly string[]).includes(method)) {
    return `allow rule "${line.trim()}": method must be one of ${REST_ALLOW_METHODS.join(', ')}`;
  }
  if (pattern !== '*') {
    if (!pattern.startsWith('/') || pattern.startsWith('//')) {
      return `allow rule "${line.trim()}": pattern must be "*" or a /-rooted path (relative to baseUrl)`;
    }
    const segments = pattern.slice(1).split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '.' || seg === '..') {
        return `allow rule "${line.trim()}": pattern has an empty, "." or ".." segment`;
      }
      if (/\s/.test(seg)) {
        return `allow rule "${line.trim()}": pattern segments must not contain whitespace`;
      }
      if (seg.includes('*') && seg !== '*' && seg !== '**') {
        return `allow rule "${line.trim()}": "*" and "**" must stand as whole path segments`;
      }
    }
  }
  return { method: method as RestAllowMethod, pattern };
}

/**
 * Every rule for the `apis` map, as plain messages (same three-failure-shape
 * contract as {@link validateMcpServers}: loader throw / HTTP 400 / form
 * disable). Keys that belong to MCP transports are rejected so an entry
 * pasted into the wrong channel fails loud instead of half-working.
 */
export function validateApiServers(servers: Record<string, RestApiServerConfig> | undefined): string[] {
  const errors: string[] = [];
  for (const [name, cfg] of Object.entries(servers ?? {})) {
    if (!isValidCustomId(name)) {
      errors.push(`API server name "${name}" must be ${CUSTOM_ID_HINT}`);
    }
    for (const key of ['transport', 'command', 'args', 'env', 'url'] as const) {
      if ((cfg as unknown as Record<string, unknown> | null | undefined)?.[key] !== undefined) {
        errors.push(`API server "${name}": "${key}" belongs to mcp.servers — an apis entry declares baseUrl / headers / allow only`);
      }
    }
    if (typeof cfg?.baseUrl !== 'string' || cfg.baseUrl.trim() === '') {
      errors.push(`API server "${name}": "baseUrl" is required (absolute http(s) URL)`);
    } else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(cfg.baseUrl);
      } catch {
        errors.push(`API server "${name}": baseUrl "${cfg.baseUrl}" is not a valid absolute URL`);
      }
      if (parsed) {
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push(`API server "${name}": baseUrl must be http(s), got "${parsed.protocol}"`);
        }
        if (parsed.search !== '' || parsed.hash !== '') {
          errors.push(`API server "${name}": baseUrl must not carry a query string or fragment`);
        }
      }
    }
    for (const [key, value] of Object.entries(cfg?.headers ?? {})) {
      if (!MCP_HEADER_NAME_PATTERN.test(key)) {
        errors.push(`API server "${name}": headers."${key}" is not a valid HTTP header name`);
      }
      checkSecretableValue(errors, 'API server', name, `headers.${key}`, value);
    }
    if (cfg?.allow !== undefined) {
      if (!Array.isArray(cfg.allow) || cfg.allow.length === 0) {
        errors.push(`API server "${name}": "allow" must be a non-empty list of "METHOD PATTERN" rules (omit it to allow every path)`);
      } else {
        for (const line of cfg.allow) {
          const rule = parseRestAllowLine(line);
          if (typeof rule === 'string') errors.push(`API server "${name}": ${rule}`);
        }
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
 * Explicit per-turn metadata for universal jobs — the `@intent:` mention
 * (catalog-validated at accept) and `@ctx:` artifact paths (existence-checked
 * at accept). Applies to the mentioning run only; travels HTTP body → queue
 * payload → `ANT_UNIVERSAL_TURN_META` env (single JSON — paths may contain
 * commas, so never CSV) → job-runner.
 *
 * A run binds AT MOST ONE intent (the intent is the atomic unit of work and
 * the future schedule node); `intents` keeps the array shape for wire compat,
 * and the accept gate 400s (`multiple-intents`) on more than one distinct id.
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
 * the given active intents, plus the partition of intent prompt files.
 */
export interface CustomJobPromptPreview {
  agentId: string;
  jobId: string;
  /** Intent ids the preview was rendered with (empty = no active intents: catalog only, nothing inlined). */
  activeIntents: string[];
  /** Assembled system block text. */
  system: string;
  /** Harness template paths that wrap the block (names only, not rendered). */
  harnessTemplates: string[];
  /** Intent ids whose `prompt.md` is inlined in full for the given intents. */
  inlined: string[];
  /** Intent ids whose `prompt.md` is left as a read_file pointer. */
  toc: string[];
}

/**
 * Write whitelist for definition files — the single vocabulary of paths the
 * settings API may create or edit inside an agent dir:
 *   agent.yaml | base/*.md | reference/** (.md/.json, any depth)
 *   jobs/{jobId}/(job.yaml | base/*.md | reference/**)
 *   jobs/{jobId}/intents/{intentId}/(infer.md | prompt.md | hooks.yaml)
 * Intents are job-only. `reference/` holds API/domain documentation the agent
 * reads on demand via the read-only `_agent-definition/` mount (progressive
 * disclosure: intent prompt.md curates, reference files carry the full spec —
 * e.g. a vendor swagger dropped in verbatim). Legacy shapes are rejected with
 * move messages at the save gate: agent-level catalogs, the retired
 * single-file `jobs/{jobId}/intents.yaml`, per-intent `intent.yaml`, and the
 * retired `jobs/{jobId}/injections/` pool (each intent owns its prose as
 * prompt.md).
 */
export const REFERENCE_DIR_NAME = 'reference' as const;
export const REFERENCE_FILE_EXTENSIONS = ['.md', '.json'] as const;

function isReferenceFileName(name: string): boolean {
  return REFERENCE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext) && name.length > ext.length);
}

export function isAllowedDefinitionPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
  const MD_NAME = /^[^/]+\.md$/;
  const parts = normalized.split('/');
  if (parts[0] === REFERENCE_DIR_NAME && parts.length >= 2) {
    return isReferenceFileName(parts[parts.length - 1]);
  }
  if (parts.length === 1) return parts[0] === 'agent.yaml';
  if (parts.length === 2) {
    return parts[0] === 'base' && MD_NAME.test(parts[1]);
  }
  if (parts[0] !== 'jobs' || !isValidCustomId(parts[1])) return false;
  if (parts[2] === REFERENCE_DIR_NAME && parts.length >= 4) {
    return isReferenceFileName(parts[parts.length - 1]);
  }
  if (parts.length === 3) return parts[2] === 'job.yaml';
  if (parts.length === 4) {
    return parts[2] === 'base' && MD_NAME.test(parts[3]);
  }
  if (parts.length === 5) {
    return (
      parts[2] === INTENTS_DIR_NAME &&
      isValidCustomId(parts[3]) &&
      (parts[4] === INTENT_INFER_FILE_NAME || parts[4] === INTENT_PROMPT_FILE_NAME || parts[4] === INTENT_HOOKS_FILE_NAME)
    );
  }
  return false;
}

export type DefinitionDirKind =
  | 'agent-root'
  | 'agent-base'
  | 'jobs'
  | 'job'
  | 'job-base'
  | 'intents'
  | 'intent'
  | 'reference'
  | 'unknown';

/** Which directories the definition whitelist admits, by shape. */
export function classifyDefinitionDir(relPath: string): DefinitionDirKind {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalized === '') return 'agent-root';
  const parts = normalized.split('/');
  if (parts.some((seg) => seg === '' || seg === '.' || seg === '..')) return 'unknown';
  if (parts[0] === REFERENCE_DIR_NAME) return 'reference';
  if (parts.length === 1) return parts[0] === 'base' ? 'agent-base' : parts[0] === 'jobs' ? 'jobs' : 'unknown';
  if (parts[0] !== 'jobs' || !isValidCustomId(parts[1])) return 'unknown';
  if (parts[2] === REFERENCE_DIR_NAME) return 'reference';
  if (parts.length === 2) return 'job';
  if (parts.length === 3) {
    return parts[2] === 'base' ? 'job-base' : parts[2] === INTENTS_DIR_NAME ? 'intents' : 'unknown';
  }
  if (parts.length === 4) {
    return parts[2] === INTENTS_DIR_NAME && isValidCustomId(parts[3]) ? 'intent' : 'unknown';
  }
  return 'unknown';
}

/**
 * What a definition directory may hold — the create/upload counterpart of
 * {@link isAllowedDefinitionPath}. Sibling of `ArtifactDirPolicy`, not an
 * extension of it: fixed file names and custom-id children are not
 * expressible as extension rules.
 */
export interface DefinitionDirPolicy {
  kind: DefinitionDirKind;
  fixedFiles: string[];
  acceptedExtensions?: string[];
  fixedDirs: string[];
  customIdChild?: 'job' | 'intent';
}

export function getDefinitionDirPolicy(relPath: string): DefinitionDirPolicy {
  const kind = classifyDefinitionDir(relPath);
  switch (kind) {
    case 'agent-root':
      return { kind, fixedFiles: ['agent.yaml'], fixedDirs: ['base', 'jobs', REFERENCE_DIR_NAME] };
    case 'agent-base':
    case 'job-base':
      return { kind, fixedFiles: [], acceptedExtensions: ['.md'], fixedDirs: [] };
    case 'jobs':
      return { kind, fixedFiles: [], fixedDirs: [], customIdChild: 'job' };
    case 'job':
      return { kind, fixedFiles: ['job.yaml'], fixedDirs: ['base', INTENTS_DIR_NAME, REFERENCE_DIR_NAME] };
    case 'intents':
      return { kind, fixedFiles: [], fixedDirs: [], customIdChild: 'intent' };
    case 'intent':
      return {
        kind,
        fixedFiles: [INTENT_INFER_FILE_NAME, INTENT_PROMPT_FILE_NAME, INTENT_HOOKS_FILE_NAME],
        fixedDirs: [],
      };
    case 'reference':
      // Subdirectories are free-form (classifyDefinitionDir admits any depth
      // under reference/) — the policy lists no fixedDirs by design.
      return { kind, fixedFiles: [], acceptedExtensions: [...REFERENCE_FILE_EXTENSIONS], fixedDirs: [] };
    default:
      return { kind: 'unknown', fixedFiles: [], fixedDirs: [] };
  }
}

export function isAllowedDefinitionDir(relPath: string): boolean {
  return classifyDefinitionDir(relPath) !== 'unknown';
}
