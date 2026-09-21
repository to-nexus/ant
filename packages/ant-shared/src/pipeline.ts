/**
 * Pipeline scheduling contract (BE↔FE) — file-defined pipelines that chain
 * universal (custom agent) job runs on a cron trigger with human approval
 * gates. Vocabulary: **Pipeline** = one YAML definition (trigger + step DAG),
 * **Run** = one firing of a pipeline, **Step** = one DAG node (a universal job
 * dispatch, or an approval gate that issues no job).
 *
 * The definition lives on disk (`.ant/pipelines/{id}/pipeline.yaml` under a
 * personal or org scope root, agents precedent — disk is SSOT); Redis holds
 * only rebuildable projections. A definition is a shareable scoped TEMPLATE:
 * it can be activated by many users onto many projects concurrently. The
 * ACTIVATION record is the scheduling unit and lives in the ACTIVATOR's
 * account (`.ant/pipeline-activations/{projectId}/activation.json`, absence =
 * deactivated) — one active pipeline per project, N activations per pipeline.
 * A definition also carries an AVAILABILITY sidecar (`availability.json`):
 * editing/deleting requires `disabled`, activating requires `enabled`, and
 * disabling requires zero live activations. This module is dependency-free by
 * package doctrine: structural validation only. Cron parsing / next-fire
 * computation is server-side (`core/pipelines/cron.ts`) — the FE never
 * computes cron locally, it round-trips `preview-fires`.
 *
 * `validatePipelineDef` follows the `validateMcpServers` precedent: every rule
 * as plain messages, empty = valid. Callers decide the failure shape — the
 * store throws, the HTTP gate answers 400, the editor form disables saving.
 */

import {
  parseCustomJobRef,
  isValidCustomId,
  validateArtifactGlob,
  restExternalConnectionErrors,
  GENERAL_INTENT,
  REST_EXTERNAL_CONNECTION_KEYS,
  UNIVERSAL_PIPELINES_DIRNAME,
} from './custom-agents';
import { DIRECTIVE_MAX_CHARS } from './session-log';
import type { CustomAgentOrgPermissions, RestApiExternalConfig } from './custom-agents';

/** Definition scope — agents precedent minus builtin (pipelines ship no samples). */
export type PipelineScope = 'user' | 'org';

/**
 * Per-caller org permission projection for org-scope pipelines — structurally
 * identical to the agent one on purpose (same ACL store, same role ladder).
 */
export type PipelineOrgPermissions = CustomAgentOrgPermissions;

// ============================================
// Definition (pipeline.yaml)
// ============================================

export const PIPELINE_FILE_NAME = 'pipeline.yaml';
export const PIPELINE_DEF_VERSION = 2;

/** Missed-fire policy: drop the stale fire, or run it once on recovery. */
export type PipelineOnMissed = 'skip' | 'runOnce';
/**
 * Overlap policy when a fire lands while a previous run is live. `queue`
 * re-arms the fire until the active run finishes. (`cancelPrevious` is a
 * reserved v2 value — the validator rejects it as not yet supported.)
 */
export type PipelineOverlap = 'skip' | 'queue';
export type StepFailurePolicy = 'abort' | 'continue';
/**
 * Edge condition against the `needs` outcomes. `verdict:<name>` matches when
 * a need SUCCEEDED with that sealed verdict (an outcome-declaring intent's
 * decision) — the switch semantics: non-matching branches skip and skips
 * cascade. `verdict:a|b` is the disjunction: it matches on ANY of the listed
 * outcomes, so a step owed to more than one arm needs neither replication
 * nor an unconditional escape.
 */
export type StepEdgeCondition = 'success' | 'failure' | 'always' | `verdict:${string}`;

export const VERDICT_EDGE_PATTERN = /^verdict:[a-z0-9][a-z0-9-]*(\|[a-z0-9][a-z0-9-]*)*$/;

/** The ONE shape test for an edge condition — step `on` and `on.upstream.when` share it. */
export function isStepEdgeCondition(value: unknown): value is StepEdgeCondition {
  return value === 'success' || value === 'failure' || value === 'always' || (typeof value === 'string' && VERDICT_EDGE_PATTERN.test(value));
}

/** The outcomes a `verdict:` edge names — the ONE parse site for the `a|b` disjunction form. */
export function verdictEdgeOutcomes(on: string): string[] {
  return on.slice('verdict:'.length).split('|');
}
export type GateTimeoutAction = 'reject' | 'approve';
/** v1 ships in-app only; `slack` / `email` are reserved channel kinds. */
export type PipelineApprovalChannel = 'inApp';

export interface PipelineScheduleTrigger {
  /** 5-field cron expression. Parsed server-side (cron-parser, = BullMQ's). */
  cron: string;
  /** IANA timezone (e.g. `Asia/Seoul`). Default: UTC. */
  tz?: string;
  onMissed?: PipelineOnMissed;
  overlap?: PipelineOverlap;
}

/**
 * Pipeline→pipeline edge: this pipeline's root hangs off ONE node of another
 * pipeline's runs (an activation of the SAME activator — identity never
 * crosses users). The node is a step (`step`) or, when omitted, the run's
 * seal judged as a node (completed → succeeded, failed / partial → failed,
 * cancelled → did not happen). `when` is the step-edge vocabulary — the same
 * predicate that routes edges inside a pipeline — so `failure` is the
 * error-workflow pattern and `verdict:<outcome>` follows a declared decision.
 * Non-occurrence (a skipped or cancelled node) never fires. A step node fires
 * at the step's terminal seal, mid-run. Chain depth is bounded
 * (MAX_CHAIN_DEPTH) against fire loops.
 */
export interface PipelineUpstreamTrigger {
  pipelineId: string;
  /** Step id in that pipeline. Absent = the run's seal. */
  step?: string;
  /** Default `success`. `verdict:*` needs `step` — a run seal carries no verdict. */
  when?: StepEdgeCondition;
  /** What an upstream fire does when this activation's slots are full. Default `skip`. */
  overlap?: PipelineOverlap;
}

/**
 * The upstream node that fired an event run — frozen at fire
 * (`{{trigger.upstream.*}}`, directive-only). `step` absent = the run's seal
 * was the node. `answer` is the step's captured answer cut at
 * PIPELINE_UPSTREAM_ANSWER_MAX_CHARS; it never rides the SSE wire.
 */
export interface PipelineRunUpstream {
  pipelineId: string;
  runId: string;
  projectId: string;
  step?: string;
  outcome: 'succeeded' | 'failed';
  verdict?: string;
  answer?: string;
}

/**
 * The connection an INLINE fetch trigger carries — the external `apis` shape
 * minus `allow` and `self`: the one declared `request` is its whole scope, and
 * a poll needs an external API. `${secret:KEY}` headers resolve from the
 * ACTIVATOR's credential store exactly as a job's `apis` headers do.
 */
export type PipelineFetchConnection = Pick<RestApiExternalConfig, 'baseUrl' | 'headers'>;

/** Label the poller compiles an inline connection under (`compileRestServer` names its server). */
export const PIPELINE_FETCH_INLINE_CONNECTION_NAME = 'fetch';

/**
 * Pull trigger: a DETERMINISTIC poller in the control plane (no LLM) calls a
 * REST connection — either a declared `apis` entry of one of the activator's
 * jobs (the BOUND form: the steps already reach that system) or the trigger's
 * own inline connection (the source is only a queue; declaring an `apis` entry
 * for it would hand a job's model tools it has no use for) — selects the items
 * of the response, and fires ONE run per not-yet-claimed item — the external
 * system is the queue, Ant keeps the claim ledger. Items are admitted only
 * while the activation has room under `concurrency`; an item left unclaimed is
 * simply seen again by the next poll (backpressure). `request` is trigger
 * CONFIGURATION (the cron expression's sibling) — it is never rendered to a
 * model and never becomes a tool, so the `apis` doctrine ("connectivity only,
 * knowledge is prose") is intact in both forms.
 */
export type PipelineFetchTrigger = PipelineFetchBoundTrigger | PipelineFetchInlineTrigger;

/** Bound form — the connection is a job's declared external `apis` entry. */
export interface PipelineFetchBoundTrigger extends PipelineFetchTriggerBase {
  /** `{agentId}/{jobId}` whose merged `apis` map names the connection — resolved in the ACTIVATOR's scope roots. */
  customJobRef: string;
  /** Connection name in that job's `apis` map. `self: true` entries are refused. */
  api: string;
  connection?: undefined;
}

/** Inline form — the trigger carries its own connection; no job is involved. */
export interface PipelineFetchInlineTrigger extends PipelineFetchTriggerBase {
  connection: PipelineFetchConnection;
  customJobRef?: undefined;
  api?: undefined;
}

export type PipelineFetchConnectionSource = 'bound' | 'inline';

/** The ONE discriminator of the two connection forms — validator, catalog binding, poller and editor all read it. */
export function fetchConnectionSource(trigger: Pick<PipelineFetchTrigger, 'connection'>): PipelineFetchConnectionSource {
  return trigger.connection !== undefined ? 'inline' : 'bound';
}

export interface PipelineFetchTriggerBase {
  request: {
    /** A poll READS: GET, or POST for search endpoints. Writes are refused. */
    method: 'GET' | 'POST';
    /** `/`-rooted, relative to the connection's baseUrl (same containment as the tools). */
    path: string;
    query?: Record<string, string | number | boolean>;
    /** POST only — JSON body. */
    body?: Record<string, unknown>;
  };
  /** Item-path from the response root to the item array (`$.issues`). */
  items: string;
  /** Item-path from each item to its dedupe key (`$.key`) — the run's case label. */
  key: string;
  /** name → item-path; each becomes `{{trigger.item.<name>}}` (directive-only). */
  fields?: Record<string, string>;
  /** Poll interval, `{n}m|h|d` (server floor `PipelineCaps.minFetchIntervalMinutes`). */
  every: string;
}

/** The claimed case a fetch-fired run carries — frozen at fire (`{{trigger.item.*}}`). */
export interface PipelineRunItem {
  key: string;
  fields?: Record<string, string>;
}

/**
 * Last poll of a fetch activation — TELEMETRY the view surfaces, never a
 * judgment input (the poller re-derives everything from the source + ledger).
 */
export interface PipelineFetchStatus {
  polledAt: string;
  /** Items the response carried (after key filtering). */
  seen: number;
  /** Items not yet claimed at poll time. */
  unclaimed: number;
  /** Items handed to the fire path by this poll. */
  enqueued: number;
  /** Set when the poll ended without a usable response (status line / policy reason — never a body). */
  error?: string;
  /** True for a Poll-now. */
  manual?: boolean;
}

/**
 * A BOUNDED view of a polled response — what the editor's "fetch the response"
 * shows so an author can pick `items` / `key` / field paths by clicking, instead
 * of guessing them. Never the whole body: arrays keep their first few elements
 * (`total` says how many there were), objects their first keys (`more` counts
 * the rest), strings are cut. Produced only by the preview route; the poller
 * never materialises it.
 */
export type PipelineFetchSampleNode =
  | { t: 'obj'; entries: Array<[string, PipelineFetchSampleNode]>; more: number }
  | { t: 'arr'; items: PipelineFetchSampleNode[]; total: number }
  | { t: 'str'; v: string; cut: boolean }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'null' };

/**
 * `POST /definitions/pipelines/preview-fetch` — the editor's dry run with the
 * CALLER's credentials (no claim, no fire). `ok` is the REQUEST: connection,
 * request and JSON body all worked, and `sample` is the response. `mapping` is
 * the SELECTION: whether `items` / `key` / `fields` selected anything — an
 * author fills those by reading the sample, so a bad selection must not hide
 * the response it needs to fix it.
 */
export interface PipelineFetchPreview {
  ok: boolean;
  /** Request-side failure — status line or policy reason, never a body. */
  error?: string;
  sample?: PipelineFetchSampleNode;
  mapping?: { ok: boolean; error?: string };
  items: Array<PipelineRunItem & { claimed: boolean }>;
  seen: number;
  skipped: number;
}

export interface JobStepDef {
  id: string;
  /** `{agentId}/{jobId}` — cross-agent chaining is the point. */
  customJobRef: string;
  /** 0..1 intent pinned at registration time — never runtime-classified. */
  intent?: string;
  /**
   * Work statement for the run. Template vars: see PIPELINE_TEMPLATE_VARS.
   * Optional — omitted/empty means the dispatcher synthesizes
   * `defaultStepDirective(intent)` at fire time.
   */
  directive?: string;
  /**
   * `@ctx` pins — container-relative artifact paths or artifact globs
   * (`hooks.stop` glob vocabulary). Globs address the artifacts root only and
   * are expanded into concrete paths at dispatch; concrete paths are
   * existence-checked at dispatch.
   */
  context?: string[];
  /** Upstream step ids. Omitted = the previous step in file order. */
  needs?: string[];
  on?: StepEdgeCondition;
  /**
   * Coordinator-level re-dispatch on a RETRYABLE failure (job failure, infra
   * interruption, enqueue failure, step timeout) — never on standing failures
   * (approval/membership/credits/definition). BullMQ `ant-jobs` stays
   * `attempts: 1`; each round is a NEW jobId dispatched with a retry preamble.
   * A retried step's intent must be re-entrant (check state before acting) —
   * the runs may have completed side effects before failing.
   */
  retry?: { max: number; backoff?: string };
  /**
   * Wall-clock bound for one job round (`{n}m|h|d`). On expiry the job is
   * killed and the step FAILS (`on: failure` consumes it; retry composes).
   * Cleared while the step awaits a clarify answer — human waits stay
   * open-ended by doctrine.
   */
  timeout?: { after: string };
  /**
   * When the pinned intent declares an outcomes vocabulary but the job sealed
   * no valid verdict: `'fail'` (default — loud, retryable) or the outcome
   * name to assume. Meaningless without an outcome-declaring intent.
   */
  onMissingVerdict?: string;
  /**
   * This step's turn DISCOVERS cases: its sealed `<cases>` list fans the
   * steps downstream of it out into one independent run per case (the same
   * per-item run a fetch trigger fires — same claim ledger, same
   * `{{trigger.item.*}}` channel). At most one step per definition declares
   * it; HOW the cases are found is never declared — that is the agent's
   * definition and this step's directive.
   */
  discovers?: StepDiscoveryDef;
}

/**
 * Fan-out contract of a discovering step. `fields` is a VOCABULARY, not a
 * mechanism — the names the per-case directives may reference (`outcomes`
 * frontmatter precedent: the validator needs it, the model reads it from the
 * prompt band and fills it). `key` is always carried and never declared.
 */
export interface StepDiscoveryDef {
  fields?: string[];
  /** The turn sealed no `<cases>` tag at all: `'fail'` (default — loud, retryable) or `'complete'` (nothing to do this run). */
  onMissing?: StepDiscoveryMissingPolicy;
}

export type StepDiscoveryMissingPolicy = 'fail' | 'complete';

export interface ApprovalStepDef {
  id: string;
  type: 'approval';
  prompt: string;
  needs?: string[];
  on?: StepEdgeCondition;
  channels?: PipelineApprovalChannel[];
  timeout?: {
    /** Duration literal `{n}m|h|d` (e.g. `24h`). */
    after: string;
    onTimeout: GateTimeoutAction;
  };
  /**
   * Re-surface an unresolved gate every `{n}m|h|d`: the approvalRequested SSE
   * re-fires and a reminder notice lands on the anchor turn (bounded rounds).
   */
  remindAfter?: string;
}

export type PipelineStepDef = JobStepDef | ApprovalStepDef;

export function isApprovalStep(step: PipelineStepDef): step is ApprovalStepDef {
  return (step as ApprovalStepDef).type === 'approval';
}

export interface PipelineDef {
  version: typeof PIPELINE_DEF_VERSION;
  name: string;
  /**
   * Trigger block. ABSENT = manual-only: the pipeline fires only via run-now
   * (the same fire path — activation, overlap and caps gates unchanged).
   * When declared it must carry at least one trigger; `schedule` and
   * `upstream` may coexist. `fetch` stands alone in v1 — a polled
   * activation fires per item, never on a clock or an upstream node.
   */
  on?: { schedule?: PipelineScheduleTrigger; upstream?: PipelineUpstreamTrigger; fetch?: PipelineFetchTrigger };
  /**
   * Live runs one ACTIVATION may hold at once — the per-activation slot cap the
   * fire path reserves against, whatever fired (run-now, cron, chain, fetch).
   * Read only through {@link resolveRunConcurrency}. Absent = 1; the validator
   * bounds it by `PipelineCaps.maxLiveRunsPerActivation`. Runs of one
   * activation are independent (own session file, gates, timeline); the
   * `{{run.prevSuccess.*}}` watermark is the only cross-run channel and races
   * under N > 1 (save advisory `prev-success-under-concurrency`).
   */
  concurrency?: number;
  defaults?: { onStepFailure?: StepFailurePolicy };
  steps: PipelineStepDef[];
  /**
   * Advisories the author judged by-design, with the reason. Authoring
   * information, so it travels with the definition (promote / download /
   * import), never a sidecar. An entry that no longer fires is `stale`
   * in {@link resolvePipelineAdvisories} — cleanup, never a gate.
   */
  acknowledged?: PipelineAcknowledgement[];
}

/** One acknowledged advisory: `(code, step)` is the identity the resolver matches on. */
export interface PipelineAcknowledgement {
  code: PipelineAdvisoryCode;
  step: string;
  /** Why this shape is right for this flow — non-empty; a reason that merely restates the finding is a review finding, not a validator error. */
  reason: string;
}

// ============================================
// Availability (availability.json sidecar) — the definition state machine
// ============================================

export const PIPELINE_AVAILABILITY_FILE_NAME = 'availability.json';

/**
 * `enabled` gates ACTIVATABILITY, not execution: editing/deleting/promoting a
 * definition requires `disabled`, activating requires `enabled`, and disabling
 * requires zero live activations (never cascaded, never force-deactivated —
 * holders deactivate themselves). A missing sidecar reads as disabled (draft),
 * so a definition can never change while any activation exists.
 */
export interface PipelineAvailability {
  enabled: boolean;
  changedAt: string;
  changedBy?: string;
}

const AVAILABILITY_KEYS = ['enabled', 'changedAt', 'changedBy'];

/** Plain messages, empty = valid (validateMcpServers precedent). */
export function validatePipelineAvailability(raw: unknown): string[] {
  if (!isPlainObject(raw)) return ['availability must be an object'];
  const errors: string[] = [];
  errors.push(...unknownKeyErrors(raw, AVAILABILITY_KEYS, 'availability'));
  if (typeof raw.enabled !== 'boolean') {
    errors.push('availability.enabled must be a boolean');
  }
  if (typeof raw.changedAt !== 'string' || Number.isNaN(Date.parse(raw.changedAt))) {
    errors.push('availability.changedAt must be an ISO timestamp');
  }
  if (raw.changedBy !== undefined && typeof raw.changedBy !== 'string') {
    errors.push('availability.changedBy must be a string');
  }
  return errors;
}

/**
 * What a pipeline definition folder EXPORTS — the whitelist the download seam
 * admits, mirroring the agent definition whitelist.
 *
 * `owner.json` is deliberately absent. It carries the AUTHOR's account
 * coordinates (userId — an email in cloud — and organizationId), which a
 * downloaded archive would carry off the platform and into whoever the file is
 * shared with; it is authorship metadata, not definition, and it is re-written
 * from the caller's own identity whenever a definition is saved.
 */
/**
 * Byte budget for an UPLOADED `pipeline.yaml`.
 *
 * The import route carries file text in a JSON body, so it owns a field cap of
 * its own — an authenticated route is not a budgeted one. Sized far above any
 * definition the editor can produce (`maxStepsPerPipeline` is 20) and far below
 * anything that would cost the process real memory to parse.
 */
export const PIPELINE_YAML_MAX_BYTES = 128 * 1024;

export const PIPELINE_EXPORT_FILE_NAMES: readonly string[] = [
  PIPELINE_FILE_NAME,
  PIPELINE_AVAILABILITY_FILE_NAME,
];

export function isExportablePipelineFile(relPath: string): boolean {
  return PIPELINE_EXPORT_FILE_NAMES.includes(relPath.replace(/\\/g, '/'));
}

/** Does this path address the pipeline-definition mount at all? (prefix test only — see `isUniversalAgentRef`.) */
export function isUniversalPipelineRef(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized === UNIVERSAL_PIPELINES_DIRNAME || normalized.startsWith(`${UNIVERSAL_PIPELINES_DIRNAME}/`);
}

/**
 * Split `_pipelines/{pipelineId}[/pipeline.yaml]` into id + remainder. The
 * splitter IS the whitelist: only the definition folder (folder-unit attach)
 * and `pipeline.yaml` resolve. `owner.json` carries the author's account
 * coordinates and `availability.json` is operational state — neither is
 * definition, so every plane (picker, accept gate, sandbox, prompt band)
 * refuses them by getting `null` here, with no second rule to drift.
 */
export function parseUniversalPipelineRef(
  rel: string,
): { pipelineId: string; rest: '' | typeof PIPELINE_FILE_NAME } | null {
  if (!isUniversalPipelineRef(rel)) return null;
  const [, pipelineId, ...rest] = rel.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  if (!pipelineId || !isValidCustomId(pipelineId)) return null;
  const remainder = rest.join('/');
  if (remainder === '') return { pipelineId, rest: '' };
  if (remainder === PIPELINE_FILE_NAME) return { pipelineId, rest: PIPELINE_FILE_NAME };
  return null;
}

// ============================================
// Activation — the scheduling unit, stored in the ACTIVATOR's account
// ============================================

export const PIPELINE_ACTIVATION_FILE_NAME = 'activation.json';

/**
 * One activation binds one project to one pipeline. It lives OUTSIDE the
 * pipeline dir (`.ant/pipeline-activations/{projectId}/activation.json` in the
 * activator's account), so it is self-describing: `pipelineId` names the
 * definition and `pipelineScope` PINS which scope root resolves it — the fire
 * path never falls back to closest-wins, so a later same-id definition in a
 * nearer scope cannot hijack a running schedule. One activation per project is
 * structural (one dir per projectId); a pipeline may hold many activations.
 * While a project has an active pipeline, interactive job starts in that
 * project are rejected — the pipeline owns the project.
 */
export interface PipelineActivation {
  pipelineId: string;
  /** Scope root the definition was resolved from at activate time. */
  pipelineScope: PipelineScope;
  /** All steps' sessions/artifacts land in this universal container. */
  projectId: string;
  activatedAt: string;
  activatedBy?: string;
  /**
   * PER-GATE approver roster: key = approval step id, value = lowercase org
   * member userIds (emails in cloud). A gate absent from the map is decidable
   * by the activator only. Stored on the ACTIVATION (never the definition —
   * definitions are shared templates and are frozen while activated, which
   * also pins the gate-id key set for the activation's lifetime). Resolve
   * authority re-reads this live; the run's activationSnapshot copy is audit
   * reference only.
   */
  approvers?: Record<string, string[]>;
  /** Reserved for the canonical phase (project+feature scope). Universal ⇒ omitted. */
  featureId?: string;
}

const ACTIVATION_KEYS = ['pipelineId', 'pipelineScope', 'projectId', 'activatedAt', 'activatedBy', 'approvers', 'featureId'];

/** Approver-map rows, reused by the activate and approvers-PUT ingresses. */
function approverMapErrors(
  raw: Record<string, unknown>,
  gateStepIds: string[] | undefined,
  cap: number,
): string[] {
  const errors: string[] = [];
  for (const [stepId, list] of Object.entries(raw)) {
    if (!isValidCustomId(stepId)) {
      errors.push(`activation.approvers: "${stepId}" is not a valid step id`);
      continue;
    }
    if (gateStepIds && !gateStepIds.includes(stepId)) {
      errors.push(`activation.approvers: "${stepId}" is not an approval step of this pipeline (gates: ${gateStepIds.join(', ') || 'none'})`);
    }
    if (!Array.isArray(list)) {
      errors.push(`activation.approvers.${stepId} must be an array of member ids`);
      continue;
    }
    if (list.length > cap) {
      errors.push(`activation.approvers.${stepId}: at most ${cap} approvers per gate (got: ${list.length})`);
    }
    const seen = new Set<string>();
    for (const entry of list) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        errors.push(`activation.approvers.${stepId}: approvers must be non-empty strings`);
        continue;
      }
      if (entry !== entry.trim().toLowerCase()) {
        errors.push(`activation.approvers.${stepId}: "${entry}" must be a lowercase member id`);
      }
      if (seen.has(entry)) {
        errors.push(`activation.approvers.${stepId}: duplicate approver "${entry}"`);
      }
      seen.add(entry);
    }
  }
  return errors;
}

/**
 * Plain messages, empty = valid (validateMcpServers precedent).
 * `opts.gateStepIds` (the activate/PUT ingresses pass the def's approval step
 * ids) turns on the approver-key subset check; loads WITHOUT it stay lenient —
 * a checkpoint/sidecar restore must not throw on a def that later changed.
 */
export function validatePipelineActivation(
  raw: unknown,
  opts: { gateStepIds?: string[]; maxApproversPerGate?: number } = {},
): string[] {
  if (!isPlainObject(raw)) return ['activation must be an object'];
  const errors: string[] = [];
  errors.push(...unknownKeyErrors(raw, ACTIVATION_KEYS, 'activation'));
  if (raw.approvers !== undefined) {
    if (!isPlainObject(raw.approvers)) {
      errors.push('activation.approvers must be a map of { <gateStepId>: [memberId, …] }');
    } else {
      errors.push(
        ...approverMapErrors(
          raw.approvers,
          opts.gateStepIds,
          opts.maxApproversPerGate ?? DEFAULT_PIPELINE_CAPS.maxApproversPerGate,
        ),
      );
    }
  }
  if (typeof raw.pipelineId !== 'string' || !isValidCustomId(raw.pipelineId)) {
    errors.push('activation.pipelineId must be a pipeline id (lowercase kebab-case)');
  }
  if (raw.pipelineScope !== 'user' && raw.pipelineScope !== 'org') {
    errors.push(`activation.pipelineScope must be "user" or "org" (got: ${String(raw.pipelineScope)})`);
  }
  if (typeof raw.projectId !== 'string' || raw.projectId.trim().length === 0) {
    errors.push('activation.projectId must be a non-empty string');
  }
  if (typeof raw.activatedAt !== 'string' || Number.isNaN(Date.parse(raw.activatedAt))) {
    errors.push('activation.activatedAt must be an ISO timestamp');
  }
  if (raw.activatedBy !== undefined && typeof raw.activatedBy !== 'string') {
    errors.push('activation.activatedBy must be a string');
  }
  if (raw.featureId !== undefined) {
    errors.push('activation.featureId is not supported yet (canonical pipelines are a future axis)');
  }
  return errors;
}

/**
 * Per-project active-pipeline surface (`GET /api/projects/:id/active-pipeline`
 * + derived FE state). Activation alone means `waiting`; live runs make it
 * `running` / `awaiting_human` — `state` is always `activationStateOf(liveRuns)`.
 */
export interface ActivePipelineInfo {
  pipelineId: string;
  pipelineName: string;
  state: PipelineLiveState;
  nextFireAt?: string;
  /** Every live run of the activation, newest first (`liveRunOf`). */
  liveRuns: PipelineLiveRun[];
}

// ============================================
// Item paths — the fetch trigger's selector grammar (dependency-free)
// ============================================

/**
 * One step of an item-path: `$` root, `.name` / `['name']` member, `[n]`
 * index. No wildcards, filters or recursion — a poller must be deterministic
 * and cheap, and anything richer belongs to the source's own query language.
 */
export type ItemPathSegment = { kind: 'key'; name: string } | { kind: 'index'; index: number };

export const ITEM_PATH_MAX_SEGMENTS = 16;

/**
 * Parse an item-path. Returns the segments, or a plain error message (the
 * `cronShapeError` precedent — the validator prefixes `where`).
 */
export function parseItemPath(raw: unknown, where: string): ItemPathSegment[] | string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return `${where} must be an item-path string starting with "$" (e.g. "$.issues")`;
  const src = raw.trim();
  if (src[0] !== '$') return `${where} must start with "$" (got: ${src})`;
  const out: ItemPathSegment[] = [];
  let i = 1;
  while (i < src.length) {
    if (out.length >= ITEM_PATH_MAX_SEGMENTS) return `${where} has more than ${ITEM_PATH_MAX_SEGMENTS} segments`;
    const ch = src[i];
    if (ch === '.') {
      const m = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(src.slice(i + 1));
      if (!m) return `${where}: expected a member name after "." at position ${i}`;
      out.push({ kind: 'key', name: m[0] });
      i += 1 + m[0].length;
      continue;
    }
    if (ch === '[') {
      const rest = src.slice(i);
      const idx = /^\[(0|[1-9]\d{0,5})\]/.exec(rest);
      if (idx) {
        out.push({ kind: 'index', index: Number(idx[1]) });
        i += idx[0].length;
        continue;
      }
      const quoted = /^\[(?:'([^'\\]*)'|"([^"\\]*)")\]/.exec(rest);
      if (quoted) {
        const name = quoted[1] ?? quoted[2] ?? '';
        if (name.length === 0) return `${where}: a bracketed member name must not be empty`;
        out.push({ kind: 'key', name });
        i += quoted[0].length;
        continue;
      }
      return `${where}: expected [n] or ['name'] at position ${i}`;
    }
    return `${where}: unexpected "${ch}" at position ${i} (segments are ".name", "['name']" or "[n]")`;
  }
  return out;
}

/** The inverse of {@link parseItemPath} — a canonical spelling the editor can write back into a definition. */
export function formatItemPath(segments: readonly ItemPathSegment[]): string {
  let out = '$';
  for (const seg of segments) {
    if (seg.kind === 'index') out += `[${seg.index}]`;
    else if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(seg.name)) out += `.${seg.name}`;
    // The grammar has no escapes: quote with whichever delimiter the name does not contain.
    else out += seg.name.includes("'") ? `["${seg.name}"]` : `['${seg.name}']`;
  }
  return out;
}

/** Template variable prefix of the claimed item's key and declared fields. */
export const PIPELINE_ITEM_TEMPLATE_PREFIX = 'trigger.item.';
export const PIPELINE_ITEM_KEY_TEMPLATE_VAR = `${PIPELINE_ITEM_TEMPLATE_PREFIX}key`;
/** Declared field name — a lowerCamel identifier; `key` is reserved for the dedupe key. */
export const PIPELINE_FETCH_FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;
export const PIPELINE_FETCH_MAX_FIELDS = 20;
/** Item keys outside this shape are skipped by the poller (Redis key + path-segment hygiene). */
export const PIPELINE_ITEM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
/** Items a poll inspects at most (the source's page size is the real bound). */
export const PIPELINE_FETCH_ITEMS_SCAN_MAX = 200;
/** A captured item field is cut here — it rides a directive, not a record store. */
export const PIPELINE_ITEM_FIELD_MAX_CHARS = 2_000;

/**
 * The `{{trigger.item.*}}` vocabulary a fetch trigger declares — the ONE
 * derivation the validator, the renderer and the editor's token picker share.
 * Empty when the definition has no fetch trigger.
 */
export function fetchItemTemplateVars(fetch: PipelineFetchTrigger | undefined | null): string[] {
  if (!fetch) return [];
  return [PIPELINE_ITEM_KEY_TEMPLATE_VAR, ...Object.keys(fetch.fields ?? {}).map((f) => `${PIPELINE_ITEM_TEMPLATE_PREFIX}${f}`)];
}

/**
 * The `{{trigger.item.*}}` vocabulary a `discovers` step declares for the steps
 * downstream of it — `fetchItemTemplateVars`'s sibling, the ONE derivation the
 * validator, the prompt band and the editor's token picker share.
 */
export function discoveryItemTemplateVars(discovers: StepDiscoveryDef | undefined | null): string[] {
  if (!discovers) return [];
  return [PIPELINE_ITEM_KEY_TEMPLATE_VAR, ...(discovers.fields ?? []).map((f) => `${PIPELINE_ITEM_TEMPLATE_PREFIX}${f}`)];
}

/** Index of the ONE step declaring `discovers` (validator-bounded to at most one); undefined when none. */
export function discoveryStepIndex(def: Pick<PipelineDef, 'steps'>): number | undefined {
  const i = def.steps.findIndex((s) => !isApprovalStep(s) && s.discovers !== undefined);
  return i >= 0 ? i : undefined;
}

/**
 * The ids of the PER-CASE steps: everything whose needs chain passes through
 * the fan-out step. A discovery run pre-skips them; a case run runs only
 * them (its prefix arrives sealed from the parent). Empty when no step fans
 * out. Needs are the effective ones (omitted = previous step in file order).
 */
export function perCaseStepIds(def: Pick<PipelineDef, 'steps'>): Set<string> {
  const at = discoveryStepIndex(def);
  const out = new Set<string>();
  if (at === undefined) return out;
  const discoversId = def.steps[at].id;
  const needsOf = (i: number): string[] => def.steps[i].needs ?? (i > 0 ? [def.steps[i - 1].id] : []);
  // Steps are validated acyclic; a fixpoint over file order converges.
  let changed = true;
  while (changed) {
    changed = false;
    def.steps.forEach((s, i) => {
      if (out.has(s.id) || s.id === discoversId) return;
      if (needsOf(i).some((n) => n === discoversId || out.has(n))) {
        out.add(s.id);
        changed = true;
      }
    });
  }
  return out;
}

/** Template variable prefix of the upstream node an event run was fired by. */
export const PIPELINE_UPSTREAM_TEMPLATE_PREFIX = 'trigger.upstream.';
/** An upstream step's answer is cut here before it rides the fire — it is another run's text, not a record store. */
export const PIPELINE_UPSTREAM_ANSWER_MAX_CHARS = 4_000;
/** Fields every upstream fire carries; the step-bound ones exist only when `on.upstream.step` is set. */
const UPSTREAM_RUN_FIELDS = ['pipelineId', 'runId', 'outcome'] as const;
const UPSTREAM_STEP_FIELDS = ['step', 'verdict', 'answer'] as const;

/**
 * The `{{trigger.upstream.*}}` vocabulary an upstream trigger declares — the
 * ONE derivation the validator, the renderer and the editor's token picker
 * share. Empty when the definition has no upstream trigger; the step-bound
 * fields appear only when the trigger names a step (a run seal has none).
 */
export function upstreamTemplateVars(upstream: Pick<PipelineUpstreamTrigger, 'step'> | undefined | null): string[] {
  if (!upstream) return [];
  const fields: readonly string[] = upstream.step !== undefined ? [...UPSTREAM_RUN_FIELDS, ...UPSTREAM_STEP_FIELDS] : UPSTREAM_RUN_FIELDS;
  return fields.map((f) => `${PIPELINE_UPSTREAM_TEMPLATE_PREFIX}${f}`);
}

/**
 * Directive template whitelist — the ONLY substitutions the dispatcher
 * performs. No general template engine, no user code path. Step-output
 * references (`{{steps.<id>.answer}}` / `{{steps.<id>.artifacts}}`) are a
 * separate grammar validated against the step's `needs` closure (upstream is
 * terminal at render time by construction); `steps.<id>.verdict` stays a
 * reserved axis the validator rejects explicitly.
 */
export const PIPELINE_TEMPLATE_VARS = [
  'trigger.fireDate',
  'trigger.fireEpoch',
  'run.id',
  // Cross-run watermark: the previous COMPLETED run of this activation at
  // fire time (frozen onto the RunRecord). First run renders empty.
  'run.prevSuccess.fireDate',
  'run.prevSuccess.fireEpoch',
] as const;
export type PipelineTemplateVar = (typeof PIPELINE_TEMPLATE_VARS)[number];

/** `{{steps.<id>.<field>}}` fields the dispatcher substitutes. */
export const PIPELINE_STEP_OUTPUT_FIELDS = ['answer', 'artifacts'] as const;
export type PipelineStepOutputField = (typeof PIPELINE_STEP_OUTPUT_FIELDS)[number];

/** Ceiling for a captured step answer — keeps run records and rendered directives bounded. */
export const PIPELINE_STEP_OUTPUT_MAX_CHARS = 16_000;

/** Hard ceiling on `retry.max` — coordinator re-dispatch rounds per step. */
export const MAX_STEP_RETRY = 3;
/** Upstream-fire chain-depth bound — a fire past this is skipped (loop guard). */
export const MAX_CHAIN_DEPTH = 5;
/** Reminder re-arms per gate — a nag, not a poll; resolve cancels it. */
export const MAX_GATE_REMINDERS = 10;

/**
 * Work statement synthesized when a job step declares no directive. English
 * by doctrine (universal directives are English-form; the FE only hints that
 * the default applies). Kept consciously aligned with the actions-tab BUILD
 * template (`ant-ui Actions/buildDirective.ts` — the same "no further input,
 * the definition is the specification" contract), but the two surfaces
 * deliberately do not share code: that one is a localized UI string, this one
 * is the dispatch-time fallback with a single owner here.
 */
export function defaultStepDirective(intentId?: string): string {
  return intentId && intentId !== GENERAL_INTENT
    ? `Please run the "${intentId}" intent. There is no further input beyond this request — treat the intent's own definition as the complete specification and carry it out end to end.`
    : "This is a scheduled run with no further input. Consult this job's own definition — its base docs and intent catalog — select the applicable work, and carry it out end to end.";
}

/** Parse `{n}m|h|d` into milliseconds. Returns null on malformed input. */
export function parsePipelineDuration(raw: string | undefined | null): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^([1-9]\d{0,3})(m|h|d)$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
  return n * unit;
}

// ============================================
// Caps (first-class per-tenant settings; defaults here, enforcement server-side)
// ============================================

export interface PipelineCaps {
  maxPipelines: number;
  maxStepsPerPipeline: number;
  minCronIntervalMinutes: number;
  /** Account-wide live runs across every activation (member = `{projectId}:{runId}`). */
  maxConcurrentRuns: number;
  /** Ceiling for a definition's `concurrency` — live runs per ACTIVATION. */
  maxLiveRunsPerActivation: number;
  maxApproversPerGate: number;
  /** Floor for `on.fetch.every` — one authenticated egress per activation per interval. */
  minFetchIntervalMinutes: number;
}

export const DEFAULT_PIPELINE_CAPS: PipelineCaps = {
  maxPipelines: 20,
  maxStepsPerPipeline: 20,
  minCronIntervalMinutes: 5,
  maxConcurrentRuns: 3,
  maxLiveRunsPerActivation: 3,
  maxApproversPerGate: 10,
  minFetchIntervalMinutes: 1,
};

/**
 * The ONE reader of a definition's per-activation run concurrency — the fire
 * path's slot cap and every "is there room for another run" judgment call
 * this, never `def.concurrency` directly. Absent = 1 (today's one live run
 * per activation).
 */
export function resolveRunConcurrency(def: Pick<PipelineDef, 'concurrency'> | null | undefined): number {
  const n = def?.concurrency;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Ceiling for a gate decision note (reject-reason channel) — audit line + run history. */
export const PIPELINE_GATE_NOTE_MAX_CHARS = 500;

// ============================================
// Run / step / gate records (runs JSONL + Redis projection + API)
// ============================================

export type PipelineRunStatus =
  | 'running'
  | 'awaiting_human'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled';

export type PipelineStepStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'awaiting_gate'
  | 'awaiting_clarify'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/**
 * `fetch` = one claimed item of a polled source; `discovery` = one case a
 * discovering step's turn sealed (`RunRecord.item` carries which, either way —
 * the item IS what this run was fired for, whoever found it).
 */
export type PipelineFiredBy = 'cron' | 'manual' | 'event' | 'fetch' | 'discovery';

export type GateDecision = 'approved' | 'rejected' | 'expired_approve' | 'expired_reject';

/**
 * Where a gate's per-run assignee came from: `step` = an upstream step's
 * sealed `<assignee>` nomination; `human` = a candidate's reassign (PUT).
 */
export type GateAssigneeSource = 'step' | 'human';

export interface GateRecord {
  gateId: string;
  cardId: string;
  prompt: string;
  armedAt: string;
  timeoutAt?: string;
  onTimeout?: GateTimeoutAction;
  /**
   * Per-RUN recipients of this gate — a routing hint, never a permission.
   * Candidates (activator ∪ the activation's roster for this gate) keep the
   * resolve authority whatever this says; absent/empty = every candidate is
   * called. Always ⊆ candidates (validated at arm and at reassign).
   */
  assignees?: string[];
  assigneeSource?: GateAssigneeSource;
  /** `assigneeSource: 'human'` — who reassigned. */
  assignedBy?: string;
  decision?: GateDecision;
  decidedBy?: string;
  decidedAt?: string;
  via?: 'in-app' | 'api';
  /** Free-text decision note (PIPELINE_GATE_NOTE_MAX_CHARS cap) — the reject-reason channel. */
  decisionNote?: string;
}

/**
 * Clarify wait on a job step (universal end-and-resume HITL). Latest round
 * only — multi-round history lives in the run JSONL. No timeout: the wait is
 * open-ended; the escape hatches are run cancel and deactivation.
 */
export interface ClarifyRecord {
  /** `clr-{runId}-{stepId}-{round}`. */
  clarifyId: string;
  /** The job that asked — the funnel key (`ant:pipe:job:{jobId}`) while awaiting. */
  jobId: string;
  question: string;
  toolUseId?: string;
  /** 1-based round counter (a resumed job may clarify again). */
  round: number;
  askedAt: string;
  answeredBy?: string;
  answeredAt?: string;
  /** Truncated audit copy of the answer (full text rides the resume directive). */
  answer?: string;
  via?: 'in-app' | 'api';
}

/**
 * What a 200 on a clarify answer means: `applied` = the step re-dispatched
 * with the answer; `held` = the step had not parked yet, the answer is stored
 * and applied on park (chat-card channel only — the inbox route refuses
 * anything but `awaiting_clarify`, so it never says `held`).
 */
export type PipelineClarifyAnswerOutcome = 'applied' | 'held';

/**
 * Captured on step completion — the `{{steps.*}}` substitution source and the
 * run history's business-readable summary. `answer` = the job's final
 * assistant text (session-seal read, jobId-guarded — clarify re-pointing means
 * it comes from the LAST job); `artifacts` = files matching the pinned
 * intent's `hooks.stop` artifact globs at completion. Capture failure means an
 * absent record, never a step failure.
 */
export interface StepOutputRecord {
  answer?: string;
  /** Set when `answer` was cut at PIPELINE_STEP_OUTPUT_MAX_CHARS. */
  answerTruncated?: boolean;
  /** Container-relative artifact paths (newest first, bounded). */
  artifacts?: string[];
  capturedAt: string;
}

/** One exhausted retry round's audit line (bounded at MAX_STEP_RETRY). */
export interface StepAttemptRecord {
  jobId?: string;
  error: string;
  endedAt: string;
}

export interface StepRecord {
  stepId: string;
  status: PipelineStepStatus;
  /** Current jobId (clarify end-and-resume / retry rounds can repoint it — 1 step = 1..n jobIds). */
  jobId?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  gate?: GateRecord;
  clarify?: ClarifyRecord;
  output?: StepOutputRecord;
  /** Sealed decision of an outcome-declaring intent — `on: verdict:<name>` routes on it. */
  verdict?: string;
  /**
   * Sealed `<assignee>` nomination (lowercased member id, unvalidated) — the
   * next gate that `needs` this step reads it and keeps it only when it names
   * a candidate.
   */
  assignee?: string;
  /**
   * Sealed `<cases>` of a `discovers` step, normalized (declared fields only,
   * bounded) — present ONLY on the discovery run's record; an explicit empty
   * list means "nothing to do this run" and is distinct from no tag at all.
   */
  cases?: PipelineRunItem[];
  /** Retry rounds already consumed (`retry.max` bound). */
  retriesUsed?: number;
  /** Failed rounds that were retried — the terminal failure stays on `error`. */
  attempts?: StepAttemptRecord[];
  /** Chat turn the step's user-turn line was minted under (coordinator-owned). */
  turnId?: string;
  /**
   * Dispatch-time audit the run view surfaces: step-output refs that rendered
   * empty, and how many files each glob pin expanded to.
   */
  dispatch?: { unresolvedTemplates?: string[]; contextExpanded?: Record<string, number> };
}

export interface RunRecord {
  runId: string;
  pipelineId: string;
  projectId: string;
  firedBy: PipelineFiredBy;
  fireEpoch: number;
  status: PipelineRunStatus;
  steps: StepRecord[];
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** Frozen definition compiled at fire time — in-flight runs never see YAML edits. Omitted from list APIs/SSE. */
  defSnapshot?: PipelineDef;
  /** Frozen activation at fire time — `projectId` above is sourced from it. */
  activationSnapshot?: PipelineActivation;
  /** Previous COMPLETED run's fireEpoch, frozen at fire — `{{run.prevSuccess.*}}`. */
  prevSuccessFireEpoch?: number;
  /** Upstream chain position (0/absent = not event-fired). Bounded by MAX_CHAIN_DEPTH. */
  chainDepth?: number;
  /** The claimed case of a fetch- or discovery-fired run (`firedBy: 'fetch' | 'discovery'` ⇔ present). */
  item?: PipelineRunItem;
  /** The upstream node of an event-fired run (`firedBy: 'event'` ⇔ present). */
  upstream?: PipelineRunUpstream;
  /**
   * `firedBy: 'discovery'` ⇔ present: the discovery run whose sealed step
   * produced this case. The prefix steps up to `discoveryStepId` are copied
   * from it, sealed, so `{{steps.<prefix>.*}}` resolves here too.
   */
  discoveryRunId?: string;
  /** The step that fanned out — the copy boundary and the canvas's split point (`firedBy: 'discovery'` ⇔ present). */
  discoveryStepId?: string;
}

/** One approval-gate decision on a terminal run's summary line — the org observer's "who opened this gate" channel. */
export interface PipelineRunGateSummary {
  stepId: string;
  decision: GateDecision;
  /** Absent on timeout auto-decisions. */
  decidedBy?: string;
}

/** One line per TERMINAL run in `runs/index.jsonl`; also the runs-list API row. */
export interface PipelineRunSummary {
  runId: string;
  pipelineId: string;
  /** The project the run's activation bound at fire time (activation can move between runs). */
  projectId: string;
  status: PipelineRunStatus;
  firedBy: PipelineFiredBy;
  fireEpoch: number;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** Approval-gate decisions (approval STEPS only — tool gates stay off the summary). */
  gates?: PipelineRunGateSummary[];
  /** The run's case label (fetch-fired runs) — the history row's `runLabel`. */
  itemKey?: string;
  /** The upstream node that fired an event run — the history row's origin. */
  upstream?: Pick<PipelineRunUpstream, 'pipelineId' | 'step'>;
  /** The discovery run a fanned-out case run was split from — the history row's origin. */
  discoveryRunId?: string;
}

/**
 * Decided approval-step gates of a run. Approval STEPS only — a paused tool
 * call (`tga-…` gate id) is a runtime grant, not an authored decision, so it
 * stays off the summary.
 */
export function summarizeRunGates(steps: readonly StepRecord[]): PipelineRunGateSummary[] {
  return steps
    .filter((s) => s.gate?.decision && s.gate.gateId.startsWith('gate-'))
    .map((s) => ({
      stepId: s.stepId,
      decision: s.gate!.decision!,
      ...(s.gate!.decidedBy && { decidedBy: s.gate!.decidedBy }),
    }));
}

/**
 * The ONE run-summary shape — the `runs/index.jsonl` line, the runs-list live
 * row, and the FE `runUpdate` fold all derive it from here so a run never
 * changes shape between "live" and "sealed". Optional keys ride only when set.
 */
export function runSummaryOf(
  run: Pick<RunRecord, 'runId' | 'pipelineId' | 'projectId' | 'status' | 'firedBy' | 'fireEpoch' | 'startedAt' | 'endedAt' | 'error' | 'steps' | 'item' | 'upstream' | 'discoveryRunId'>,
): PipelineRunSummary {
  const gates = summarizeRunGates(run.steps);
  return {
    runId: run.runId,
    pipelineId: run.pipelineId,
    projectId: run.projectId,
    status: run.status,
    firedBy: run.firedBy,
    fireEpoch: run.fireEpoch,
    startedAt: run.startedAt,
    ...(run.endedAt && { endedAt: run.endedAt }),
    ...(run.error && { error: run.error }),
    ...(gates.length > 0 && { gates }),
    ...(run.item && { itemKey: run.item.key }),
    ...(run.upstream && { upstream: { pipelineId: run.upstream.pipelineId, ...(run.upstream.step && { step: run.upstream.step }) } }),
    ...(run.discoveryRunId && { discoveryRunId: run.discoveryRunId }),
  };
}

// ============================================
// Live runs — the N-runs-per-activation view contract
// ============================================

/** Step states that mean "this run is at this step right now" (the canvas chip placement). */
export const PIPELINE_LIVE_STEP_STATUSES: ReadonlySet<PipelineStepStatus> = new Set<PipelineStepStatus>([
  'dispatched',
  'running',
  'awaiting_gate',
  'awaiting_clarify',
]);

/**
 * One live run as every view surface sees it (activation row, chat lock
 * signal, canvas chips, run dock). A run is one case in flight; N of them on
 * one activation is what an operator would call "workers" — the vocabulary
 * stays Run. `itemKey` is the fetch-trigger case label (absent until that
 * trigger lands); `runLabel` on the FE falls back to `runId`.
 */
export interface PipelineLiveRun {
  runId: string;
  status: 'running' | 'awaiting_human';
  startedAt: string;
  firedBy: PipelineFiredBy;
  itemKey?: string;
  /** The discovery run this case run was split from (`firedBy: 'discovery'` ⇔ present) — the live row's origin link. */
  discoveryRunId?: string;
  /** Steps in a live state — where this run's chips sit on the one canvas. */
  currentStepIds: string[];
}

export type PipelineLiveState = 'waiting' | 'running' | 'awaiting_human';

/** The ONE derivation of a live-run view from a run record; `null` for a terminal run. */
export function liveRunOf(
  run: Pick<RunRecord, 'runId' | 'status' | 'startedAt' | 'firedBy' | 'steps' | 'item' | 'discoveryRunId'>,
): PipelineLiveRun | null {
  if (run.status !== 'running' && run.status !== 'awaiting_human') return null;
  return {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    firedBy: run.firedBy,
    ...(run.item && { itemKey: run.item.key }),
    ...(run.discoveryRunId && { discoveryRunId: run.discoveryRunId }),
    currentStepIds: run.steps.filter((s) => PIPELINE_LIVE_STEP_STATUSES.has(s.status)).map((s) => s.stepId),
  };
}

/**
 * Fold one run update into a live set: a terminal run leaves, a live one is
 * upserted; newest first (`startedAt` desc, runId tiebreak) so "the newest
 * live run" is `[0]` everywhere.
 */
export function foldLiveRun(
  liveRuns: readonly PipelineLiveRun[],
  run: Pick<RunRecord, 'runId' | 'status' | 'startedAt' | 'firedBy' | 'steps' | 'item' | 'discoveryRunId'>,
): PipelineLiveRun[] {
  const rest = liveRuns.filter((r) => r.runId !== run.runId);
  const live = liveRunOf(run);
  if (!live) return rest;
  return [...rest, live].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId));
}

/** Activation state from its live set: awaiting a person outranks working; no live run = waiting. */
export function activationStateOf(liveRuns: readonly PipelineLiveRun[]): PipelineLiveState {
  if (liveRuns.some((r) => r.status === 'awaiting_human')) return 'awaiting_human';
  return liveRuns.length > 0 ? 'running' : 'waiting';
}

/** Append-only run event line (`.ant/pipeline-activations/{projectId}/runs/{runId}.jsonl`). */
export interface PipelineRunEvent {
  ts: string;
  event:
    | 'fired'
    | 'item_claimed'
    | 'cases_claimed'
    | 'step_dispatched'
    | 'step_completed'
    | 'step_retry'
    | 'awaiting_human'
    | 'human_resolved'
    | 'gate_reassigned'
    | 'gate_expired'
    | 'run_finished';
  runId: string;
  stepId?: string;
  jobId?: string;
  gateId?: string;
  detail?: Record<string, unknown>;
}

// ============================================
// API shapes
// ============================================

/**
 * One activation row as the API serves it — own activations plus (for
 * org-scope pipelines) other members' activations. `mine` is the ONLY
 * actionability signal: run-now / deactivate / cancel are offered on `mine`
 * rows; members' rows are read-only. `broken` = the activation references a
 * definition that no longer resolves at its pinned scope (hand-edited disk) —
 * surfaced, never auto-deleted, still deactivatable by its activator.
 */
export interface PipelineActivationView {
  pipelineId: string;
  projectId: string;
  activatedBy: string;
  activatedAt: string;
  mine: boolean;
  /** `broken` is sticky; otherwise `activationStateOf(liveRuns)`. */
  state: PipelineLiveState | 'broken';
  /** Server-computed next fire (fetch: last poll + `every`); absent on `broken`. */
  nextFireAt?: string;
  /** Every live run of this activation, newest first. */
  liveRuns: PipelineLiveRun[];
  lastRun?: { runId: string; status: PipelineRunStatus; firedAt: string };
  /** Fetch activations only — the last poll's telemetry. */
  lastPoll?: PipelineFetchStatus;
  /** Per-gate approver roster — org-visible by design (who opens which gate is never hidden). */
  approvers?: Record<string, string[]>;
}

/** List-rail entry. `nextFireAt` is SERVER-computed — the FE never parses cron. */
export interface PipelineListEntry {
  id: string;
  name: string;
  /** Absent = manual-only (no schedule trigger). */
  cron?: string;
  tz?: string;
  /** Fetch trigger's poll interval (`{n}m|h|d`); absent otherwise. */
  every?: string;
  stepCount: number;
  /** Which scope root resolved this definition (closest wins on id collision). */
  scope: PipelineScope;
  /** Effective editability FOR THE CALLING USER — org entries flip per caller. */
  readonly: boolean;
  /** Availability state machine: false = draft/disabled (editable, not activatable). */
  enabled: boolean;
  /** Org permission projection — org-scope entries only. */
  org?: PipelineOrgPermissions;
  /** Own activations + (org scope) other members' — see PipelineActivationView. */
  activations: PipelineActivationView[];
  /** Earliest next fire across own activations; absent when none are scheduled. */
  nextFireAt?: string;
  /** Most recent run across own activations. */
  lastRun?: { runId: string; status: PipelineRunStatus; firedAt: string };
  /** Open (unacknowledged) advisories against the caller's catalog — recomputed per list read. */
  openAdvisoryCount: number;
}

export interface PipelinePendingApproval {
  /**
   * Absent = gate (pre-clarify rows). Clarify rows carry the clarifyId in
   * gateId/cardId; `tool` rows are paused approval-gated tool calls (L3) —
   * approve/reject rides the same gate resolve funnel.
   */
  kind?: 'gate' | 'clarify' | 'tool';
  gateId: string;
  cardId: string;
  runId: string;
  pipelineId: string;
  pipelineName: string;
  projectId: string;
  stepId: string;
  prompt: string;
  armedAt: string;
  timeoutAt?: string;
  /** Gate rows: which way the timeout decides — the inbox says "auto-approves at …", not just "auto-decides". */
  onTimeout?: GateTimeoutAction;
  /** Clarify rows only: the asking job (funnel key). */
  jobId?: string;
  /** The run's case label (fetch-triggered runs) — the inbox row's `runLabel`. */
  itemKey?: string;
  /**
   * Absent = the caller's own activation. `'approver'` = the caller is on this
   * gate's roster of ANOTHER member's activation — the inbox groups these rows
   * separately and offers the run-context panel instead of project surfaces.
   */
  role?: 'approver';
  /** role:'approver' rows only — the activation's owner (run/context reads key off it). */
  ownerUserId?: string;
  /**
   * Gate rows: who this run's gate is routed to (⊆ candidates). Absent =
   * everyone on the roster is called. Sorting/badge only — any candidate may
   * still decide.
   */
  assignees?: string[];
  /** Gate rows: the decide-authorized set (activator first, then the gate's roster) — the reassign select's options. */
  candidates?: string[];
}

// ============================================
// Validation — plain messages, empty = valid (validateMcpServers precedent)
// ============================================

const STEP_ID_HINT = 'lowercase letters, digits and hyphens (e.g. "collect-sources")';
const DEF_KEYS = ['version', 'name', 'on', 'concurrency', 'defaults', 'steps', 'acknowledged'];
const ACK_KEYS = ['code', 'step', 'reason'];
/** Keys that existed in def v1 or belong to future axes — reject loudly, never ignore. */
const RESERVED_DEF_KEYS: Record<string, string> = {
  enabled: '"enabled" lives in the availability sidecar — use POST /api/pipelines/{id}/enable|disable, not the definition',
  projectId: '"projectId" moved to activation — the project binding is set when activating, not in the definition',
};
const SCHEDULE_KEYS = ['cron', 'tz', 'onMissed', 'overlap'];
const ON_KEYS = ['schedule', 'upstream', 'fetch'];
/** The retired chain trigger keyed on run status — say how the node edge spells it. */
const ON_RESERVED_KEYS: Record<string, string> = {
  runCompleted:
    '"runCompleted" was replaced by "upstream" — { pipelineId, step?, when?, overlap? }: statuses [completed] → when: success (the default), [failed, partial] → when: failure; [cancelled] has no equivalent (a cancelled run did not happen); name "step" to fire on one step\'s seal instead of the whole run',
};
const UPSTREAM_KEYS = ['pipelineId', 'step', 'when', 'overlap'];
const UPSTREAM_RESERVED_KEYS: Record<string, string> = {
  statuses: '"statuses" judged the run\'s aggregate status — an upstream edge judges a NODE: say "when": success | failure | always | verdict:<outcome> (with "step")',
};
const FETCH_KEYS = ['customJobRef', 'api', 'connection', 'request', 'items', 'key', 'fields', 'every'];
const FETCH_REQUEST_KEYS = ['method', 'path', 'query', 'body'];
const FETCH_CONNECTION_FORMS_HINT = 'exactly one connection form: { customJobRef, api } (a job\'s declared apis entry) or { connection: { baseUrl, headers? } } (inline)';
/** `apis`-entry knobs an author may carry into an inline connection — say why they do not apply. */
const FETCH_CONNECTION_RESERVED_KEYS: Record<string, string> = {
  allow: '"allow" does not apply to an inline connection — the declared request is its whole scope',
  self: '"self" targets this Ant server — a poll needs an external API with a baseUrl',
  ...Object.fromEntries(
    ['transport', 'command', 'args', 'env', 'url'].map((k) => [k, `"${k}" belongs to mcp.servers — a connection declares baseUrl / headers only`]),
  ),
};
/** Schedule-only knobs an author may reach for on a poll — say why they do not apply. */
const FETCH_RESERVED_KEYS: Record<string, string> = {
  overlap: '"overlap" does not apply to on.fetch — a poll admits items only while the activation has room under "concurrency"; unclaimed items are seen again next poll',
  onMissed: '"onMissed" does not apply to on.fetch — a missed poll misses nothing; the next poll sees the same unclaimed items',
  cron: '"cron" belongs to on.schedule — a fetch trigger polls "every" interval',
  concurrency: '"concurrency" is a pipeline-level key (live runs per activation), not a fetch knob',
  batch: '"batch" was removed — a poll starts every unclaimed item the activation has room for under "concurrency"; delete the key',
};
const JOB_STEP_KEYS = ['id', 'customJobRef', 'intent', 'directive', 'context', 'needs', 'on', 'retry', 'timeout', 'onMissingVerdict', 'discovers'];
const DISCOVERS_KEYS = ['fields', 'onMissing'];
/** Mechanism knobs an author may reach for on a fan-out — the discovery HOW is prose, never a declaration. */
const DISCOVERS_RESERVED_KEYS: Record<string, string> = {
  ...Object.fromEntries(
    ['items', 'key', 'request', 'connection', 'api', 'every'].map((k) => [
      k,
      `"${k}" belongs to on.fetch — a discovers step's turn FINDS its cases (MCP, API, files, judgment) as its directive says and seals them as <cases>; only the field vocabulary is declared here`,
    ]),
  ),
  concurrency: '"concurrency" is a pipeline-level key (live runs per activation) — the SAME cap admits fanned-out case runs',
  max: '"max" is not a knob — every discovered case is claimed; "concurrency" paces how many run at once and the rest wait in the claim ledger',
};
const APPROVAL_STEP_KEYS = ['id', 'type', 'prompt', 'needs', 'on', 'channels', 'timeout', 'remindAfter'];
/** Author-visible knobs that exist in the design but not in v1 — reject loudly, never ignore. */
const RESERVED_STEP_KEYS: Record<string, string> = {
  jobType: 'step "jobType" is not supported yet (canonical pipeline steps are a future axis)',
  feature: 'step "feature" is not supported yet (canonical pipeline steps are a future axis)',
};
/** `retry`/`remindAfter` are real on the OTHER step kind — keep the loud reject with a pointer. */
const JOB_ONLY_RESERVED: Record<string, string> = {
  ...RESERVED_STEP_KEYS,
  remindAfter: '"remindAfter" belongs to approval steps (a job step has no gate to remind about)',
};
const APPROVAL_ONLY_RESERVED: Record<string, string> = {
  ...RESERVED_STEP_KEYS,
  retry: '"retry" belongs to job steps (a gate is resolved by a person, not re-run)',
  discovers: '"discovers" belongs to job steps — a gate decides, it discovers nothing',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The overlap knob's ONE shape rule — `on.schedule` and `on.upstream` carry the same values. */
function overlapErrors(value: unknown, where: string): string[] {
  if (value === undefined || value === 'skip' || value === 'queue') return [];
  return [
    value === 'cancelPrevious'
      ? `${where}.overlap "cancelPrevious" is not supported yet — use "skip" or "queue"`
      : `${where}.overlap must be "skip" or "queue" (got: ${String(value)})`,
  ];
}

function unknownKeyErrors(
  obj: Record<string, unknown>,
  allowed: string[],
  where: string,
  reserved?: Record<string, string>,
): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    if (reserved && reserved[key]) {
      errors.push(`${where}: ${reserved[key]}`);
      continue;
    }
    errors.push(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`);
  }
  return errors;
}

/** Structural cron sanity — 5 whitespace-separated fields. Real parsing is server-side. */
function cronShapeError(cron: unknown): string | null {
  if (typeof cron !== 'string' || cron.trim().length === 0) {
    return 'on.schedule.cron must be a non-empty string';
  }
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `on.schedule.cron must have 5 fields (minute hour day month weekday), got ${fields.length}`;
  }
  return null;
}

interface StepOutputRef {
  fromStepId: string;
  refStepId: string;
  field: string;
}

/**
 * The trigger-declared template vocabularies: `item` is the fetch trigger's
 * `{{trigger.item.*}}` (`fetchItemTemplateVars`), `upstream` the upstream
 * trigger's `{{trigger.upstream.*}}` (`upstreamTemplateVars`) — null when the
 * definition has no such trigger, so a reference names one that does not exist.
 */
interface TriggerVars {
  /** The case vocabulary in force for the step being judged — fetch: every step; discovers: the per-case steps only. */
  item: string[] | null;
  itemFrom?: 'fetch' | 'discovery';
  upstream: string[] | null;
}

/** Static-variable judgement shared by directives and pins. Returns null when the name is accepted. */
function staticVarError(name: string, vars: TriggerVars, allowFields: boolean): string | null {
  if ((PIPELINE_TEMPLATE_VARS as readonly string[]).includes(name)) {
    if (vars.item !== null && name.startsWith('run.prevSuccess.')) {
      return vars.itemFrom === 'discovery'
        ? `"{{${name}}}" is not defined on a per-case step — a fanned-out case run has no previous-run watermark`
        : `"{{${name}}}" is not defined on a fetch pipeline — runs are per item, there is no previous-run watermark`;
    }
    return null;
  }
  if (name.startsWith(PIPELINE_ITEM_TEMPLATE_PREFIX)) {
    if (vars.item === null) {
      return `"{{${name}}}" needs an on.fetch trigger, or a discovers step upstream of this one — there is no case without one`;
    }
    if (!vars.item.includes(name)) {
      const where = vars.itemFrom === 'discovery' ? "the discovers step's fields" : 'on.fetch.fields';
      return `unknown item field "{{${name}}}" (declared: ${vars.item.map((v) => `{{${v}}}`).join(', ')} — add it under ${where})`;
    }
    if (!allowFields && name !== PIPELINE_ITEM_KEY_TEMPLATE_VAR) {
      return `"{{${name}}}" is not allowed in a context pin — item fields are source-controlled text; only {{${PIPELINE_ITEM_KEY_TEMPLATE_VAR}}} may name a path`;
    }
    return null;
  }
  if (name.startsWith(PIPELINE_UPSTREAM_TEMPLATE_PREFIX)) {
    if (vars.upstream === null) return `"{{${name}}}" needs an on.upstream trigger — there is no upstream node without one`;
    if (!vars.upstream.includes(name)) {
      const stepBound = UPSTREAM_STEP_FIELDS.some((f) => name === `${PIPELINE_UPSTREAM_TEMPLATE_PREFIX}${f}`);
      return `unknown upstream field "{{${name}}}" (available: ${vars.upstream.map((v) => `{{${v}}}`).join(', ')}${stepBound ? ' — step, verdict and answer exist only when on.upstream names a step' : ''})`;
    }
    if (!allowFields) return `"{{${name}}}" is not allowed in a context pin — upstream fields are another run's text and cannot name a path in this project`;
    return null;
  }
  return `unknown template variable "{{${name}}}"`;
}

function allowedStaticVarsHint(vars: TriggerVars, pin: boolean): string {
  const names = [
    ...(PIPELINE_TEMPLATE_VARS as readonly string[]).filter((v) => vars.item === null || !v.startsWith('run.prevSuccess.')),
    ...(vars.item ?? []).filter((v) => !pin || v === PIPELINE_ITEM_KEY_TEMPLATE_VAR),
    ...(pin ? [] : vars.upstream ?? []),
  ];
  return names.map((v) => `{{${v}}}`).join(', ');
}

function templateVarErrors(directive: string, stepId: string, vars: TriggerVars, stepRefs?: StepOutputRef[]): string[] {
  const errors: string[] = [];
  const re = /\{\{\s*([^}]*?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(directive)) !== null) {
    const name = m[1];
    if (!name.startsWith('steps.')) {
      const err = staticVarError(name, vars, true);
      if (err) errors.push(`step "${stepId}": ${err}${err.startsWith('unknown template') ? ` (allowed: ${allowedStaticVarsHint(vars, false)})` : ''}`);
      continue;
    }
    {
      const ref = /^steps\.([a-z0-9-]+)\.([a-zA-Z]+)$/.exec(name);
      if (!ref) {
        errors.push(`step "${stepId}": template variable "{{${name}}}" must be "steps.<stepId>.<field>" (fields: ${PIPELINE_STEP_OUTPUT_FIELDS.join(', ')})`);
      } else if (ref[2] === 'verdict') {
        errors.push(`step "${stepId}": template variable "{{${name}}}" is reserved — a verdict routes edges (on: verdict:<outcome>), it is not substituted into directives`);
      } else if (!(PIPELINE_STEP_OUTPUT_FIELDS as readonly string[]).includes(ref[2])) {
        errors.push(`step "${stepId}": unknown step-output field "{{${name}}}" (allowed: ${PIPELINE_STEP_OUTPUT_FIELDS.map((f) => `steps.<stepId>.${f}`).join(', ')})`);
      } else if (stepRefs) {
        stepRefs.push({ fromStepId: stepId, refStepId: ref[1], field: ref[2] });
      }
    }
  }
  return errors;
}

/**
 * Context-pin template check: pins accept the STATIC whitelist only
 * ({{trigger.*}} / {{run.*}}, plus {{trigger.item.key}} on a fetch pipeline —
 * never a declared item FIELD, which is source-controlled text and must not
 * name a path). Step-output refs are directive-only — a pin is expanded once
 * at dispatch, so it cannot carry another step's output.
 */
function pinTemplateErrors(pin: string, stepId: string, vars: TriggerVars): string[] {
  const errors: string[] = [];
  const re = /\{\{\s*([^}]*?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pin)) !== null) {
    const name = m[1];
    if (name.startsWith('steps.')) {
      errors.push(`step "${stepId}": context pin "{{${name}}}" — step-output references are not allowed in context pins (pin the upstream intent's hooks.stop glob instead)`);
      continue;
    }
    const err = staticVarError(name, vars, false);
    if (err) {
      errors.push(
        err.startsWith('unknown template')
          ? `step "${stepId}": ${err} in context pin (allowed: ${allowedStaticVarsHint(vars, true)})`
          : `step "${stepId}": ${err}`,
      );
    }
  }
  return errors;
}

/** Fetch-trigger shape rules — plain messages, `on.fetch.` prefixed. */
function fetchTriggerErrors(raw: unknown, caps: Pick<PipelineCaps, 'minFetchIntervalMinutes'>): string[] {
  if (!isPlainObject(raw)) return [`on.fetch must be a mapping { request, items, key, every, fields? } plus ${FETCH_CONNECTION_FORMS_HINT}`];
  const errors: string[] = [];
  errors.push(...unknownKeyErrors(raw, FETCH_KEYS, 'on.fetch', FETCH_RESERVED_KEYS));
  errors.push(...fetchConnectionRequestErrors(raw));
  errors.push(...fetchSelectionErrors(raw, caps));
  return errors;
}

/**
 * The half of the fetch rules a poll needs to REACH the source: connection form
 * and request. The editor probes with these alone so an author sees the
 * response before writing any selection path.
 */
function fetchConnectionRequestErrors(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const bound = raw.customJobRef !== undefined || raw.api !== undefined;
  const inline = raw.connection !== undefined;
  if (bound === inline) errors.push(`on.fetch needs ${FETCH_CONNECTION_FORMS_HINT}`);
  if (bound) {
    if (typeof raw.customJobRef !== 'string' || parseCustomJobRef(raw.customJobRef) === null) {
      errors.push(`on.fetch.customJobRef must be "{agentId}/{jobId}" — the job whose apis map names the connection (got: ${String(raw.customJobRef)})`);
    }
    if (typeof raw.api !== 'string' || !isValidCustomId(raw.api)) {
      errors.push(`on.fetch.api must be a connection name from that job's apis map (${STEP_ID_HINT})`);
    }
  }
  if (inline) {
    if (!isPlainObject(raw.connection)) {
      errors.push('on.fetch.connection must be a mapping { baseUrl, headers? }');
    } else {
      errors.push(...unknownKeyErrors(raw.connection, [...REST_EXTERNAL_CONNECTION_KEYS], 'on.fetch.connection', FETCH_CONNECTION_RESERVED_KEYS));
      errors.push(...restExternalConnectionErrors(raw.connection).map((e) => `on.fetch.connection: ${e}`));
    }
  }
  if (!isPlainObject(raw.request)) {
    errors.push('on.fetch.request must be a mapping { method, path, query?, body? }');
  } else {
    const req = raw.request;
    errors.push(...unknownKeyErrors(req, FETCH_REQUEST_KEYS, 'on.fetch.request'));
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : undefined;
    if (method !== 'GET' && method !== 'POST') {
      errors.push(
        method !== undefined && ['PUT', 'PATCH', 'DELETE'].includes(method)
          ? `on.fetch.request.method "${method}" is a write — a poll reads; use GET, or POST for a search endpoint`
          : `on.fetch.request.method must be "GET" or "POST" (got: ${String(req.method)})`,
      );
    }
    if (typeof req.path !== 'string' || !/^\/(?!\/)/.test(req.path) || req.path.includes('\\') || /\s/.test(req.path)) {
      errors.push(`on.fetch.request.path must be a /-rooted path relative to the connection's baseUrl, no whitespace (got: ${String(req.path)})`);
    }
    if (req.query !== undefined) {
      if (!isPlainObject(req.query) || Object.values(req.query).some((v) => !['string', 'number', 'boolean'].includes(typeof v))) {
        errors.push('on.fetch.request.query must be a mapping of string/number/boolean values');
      }
    }
    if (req.body !== undefined) {
      if (!isPlainObject(req.body)) {
        errors.push('on.fetch.request.body must be a mapping (JSON object)');
      } else if (method === 'GET') {
        errors.push('on.fetch.request.body is not allowed with GET — use query, or POST for a search endpoint');
      }
    }
  }
  return errors;
}

/** The other half: what to SELECT from the response (items / key / fields) and how often to poll. */
function fetchSelectionErrors(raw: Record<string, unknown>, caps: Pick<PipelineCaps, 'minFetchIntervalMinutes'>): string[] {
  const errors: string[] = [];
  const items = parseItemPath(raw.items, 'on.fetch.items');
  if (typeof items === 'string') errors.push(items);
  const key = parseItemPath(raw.key, 'on.fetch.key');
  if (typeof key === 'string') errors.push(key);
  if (raw.fields !== undefined) {
    if (!isPlainObject(raw.fields)) {
      errors.push('on.fetch.fields must be a mapping of name → item-path');
    } else {
      const names = Object.keys(raw.fields);
      if (names.length > PIPELINE_FETCH_MAX_FIELDS) {
        errors.push(`on.fetch.fields: at most ${PIPELINE_FETCH_MAX_FIELDS} fields (got: ${names.length})`);
      }
      for (const name of names) {
        if (name === 'key') {
          errors.push('on.fetch.fields: "key" is reserved — {{trigger.item.key}} is the dedupe key declared by on.fetch.key');
        } else if (!PIPELINE_FETCH_FIELD_NAME_PATTERN.test(name)) {
          errors.push(`on.fetch.fields: field name "${name}" must be a lowerCamel identifier (letters and digits, up to 32 characters)`);
        }
        const fieldPath = parseItemPath(raw.fields[name], `on.fetch.fields.${name}`);
        if (typeof fieldPath === 'string') errors.push(fieldPath);
      }
    }
  }
  const everyMs = parsePipelineDuration(raw.every as string);
  if (everyMs === null) {
    errors.push('on.fetch.every must be a duration like "5m", "1h", "1d"');
  } else if (everyMs < caps.minFetchIntervalMinutes * 60_000) {
    errors.push(`on.fetch.every must be at least ${caps.minFetchIntervalMinutes}m`);
  }
  return errors;
}

/** Kahn topological check. Returns true when the `needs` graph is acyclic. */
function isAcyclic(steps: Array<{ id: string; needs?: string[] }>): boolean {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of steps) indegree.set(s.id, 0);
  for (const s of steps) {
    for (const dep of s.needs ?? []) {
      if (!indegree.has(dep)) continue;
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(s.id);
      dependents.set(dep, list);
    }
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const dep of dependents.get(id) ?? []) {
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }
  return visited === steps.length;
}

/**
 * Connection + request rules only — what the preview route needs to fetch a
 * response. Unknown keys still count (a misspelled `connection` must not pass
 * as "no connection"); selection and cadence rules are judged separately.
 */
export function validatePipelineFetchProbe(raw: unknown): string[] {
  if (!isPlainObject(raw)) return [`on.fetch must be a mapping { request, items, key, every, fields? } plus ${FETCH_CONNECTION_FORMS_HINT}`];
  return [...unknownKeyErrors(raw, FETCH_KEYS, 'on.fetch', FETCH_RESERVED_KEYS), ...fetchConnectionRequestErrors(raw)];
}

/** The selection half alone (`items` / `key` / `fields` / `every`) — the preview reports these as a mapping verdict, not a refusal. */
export function validatePipelineFetchSelection(
  raw: unknown,
  caps: Pick<PipelineCaps, 'minFetchIntervalMinutes'> = DEFAULT_PIPELINE_CAPS,
): string[] {
  if (!isPlainObject(raw)) return ['on.fetch must be a mapping'];
  return fetchSelectionErrors(raw, caps);
}

/** The fetch-trigger rules alone — the editor's preview round-trip validates the block before polling with it. */
export function validatePipelineFetchTrigger(
  raw: unknown,
  caps: Pick<PipelineCaps, 'minFetchIntervalMinutes'> = DEFAULT_PIPELINE_CAPS,
): string[] {
  return fetchTriggerErrors(raw, caps);
}

/**
 * Every rule the pipeline store enforces, as plain messages. Empty = valid.
 * Catalog binding (agent/job/intent existence, verdict vocabulary) is the
 * separate `validatePipelineCatalogBinding` below — it needs the caller's
 * agent catalog; cron minimum-interval is server-side (cron parser).
 */
export function validatePipelineDef(
  raw: unknown,
  caps: Pick<PipelineCaps, 'maxStepsPerPipeline' | 'maxLiveRunsPerActivation' | 'minFetchIntervalMinutes'> = DEFAULT_PIPELINE_CAPS,
): string[] {
  if (!isPlainObject(raw)) return ['pipeline definition must be a mapping (YAML object)'];
  const errors: string[] = [];
  errors.push(...unknownKeyErrors(raw, DEF_KEYS, 'pipeline', RESERVED_DEF_KEYS));

  if (raw.version !== PIPELINE_DEF_VERSION) {
    errors.push(`version must be ${PIPELINE_DEF_VERSION} (got: ${String(raw.version)})`);
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  } else if (raw.name.length > 100) {
    errors.push('name must be at most 100 characters');
  }

  // Per-activation live-run cap — trigger-agnostic (run-now bursts, cron, chain fires all reserve against it).
  if (raw.concurrency !== undefined) {
    const cap = caps.maxLiveRunsPerActivation;
    if (typeof raw.concurrency !== 'number' || !Number.isInteger(raw.concurrency) || raw.concurrency < 1 || raw.concurrency > cap) {
      errors.push(`concurrency must be an integer from 1 to ${cap} (live runs one activation may hold at once; got: ${String(raw.concurrency)})`);
    }
  }

  // Trigger — absent `on` = manual-only (run-now is the only fire source).
  // `vars` is the trigger-declared template vocabulary (null = no such trigger).
  const vars: TriggerVars = { item: null, upstream: null };
  if (raw.on !== undefined && !isPlainObject(raw.on)) {
    errors.push('on must be a mapping of triggers (omit "on" entirely for a manual-only pipeline)');
  } else if (raw.on !== undefined && isPlainObject(raw.on)) {
    errors.push(...unknownKeyErrors(raw.on, ON_KEYS, 'on', ON_RESERVED_KEYS));
    if (raw.on.schedule === undefined && raw.on.upstream === undefined && raw.on.fetch === undefined) {
      errors.push('on must declare at least one trigger — "schedule", "upstream" or "fetch" (omit "on" entirely for a manual-only pipeline)');
    }
    if (raw.on.fetch !== undefined) {
      if (raw.on.schedule !== undefined || raw.on.upstream !== undefined) {
        errors.push('on.fetch stands alone — a polled pipeline fires per item, not on a schedule or an upstream node (remove "schedule" / "upstream")');
      }
      errors.push(...fetchTriggerErrors(raw.on.fetch, caps));
      if (isPlainObject(raw.on.fetch)) {
        const fields = isPlainObject(raw.on.fetch.fields) ? (raw.on.fetch.fields as Record<string, string>) : undefined;
        vars.item = fetchItemTemplateVars({ fields } as PipelineFetchTrigger);
      }
    }
    if (raw.on.schedule !== undefined) {
      if (!isPlainObject(raw.on.schedule)) {
        errors.push('on.schedule must be a mapping');
      } else {
        const sched = raw.on.schedule as Record<string, unknown>;
        errors.push(...unknownKeyErrors(sched, SCHEDULE_KEYS, 'on.schedule'));
        const cronErr = cronShapeError(sched.cron);
        if (cronErr) errors.push(cronErr);
        if (sched.tz !== undefined && (typeof sched.tz !== 'string' || sched.tz.trim().length === 0)) {
          errors.push('on.schedule.tz must be a non-empty string (IANA timezone)');
        }
        if (sched.onMissed !== undefined && sched.onMissed !== 'skip' && sched.onMissed !== 'runOnce') {
          errors.push(`on.schedule.onMissed must be "skip" or "runOnce" (got: ${String(sched.onMissed)})`);
        }
        errors.push(...overlapErrors(sched.overlap, 'on.schedule'));
      }
    }
    if (raw.on.upstream !== undefined) {
      if (!isPlainObject(raw.on.upstream)) {
        errors.push('on.upstream must be a mapping { pipelineId, step?, when?, overlap? }');
      } else {
        const up = raw.on.upstream as Record<string, unknown>;
        errors.push(...unknownKeyErrors(up, UPSTREAM_KEYS, 'on.upstream', UPSTREAM_RESERVED_KEYS));
        if (typeof up.pipelineId !== 'string' || !isValidCustomId(up.pipelineId)) {
          errors.push('on.upstream.pipelineId must be a pipeline id (lowercase kebab-case)');
        }
        if (up.step !== undefined && (typeof up.step !== 'string' || !isValidCustomId(up.step))) {
          errors.push('on.upstream.step must be a step id of that pipeline (lowercase kebab-case) — omit it to fire on the run\'s seal');
        }
        if (up.when !== undefined && !isStepEdgeCondition(up.when)) {
          errors.push(`on.upstream.when must be "success", "failure", "always", "verdict:<outcome>" or "verdict:<a|b>" (got: ${String(up.when)})`);
        } else if (typeof up.when === 'string' && up.when.startsWith('verdict:') && up.step === undefined) {
          errors.push('on.upstream.when "verdict:…" needs on.upstream.step — a run seal carries no verdict; name the step whose intent declares the outcome');
        }
        errors.push(...overlapErrors(up.overlap, 'on.upstream'));
        vars.upstream = upstreamTemplateVars({ step: typeof up.step === 'string' ? up.step : undefined });
      }
    }
  }

  // Defaults
  if (raw.defaults !== undefined) {
    if (!isPlainObject(raw.defaults)) {
      errors.push('defaults must be a mapping');
    } else {
      errors.push(...unknownKeyErrors(raw.defaults, ['onStepFailure'], 'defaults'));
      const p = raw.defaults.onStepFailure;
      if (p !== undefined && p !== 'abort' && p !== 'continue') {
        errors.push(`defaults.onStepFailure must be "abort" or "continue" (got: ${String(p)})`);
      }
    }
  }

  // Steps
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push('steps must be a non-empty array');
    return errors;
  }
  if (raw.steps.length > caps.maxStepsPerPipeline) {
    errors.push(`steps: at most ${caps.maxStepsPerPipeline} steps per pipeline (got: ${raw.steps.length})`);
  }

  // Fan-out pre-pass: which steps are PER-CASE (downstream of the one discovers
  // step) decides the case vocabulary in force for each step's templates —
  // judged before the step loop so directives and pins see it. Lenient over
  // raw shapes; the loop reports the shape errors themselves.
  const preShaped = raw.steps.map((s, i) => {
    const o = isPlainObject(s) ? s : {};
    const id = typeof o.id === 'string' ? o.id : `#${i}`;
    const needs = Array.isArray(o.needs) ? (o.needs as unknown[]).filter((n): n is string => typeof n === 'string') : undefined;
    const discovers = o.type !== 'approval' && o.discovers !== undefined && o.discovers !== null ? (o.discovers as Record<string, unknown>) : undefined;
    return { id, needs, discovers };
  });
  const discoverySteps = preShaped.filter((s) => s.discovers !== undefined);
  const discoveryVars: string[] | null =
    discoverySteps.length === 1
      ? discoveryItemTemplateVars({
          fields: Array.isArray(discoverySteps[0].discovers!.fields) ? (discoverySteps[0].discovers!.fields as unknown[]).filter((f): f is string => typeof f === 'string') : [],
        })
      : null;
  const perCaseIds =
    discoverySteps.length === 1
      ? perCaseStepIds({ steps: preShaped.map((s) => ({ id: s.id, needs: s.needs, ...(s.discovers && { discovers: {} }) })) as PipelineStepDef[] })
      : new Set<string>();
  if (discoverySteps.length > 1) {
    errors.push(
      `discovers may be declared on ONE step only (got: ${discoverySteps.map((s) => `"${s.id}"`).join(', ')}) — two fan-outs would multiply cases into a product no concurrency cap can pace; chain a second pipeline with on.upstream instead`,
    );
  }
  if (discoverySteps.length > 0 && isPlainObject(raw.on) && raw.on.fetch !== undefined) {
    errors.push('discovers and on.fetch do not coexist — a fetch pipeline already fires one run per item; put the discovery in the fetched item\'s step or drop the trigger');
  }

  const ids = new Set<string>();
  const shapedSteps: Array<{ id: string; needs?: string[]; isApproval: boolean }> = [];
  const stepOutputRefs: StepOutputRef[] = [];
  raw.steps.forEach((rawStep, index) => {
    const where = `steps[${index}]`;
    if (!isPlainObject(rawStep)) {
      errors.push(`${where} must be a mapping`);
      return;
    }
    const id = rawStep.id;
    if (typeof id !== 'string' || !isValidCustomId(id)) {
      errors.push(`${where}.id must be ${STEP_ID_HINT}`);
    } else if (ids.has(id)) {
      errors.push(`duplicate step id "${id}"`);
    } else {
      ids.add(id);
    }
    const stepId = typeof id === 'string' ? id : `#${index}`;
    // The case vocabulary THIS step may reference: a fetch pipeline's on every
    // step; a fan-out's on the per-case steps only (the discovery run renders
    // `{{trigger.item.*}}` blank everywhere else, so it is refused there).
    const stepVars: TriggerVars = discoveryVars !== null && perCaseIds.has(stepId) ? { ...vars, item: discoveryVars, itemFrom: 'discovery' } : vars;

    if (rawStep.needs !== undefined) {
      if (!Array.isArray(rawStep.needs) || rawStep.needs.some((n) => typeof n !== 'string')) {
        errors.push(`step "${stepId}": needs must be an array of step ids`);
      } else if ((rawStep.needs as string[]).includes(stepId)) {
        errors.push(`step "${stepId}": needs must not reference itself`);
      }
    }
    if (rawStep.on !== undefined && !isStepEdgeCondition(rawStep.on)) {
      errors.push(`step "${stepId}": on must be "success", "failure", "always", "verdict:<outcome>" or "verdict:<a|b>" (got: ${String(rawStep.on)})`);
    }

    if (rawStep.type === 'approval') {
      errors.push(...unknownKeyErrors(rawStep, APPROVAL_STEP_KEYS, `step "${stepId}"`, APPROVAL_ONLY_RESERVED));
      if (typeof rawStep.prompt !== 'string' || rawStep.prompt.trim().length === 0) {
        errors.push(`step "${stepId}": approval steps need a non-empty prompt`);
      } else if (rawStep.prompt.length > DIRECTIVE_MAX_CHARS) {
        errors.push(`step "${stepId}": prompt must be at most ${DIRECTIVE_MAX_CHARS} characters`);
      }
      if (rawStep.channels !== undefined) {
        if (!Array.isArray(rawStep.channels) || rawStep.channels.length === 0) {
          errors.push(`step "${stepId}": channels must be a non-empty array`);
        } else {
          for (const ch of rawStep.channels) {
            if (ch !== 'inApp') {
              errors.push(`step "${stepId}": channel "${String(ch)}" is not supported yet — v1 supports only "inApp"`);
            }
          }
        }
      }
      if (rawStep.timeout !== undefined) {
        if (!isPlainObject(rawStep.timeout)) {
          errors.push(`step "${stepId}": timeout must be a mapping { after, onTimeout }`);
        } else {
          errors.push(...unknownKeyErrors(rawStep.timeout, ['after', 'onTimeout'], `step "${stepId}".timeout`));
          if (parsePipelineDuration(rawStep.timeout.after as string) === null) {
            errors.push(`step "${stepId}": timeout.after must be a duration like "30m", "24h", "7d"`);
          }
          const action = rawStep.timeout.onTimeout;
          if (action !== 'reject' && action !== 'approve') {
            errors.push(`step "${stepId}": timeout.onTimeout must be "reject" or "approve" (got: ${String(action)})`);
          }
        }
      }
      if (rawStep.remindAfter !== undefined && parsePipelineDuration(rawStep.remindAfter as string) === null) {
        errors.push(`step "${stepId}": remindAfter must be a duration like "4h", "24h"`);
      }
    } else if (rawStep.type !== undefined) {
      errors.push(`step "${stepId}": unknown step type "${String(rawStep.type)}" (job steps omit type; gates use type: approval)`);
    } else {
      errors.push(...unknownKeyErrors(rawStep, JOB_STEP_KEYS, `step "${stepId}"`, JOB_ONLY_RESERVED));
      if (typeof rawStep.customJobRef !== 'string' || parseCustomJobRef(rawStep.customJobRef) === null) {
        errors.push(`step "${stepId}": customJobRef must be "{agentId}/{jobId}" (got: ${String(rawStep.customJobRef)})`);
      }
      // Optional — absent/blank dispatches defaultStepDirective(intent).
      if (rawStep.directive !== undefined && typeof rawStep.directive !== 'string') {
        errors.push(`step "${stepId}": directive must be a string (omit it to run the default directive)`);
      } else if (typeof rawStep.directive === 'string' && rawStep.directive.trim().length > 0) {
        if (rawStep.directive.length > DIRECTIVE_MAX_CHARS) {
          // Same ceiling the direct HTTP job-start ingresses apply. A stored
          // directive is dispatched on every firing, so refusing it at authoring
          // time is the only place the author sees why (M-NEW-029).
          errors.push(`step "${stepId}": directive must be at most ${DIRECTIVE_MAX_CHARS} characters`);
        } else {
          errors.push(...templateVarErrors(rawStep.directive, stepId, stepVars, stepOutputRefs));
        }
      }
      if (rawStep.discovers !== undefined) {
        if (!isPlainObject(rawStep.discovers)) {
          errors.push(`step "${stepId}": discovers must be a mapping { fields?, onMissing? } (an empty mapping fans out on the case key alone)`);
        } else {
          errors.push(...unknownKeyErrors(rawStep.discovers, DISCOVERS_KEYS, `step "${stepId}".discovers`, DISCOVERS_RESERVED_KEYS));
          const fields = rawStep.discovers.fields;
          if (fields !== undefined) {
            if (!Array.isArray(fields) || fields.some((f) => typeof f !== 'string')) {
              errors.push(`step "${stepId}": discovers.fields must be an array of field names`);
            } else {
              if (fields.length > PIPELINE_FETCH_MAX_FIELDS) {
                errors.push(`step "${stepId}": discovers.fields declares at most ${PIPELINE_FETCH_MAX_FIELDS} fields (got: ${fields.length})`);
              }
              const seen = new Set<string>();
              for (const f of fields as string[]) {
                if (f === 'key') errors.push(`step "${stepId}": discovers.fields "key" is reserved — every case carries its key`);
                else if (!PIPELINE_FETCH_FIELD_NAME_PATTERN.test(f)) errors.push(`step "${stepId}": discovers.fields "${f}" must be a lowerCamel identifier (e.g. "merchantId")`);
                if (seen.has(f)) errors.push(`step "${stepId}": discovers.fields declares "${f}" twice`);
                seen.add(f);
              }
            }
          }
          const missing = rawStep.discovers.onMissing;
          if (missing !== undefined && missing !== 'fail' && missing !== 'complete') {
            errors.push(`step "${stepId}": discovers.onMissing must be "fail" or "complete" (got: ${String(missing)})`);
          }
        }
        if (!perCaseIds.size && discoverySteps.length === 1) {
          errors.push(`step "${stepId}": discovers needs at least one step downstream of it — the steps that follow are what run once per case`);
        }
      }
      if (rawStep.intent !== undefined) {
        if (typeof rawStep.intent !== 'string' || (!isValidCustomId(rawStep.intent) && rawStep.intent !== GENERAL_INTENT)) {
          errors.push(`step "${stepId}": intent must be a catalog intent id (${STEP_ID_HINT})`);
        }
      }
      if (rawStep.onMissingVerdict !== undefined) {
        if (
          typeof rawStep.onMissingVerdict !== 'string' ||
          (rawStep.onMissingVerdict !== 'fail' && !isValidCustomId(rawStep.onMissingVerdict))
        ) {
          errors.push(`step "${stepId}": onMissingVerdict must be "fail" or an outcome id (${STEP_ID_HINT})`);
        }
        if (rawStep.intent === undefined) {
          errors.push(`step "${stepId}": onMissingVerdict needs a pinned intent (the outcomes vocabulary lives on the intent)`);
        }
      }
      if (rawStep.retry !== undefined) {
        if (!isPlainObject(rawStep.retry)) {
          errors.push(`step "${stepId}": retry must be a mapping { max, backoff? }`);
        } else {
          errors.push(...unknownKeyErrors(rawStep.retry, ['max', 'backoff'], `step "${stepId}".retry`));
          const max = rawStep.retry.max;
          if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > MAX_STEP_RETRY) {
            errors.push(`step "${stepId}": retry.max must be an integer between 1 and ${MAX_STEP_RETRY}`);
          }
          if (rawStep.retry.backoff !== undefined && parsePipelineDuration(rawStep.retry.backoff as string) === null) {
            errors.push(`step "${stepId}": retry.backoff must be a duration like "1m", "10m", "1h"`);
          }
        }
      }
      if (rawStep.timeout !== undefined) {
        if (!isPlainObject(rawStep.timeout)) {
          errors.push(`step "${stepId}": timeout must be a mapping { after } (job steps always fail on expiry)`);
        } else {
          errors.push(...unknownKeyErrors(rawStep.timeout, ['after'], `step "${stepId}".timeout`));
          if (parsePipelineDuration(rawStep.timeout.after as string) === null) {
            errors.push(`step "${stepId}": timeout.after must be a duration like "30m", "2h"`);
          }
        }
      }
      if (rawStep.context !== undefined) {
        if (!Array.isArray(rawStep.context) || rawStep.context.some((c) => typeof c !== 'string' || c.trim().length === 0)) {
          errors.push(`step "${stepId}": context must be an array of non-empty paths`);
        } else {
          // Glob pins share the hooks.stop artifact vocabulary; concrete
          // paths stay loose here and are judged at dispatch, as before.
          // Templates render before expansion (static whitelist only), so the
          // structural glob check runs on a placeholder-substituted copy.
          for (const pin of rawStep.context as string[]) {
            const raw = pin.trim();
            errors.push(...pinTemplateErrors(raw, stepId, stepVars));
            const v = raw.replace(/\{\{\s*[^}]*?\s*\}\}/g, 'x');
            if (!v.includes('*')) continue;
            const globErr = validateArtifactGlob(v, `step "${stepId}": context`);
            if (globErr) {
              errors.push(globErr);
            } else if (v.split('/')[0] === 'sessions') {
              errors.push(`step "${stepId}": context glob "${v}" targets sessions/ — a reserved area that cannot be attached`);
            }
          }
        }
      }
    }

    shapedSteps.push({
      id: stepId,
      needs: Array.isArray(rawStep.needs) ? (rawStep.needs as unknown[]).filter((n): n is string => typeof n === 'string') : undefined,
      isApproval: rawStep.type === 'approval',
    });
  });

  // needs references + cycle check (only meaningful once ids are sane)
  for (const step of shapedSteps) {
    for (const dep of step.needs ?? []) {
      if (!ids.has(dep)) errors.push(`step "${step.id}": needs references unknown step "${dep}"`);
    }
  }
  // Fan-out boundary: a per-case step waits only on the discovering step and
  // on other per-case steps — a case run copies the discovery run's SEALED
  // prefix and never waits for a branch still running there (it would arrive
  // skipped and cascade the case's steps into skips).
  if (discoverySteps.length === 1 && perCaseIds.size > 0) {
    const discoveryId = discoverySteps[0].id;
    shapedSteps.forEach((step, index) => {
      if (!perCaseIds.has(step.id)) return;
      const effective = step.needs ?? (index > 0 ? [shapedSteps[index - 1].id] : []);
      for (const dep of effective) {
        if (dep !== discoveryId && !perCaseIds.has(dep) && ids.has(dep)) {
          errors.push(
            `step "${step.id}" runs once per case but needs "${dep}", which is neither the discovering step "${discoveryId}" nor a per-case step — a case run cannot wait on the discovery run's other branches (move "${dep}" before "${discoveryId}", or make it per-case)`,
          );
        }
      }
    });
  }
  // Gate-anchor rule (pure structure — file order): an approval step's chat
  // card anchors to the producing job's turn, so a rootless gate has no home.
  shapedSteps.forEach((step, index) => {
    if (!step.isApproval) return;
    const effective = step.needs ?? (index > 0 ? [shapedSteps[index - 1].id] : []);
    if (effective.length === 0) {
      errors.push(`step "${step.id}": an approval gate needs an upstream step (it cannot be the entry step)`);
    }
  });
  // {{steps.*}} references resolve only against the step's transitive needs
  // closure — that is the compile-time guarantee the referenced step is
  // terminal when the directive renders.
  if (stepOutputRefs.length > 0) {
    const needsOf = new Map<string, string[]>();
    shapedSteps.forEach((s, i) => {
      needsOf.set(s.id, s.needs ?? (i > 0 ? [shapedSteps[i - 1].id] : []));
    });
    const closureOf = (id: string): Set<string> => {
      const out = new Set<string>();
      const queue = [...(needsOf.get(id) ?? [])];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (out.has(cur)) continue;
        out.add(cur);
        queue.push(...(needsOf.get(cur) ?? []));
      }
      return out;
    };
    const approvalIds = new Set(shapedSteps.filter((s) => s.isApproval).map((s) => s.id));
    for (const ref of stepOutputRefs) {
      const at = `step "${ref.fromStepId}": "{{steps.${ref.refStepId}.${ref.field}}}"`;
      if (!ids.has(ref.refStepId)) {
        errors.push(`${at} references unknown step "${ref.refStepId}"`);
      } else if (ref.refStepId === ref.fromStepId) {
        errors.push(`${at} must not reference the step itself`);
      } else if (approvalIds.has(ref.refStepId)) {
        errors.push(`${at} references an approval gate — gates have no output`);
      } else if (!closureOf(ref.fromStepId).has(ref.refStepId)) {
        errors.push(`${at} must reference an upstream dependency (put "${ref.refStepId}" in this step's needs chain)`);
      }
    }
  }
  if (errors.length === 0 && !isAcyclic(shapedSteps)) {
    errors.push('steps: the needs graph must be acyclic');
  }

  if (raw.acknowledged !== undefined) {
    if (!Array.isArray(raw.acknowledged)) {
      errors.push('acknowledged must be an array of { code, step, reason }');
    } else {
      const seen = new Set<string>();
      raw.acknowledged.forEach((rawAck, index) => {
        const where = `acknowledged[${index}]`;
        if (!isPlainObject(rawAck)) {
          errors.push(`${where} must be a mapping { code, step, reason }`);
          return;
        }
        errors.push(...unknownKeyErrors(rawAck, ACK_KEYS, where));
        if (typeof rawAck.code !== 'string' || !(PIPELINE_ADVISORY_CODES as readonly string[]).includes(rawAck.code)) {
          errors.push(`${where}.code must be an advisory code (${PIPELINE_ADVISORY_CODES.join(', ')})`);
        }
        if (typeof rawAck.step !== 'string' || !ids.has(rawAck.step)) {
          errors.push(`${where}.step must name a step of this pipeline (got: ${String(rawAck.step)})`);
        }
        if (typeof rawAck.reason !== 'string' || rawAck.reason.trim().length === 0) {
          errors.push(`${where}.reason must be a non-empty sentence — why this shape is right for this flow`);
        }
        const key = `${String(rawAck.code)}:${String(rawAck.step)}`;
        if (seen.has(key)) errors.push(`${where}: duplicate acknowledgement for ${key}`);
        seen.add(key);
      });
    }
  }

  return errors;
}

// ============================================
// Catalog binding — the definition against the caller's agent catalog
// ============================================

/**
 * Structural subset of `CustomAgentSummary` (a `CustomAgentSummary[]` is
 * directly assignable). `intents === undefined` means the job's intent
 * catalog failed lenient discovery parsing — distinct from "no intents".
 */
export interface PipelineCatalogIntent {
  id: string;
  outcomes?: string[];
  /** Stop-hook subset (structural match of `IntentHooks`) — pin-needs advisories only. */
  hooks?: { stop: Array<{ artifact?: string; action?: string }> };
  /** Intent-level clarify knob (`infer.md` frontmatter) — the entry-channel advisory only; the job/agent default is not carried. */
  clarify?: boolean;
}
/** One declared REST connection as the catalog projects it — `self`/`allow` meta only, never baseUrl or headers. */
export interface PipelineCatalogApi {
  self?: boolean;
  allow?: string[];
}
export interface PipelineCatalogJob {
  id: string;
  intents?: PipelineCatalogIntent[];
  /** Merged agent ∪ job `apis` names (job wins). `undefined` = the definition failed lenient parsing. */
  apis?: Record<string, PipelineCatalogApi>;
}
export interface PipelineCatalogAgent {
  id: string;
  jobs: PipelineCatalogJob[];
}

/**
 * Catalog-binding rules — assumes `validatePipelineDef` already passed. Plain
 * messages, empty = valid. The catalog is the CALLER's (enable = enabler's,
 * activate = activator's — the one dispatch will resolve against); dispatch
 * stays the final authority. Verdict-edge satisfiability mirrors the
 * executor's switch semantics: a `verdict:<x>` edge can only ever match when
 * a DIRECT need is a job step whose pinned intent declares `<x>`.
 */
export function validatePipelineCatalogBinding(def: PipelineDef, agents: PipelineCatalogAgent[]): string[] {
  const errors: string[] = [];
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const remedy = 'import or create it in Agent Settings first';

  /** Pinned-intent resolution per step: the intent's outcomes, or why they are unknowable. */
  const intentOf = (step: JobStepDef): { intent?: PipelineCatalogIntent; unknown: boolean } => {
    const ref = parseCustomJobRef(step.customJobRef);
    if (ref === null) return { unknown: true };
    const job = agentById.get(ref.agentId)?.jobs.find((j) => j.id === ref.jobId);
    if (job === undefined) return { unknown: true };
    if (step.intent === undefined || step.intent === GENERAL_INTENT) return { unknown: false };
    if (job.intents === undefined) return { unknown: true };
    return { intent: job.intents.find((i) => i.id === step.intent), unknown: false };
  };

  def.steps.forEach((step) => {
    if (!isApprovalStep(step)) {
      const ref = parseCustomJobRef(step.customJobRef);
      if (ref !== null) {
        const agent = agentById.get(ref.agentId);
        const job = agent?.jobs.find((j) => j.id === ref.jobId);
        if (agent === undefined) {
          errors.push(`step "${step.id}": agent "${ref.agentId}" is not in your agent catalog — ${remedy}`);
        } else if (job === undefined) {
          errors.push(`step "${step.id}": agent "${ref.agentId}" has no job "${ref.jobId}" — ${remedy}, or fix its definition in Agent Settings`);
        } else if (step.intent !== undefined && step.intent !== GENERAL_INTENT) {
          if (job.intents === undefined) {
            errors.push(`step "${step.id}": the intent catalog of "${step.customJobRef}" failed to parse — fix the agent definition in Agent Settings`);
          } else if (!job.intents.some((i) => i.id === step.intent)) {
            errors.push(`step "${step.id}": job "${step.customJobRef}" declares no intent "${step.intent}"`);
          }
        }
        // onMissingVerdict names an outcome of the step's OWN pinned intent.
        if (job !== undefined && step.onMissingVerdict !== undefined && step.onMissingVerdict !== 'fail') {
          const { intent, unknown } = intentOf(step);
          if (!unknown && intent !== undefined) {
            if (intent.outcomes === undefined || intent.outcomes.length === 0) {
              errors.push(`step "${step.id}": onMissingVerdict is meaningless — intent "${intent.id}" declares no outcomes`);
            } else if (!intent.outcomes.includes(step.onMissingVerdict)) {
              errors.push(`step "${step.id}": onMissingVerdict "${step.onMissingVerdict}" is not an outcome of intent "${intent.id}" (declared: ${intent.outcomes.join(', ')})`);
            }
          }
        }
      }
    }
  });

  // The fetch trigger's BOUND connection: the named job must exist in the
  // caller's catalog and declare the connection as an EXTERNAL api (a self
  // entry targets this Ant server — polling it is not a case source). The
  // allow rules are judged server-side with the executor's own matcher. An
  // inline connection names no job and binds against nothing here.
  const fetch = def.on?.fetch;
  if (fetch && fetchConnectionSource(fetch) === 'bound') {
    const ref = parseCustomJobRef(fetch.customJobRef);
    const agent = ref ? agentById.get(ref.agentId) : undefined;
    const job = ref ? agent?.jobs.find((j) => j.id === ref.jobId) : undefined;
    if (ref && agent === undefined) {
      errors.push(`on.fetch: agent "${ref.agentId}" is not in your agent catalog — ${remedy}`);
    } else if (ref && job === undefined) {
      errors.push(`on.fetch: agent "${ref.agentId}" has no job "${ref.jobId}" — ${remedy}, or fix its definition in Agent Settings`);
    } else if (job?.apis !== undefined) {
      const api = job.apis[fetch.api ?? ''];
      if (api === undefined) {
        const names = Object.keys(job.apis);
        errors.push(
          `on.fetch: job "${fetch.customJobRef}" declares no API connection "${fetch.api}"${names.length > 0 ? ` (declared: ${names.join(', ')})` : ' (its apis map is empty)'}`,
        );
      } else if (api.self) {
        errors.push(`on.fetch: connection "${fetch.api}" is a self entry (this Ant server) — a poll needs an external API with a baseUrl`);
      }
    }
  }

  def.steps.forEach((step, index) => {

    // A verdict edge must be statically satisfiable: at least one DIRECT need
    // pins an intent that declares the named outcome. EVERY member of an
    // `a|b` disjunction is judged — a typo'd member is a silently dead half
    // of the branch. Needs whose catalog is unresolvable are skipped — their
    // own rule already errored.
    if (step.on !== undefined && step.on.startsWith('verdict:')) {
      const effectiveNeeds = step.needs ?? (index > 0 ? [def.steps[index - 1].id] : []);
      for (const outcome of verdictEdgeOutcomes(step.on)) {
        let satisfiable = false;
        let unknowable = false;
        for (const needId of effectiveNeeds) {
          const need = def.steps.find((s) => s.id === needId);
          if (need === undefined || isApprovalStep(need)) continue;
          const { intent, unknown } = intentOf(need);
          if (unknown || (need.intent !== undefined && need.intent !== GENERAL_INTENT && intent === undefined)) {
            unknowable = true;
            continue;
          }
          if (intent?.outcomes?.includes(outcome)) satisfiable = true;
        }
        if (!satisfiable && !unknowable) {
          errors.push(`step "${step.id}": on: ${step.on} — no direct dependency pins an intent that declares outcome "${outcome}" (that arm of the branch would always skip)`);
        }
      }
    }
  });

  return errors;
}

/** Field an advisory anchors to — an editor renders it under that field of the named step. */
export type PipelineAdvisoryField = 'context' | 'directive' | 'timeout' | 'needs' | 'onMissingVerdict' | 'discovers';

/** The closed advisory vocabulary — the validator judges `acknowledged[].code` against it. */
export const PIPELINE_ADVISORY_CODES = [
  'gate-holds-nothing',
  'gate-waits-forever',
  'self-pin',
  'pin-not-in-needs',
  'pin-has-no-producer-here',
  'case-identity-not-threaded',
  'chained-pinless-consumer',
  'unrouted-verdict-no-fallback',
  'entry-no-case-channel',
  'prev-success-under-concurrency',
  'discovery-no-case-channel',
  'discovery-under-serial-concurrency',
] as const;
export type PipelineAdvisoryCode = (typeof PIPELINE_ADVISORY_CODES)[number];

/**
 * One advisory: a wiring shape that is legal but tends to die silently at
 * run time. `stepId` + `field` let an editor anchor it to the offending
 * control; `message` carries the remedy. Advisory by design — never fed to
 * the enable/activate hard gate. Its lifecycle is {@link resolvePipelineAdvisories}.
 */
export interface PipelineAdvisory {
  code: PipelineAdvisoryCode;
  stepId?: string;
  field?: PipelineAdvisoryField;
  message: string;
}

export interface PipelineAcknowledgedAdvisory extends PipelineAdvisory {
  reason: string;
}

/**
 * The advisory lifecycle of one definition against one catalog. Nothing here
 * is stored — it is recomputed wherever it is shown (save response, GET,
 * list), so a catalog change is visible on the next read. `open` is what an
 * editor renders amber and what `--strict` refuses; `acknowledged` carries
 * the author's reason; `stale` is an acknowledgement whose finding no longer
 * fires (cleanup, never a gate).
 */
export interface PipelineAdvisoryResolution {
  open: PipelineAdvisory[];
  acknowledged: PipelineAcknowledgedAdvisory[];
  stale: PipelineAcknowledgement[];
}

/** Effective needs of one step (omitted = previous step in file order). */
function effectiveNeedsOf(def: PipelineDef): (id: string) => string[] {
  const stepByIndex = new Map(def.steps.map((s, i) => [s.id, i]));
  return (id: string): string[] => {
    const i = stepByIndex.get(id);
    if (i === undefined) return [];
    return def.steps[i].needs ?? (i > 0 ? [def.steps[i - 1].id] : []);
  };
}

/** Transitive closure of {@link effectiveNeedsOf}. */
function needsClosureOf(def: PipelineDef): (id: string) => Set<string> {
  const effectiveNeeds = effectiveNeedsOf(def);
  return (id: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...effectiveNeeds(id)];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...effectiveNeeds(cur));
    }
    return seen;
  };
}

/**
 * Definition-structural advisories — catalog-free findings. A terminal gate
 * still differentiates the run's final status (an `on.upstream` edge may
 * consume it), and a gate with no timeout is a legal "wait for a person" —
 * so both are advisories a person weighs, never validator errors.
 */
export function collectPipelineDefAdvisoryItems(def: PipelineDef): PipelineAdvisory[] {
  const out: PipelineAdvisory[] = [];
  // `run.prevSuccess.*` is "the newest COMPLETED run of this activation" frozen
  // at fire — with N live runs that watermark races (a sibling may complete
  // between two fires), so the cross-run channel is advisory under concurrency.
  if (resolveRunConcurrency(def) > 1) {
    const refersPrevSuccess = (s: string) => /\{\{\s*run\.prevSuccess\./.test(s);
    for (const step of def.steps) {
      if (isApprovalStep(step)) continue;
      const field: PipelineAdvisoryField | undefined = refersPrevSuccess(step.directive ?? '')
        ? 'directive'
        : (step.context ?? []).some(refersPrevSuccess)
          ? 'context'
          : undefined;
      if (!field) continue;
      out.push({
        code: 'prev-success-under-concurrency',
        stepId: step.id,
        field,
        message: `step "${step.id}" reads {{run.prevSuccess.*}} while concurrency is ${resolveRunConcurrency(def)}: the watermark is the newest completed run at fire time, and sibling runs complete in any order — a run may see a watermark newer than the work it should follow. Keep concurrency at 1 for watermark-driven flows, or carry the case identity in the directive instead`,
      });
    }
  }
  // Fan-out: the first per-case step is the ONLY place a case run learns its
  // case (`entry-no-case-channel`'s sibling); and under concurrency 1 the
  // discovered cases drain one at a time — legal, but rarely what the author
  // pictured when they fanned out.
  const discoversAt = discoveryStepIndex(def);
  if (discoversAt !== undefined) {
    const discoversStep = def.steps[discoversAt] as JobStepDef;
    const perCase = perCaseStepIds(def);
    const refersItem = (s: string) => /\{\{\s*trigger\.item\./.test(s);
    const firstPerCase = def.steps.find((s) => perCase.has(s.id) && !isApprovalStep(s)) as JobStepDef | undefined;
    if (firstPerCase && !refersItem(firstPerCase.directive ?? '') && !(firstPerCase.context ?? []).some(refersItem)) {
      out.push({
        code: 'discovery-no-case-channel',
        stepId: firstPerCase.id,
        field: 'directive',
        message: `step "${firstPerCase.id}" is the first step of every fanned-out case run but reads no {{trigger.item.*}} — it has no way to learn WHICH case it was fired for. Reference {{trigger.item.key}} (and the fields "${discoversStep.id}" declares) in its directive, or pin cases/{{trigger.item.key}}/**`,
      });
    }
    if (resolveRunConcurrency(def) === 1) {
      out.push({
        code: 'discovery-under-serial-concurrency',
        stepId: discoversStep.id,
        field: 'discovers',
        message: `step "${discoversStep.id}" fans out while concurrency is 1: every discovered case is claimed, but the case runs start ONE at a time as each finishes. Raise concurrency (up to ${DEFAULT_PIPELINE_CAPS.maxLiveRunsPerActivation}) if the cases should run side by side`,
      });
    }
  }
  const dependedOn = new Set<string>();
  def.steps.forEach((step, i) => {
    const needs = step.needs ?? (i > 0 ? [def.steps[i - 1].id] : []);
    for (const need of needs) dependedOn.add(need);
  });
  for (const step of def.steps) {
    if (!isApprovalStep(step)) continue;
    if (!dependedOn.has(step.id)) {
      out.push({
        code: 'gate-holds-nothing',
        stepId: step.id,
        field: 'needs',
        message: `approval step "${step.id}" holds back nothing: no step needs it, so its decision only sets the run's final status. A decision the run does not execute belongs in the report's Left to a person, not in the graph — wire the steps it should hold back, or record the decision there and drop the gate`,
      });
    }
    // The authoring contract: a gate whose timeout is long or absent carries
    // remindAfter, so a waiting run is never forgotten. Neither set = nobody
    // is ever told the run is parked.
    if (step.timeout === undefined && step.remindAfter === undefined) {
      out.push({
        code: 'gate-waits-forever',
        stepId: step.id,
        field: 'timeout',
        message: `approval step "${step.id}" waits forever and reminds nobody — set remindAfter so a parked run resurfaces, and a timeout if the run should not wait indefinitely`,
      });
    }
  }
  return out;
}

/**
 * Catalog-dependent advisories. Producer identification is deliberately
 * exact-match — the pin glob string equals a sibling step intent's declared
 * stop artifact glob — because pins are authored by copying stop globs; a
 * fuzzy overlap test would trade the zero-false-positive property for
 * coverage no observed incident has needed.
 */
export function collectPipelineCatalogAdvisoryItems(def: PipelineDef, agents: PipelineCatalogAgent[]): PipelineAdvisory[] {
  const out: PipelineAdvisory[] = [];
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const intentOfStep = (step: JobStepDef): PipelineCatalogIntent | undefined => {
    const ref = parseCustomJobRef(step.customJobRef);
    if (ref === null || step.intent === undefined || step.intent === GENERAL_INTENT) return undefined;
    const job = agentById.get(ref.agentId)?.jobs.find((j) => j.id === ref.jobId);
    return job?.intents?.find((i) => i.id === step.intent);
  };
  // An outcome-declaring intent seals a verdict, and a missing one FAILS the
  // step (retryable, but a step without `retry` has no budget) — even when no
  // downstream edge reads it. Unrouted and without `onMissingVerdict`, the run
  // dies for a decision nobody consumes. Routed steps are exempt on purpose:
  // there the fallback is a routing choice the author must make knowingly.
  const effectiveNeeds = effectiveNeedsOf(def);
  const verdictReaders = new Set<string>();
  for (const step of def.steps) {
    if (step.on === undefined || !step.on.startsWith('verdict:')) continue;
    for (const need of effectiveNeeds(step.id)) verdictReaders.add(need);
  }
  for (const step of def.steps) {
    if (isApprovalStep(step)) continue;
    const outcomes = intentOfStep(step)?.outcomes ?? [];
    if (outcomes.length === 0 || step.onMissingVerdict !== undefined || verdictReaders.has(step.id)) continue;
    out.push({
      code: 'unrouted-verdict-no-fallback',
      stepId: step.id,
      field: 'onMissingVerdict',
      message: `step "${step.id}" pins intent "${step.intent}", which declares outcomes (${outcomes.join(', ')}), but no edge routes on its verdict and no onMissingVerdict is set — a run that seals no valid verdict fails this step (and, under abort, the whole run) for a decision nothing reads; set onMissingVerdict: <outcome>, or route on the verdict`,
    });
  }
  // A manual or chained pipeline's entry step is where the case arrives, and
  // an entry learns it through a pin or through clarify — template variables
  // there render only time and ids. Pinning nothing, saying nothing, and
  // running an intent that declares `clarify: false` on a case-keyed output
  // path, the step cannot ask: it proceeds on defaults and seals a case nobody
  // supplied (the rapid-killing-pilot shape). Judged on the explicit
  // intent-level knob only (the job/agent default is not in the summary) and
  // only on `*` globs — a case-free intent writes a fixed path.
  if (def.on?.schedule === undefined) {
    const closureOfEntry = needsClosureOf(def);
    for (const step of def.steps) {
      if (isApprovalStep(step)) continue;
      if (closureOfEntry(step.id).size > 0) continue;
      if ((step.context ?? []).length > 0 || /\{\{/.test(step.directive ?? '')) continue;
      const intent = intentOfStep(step);
      if (intent?.clarify !== false) continue;
      if (!(intent.hooks?.stop ?? []).some((h) => h.artifact?.includes('*'))) continue;
      out.push({
        code: 'entry-no-case-channel',
        stepId: step.id,
        field: 'directive',
        message: def.on?.fetch
          ? `step "${step.id}" is the run's entry and never reads the claimed item: its directive carries no {{trigger.item.*}} value and intent "${step.intent}" declares clarify: false — the step will proceed on defaults and seal a case nobody supplied; reference {{${PIPELINE_ITEM_KEY_TEMPLATE_VAR}}} (and declared fields) in the directive`
          : `step "${step.id}" is the run's entry and has no channel to learn its case: it pins nothing, its directive carries no run-known value, and intent "${step.intent}" declares clarify: false — the step will proceed on defaults and seal a case nobody supplied; enable clarify on the intent (Agent Builder), or pin the case's artifacts`,
      });
    }
  }
  // Every stop glob the CATALOG can produce, whichever agent/job/intent owns
  // it — the discriminator that separates "a pin this pipeline forgot to
  // produce" from "a concrete file a person put in the container".
  const catalogGlobs = new Set<string>();
  for (const agent of agents) {
    for (const job of agent.jobs ?? []) {
      for (const intent of job.intents ?? []) {
        for (const hook of intent.hooks?.stop ?? []) {
          if (hook.artifact !== undefined) catalogGlobs.add(hook.artifact);
        }
      }
    }
  }
  // stop artifact glob → job steps whose pinned intent declares it
  const producersByGlob = new Map<string, string[]>();
  for (const step of def.steps) {
    if (isApprovalStep(step)) continue;
    const ref = parseCustomJobRef(step.customJobRef);
    if (ref === null || step.intent === undefined || step.intent === GENERAL_INTENT) continue;
    const job = agentById.get(ref.agentId)?.jobs.find((j) => j.id === ref.jobId);
    const intent = job?.intents?.find((i) => i.id === step.intent);
    for (const hook of intent?.hooks?.stop ?? []) {
      if (hook.artifact === undefined) continue;
      producersByGlob.set(hook.artifact, [...(producersByGlob.get(hook.artifact) ?? []), step.id]);
    }
  }
  if (producersByGlob.size === 0) return out;
  const closureOf = needsClosureOf(def);
  for (const step of def.steps) {
    if (isApprovalStep(step)) continue;
    const ancestors = closureOf(step.id);
    const directiveHasVars = /\{\{/.test(step.directive ?? '');
    // `*` pins whose producer is upstream — judged once per step, below.
    const unthreaded: Array<{ pin: string; producer: string }> = [];
    for (const pin of step.context ?? []) {
      // A step pinning its OWN intent's stop glob has no producer upstream: on
      // a fresh project the glob matches nothing and dispatch fails the step
      // (`invalid-context-path`), and where a prior case left a match it pins
      // that case's file.
      if ((producersByGlob.get(pin) ?? []).includes(step.id)) {
        out.push({
          code: 'self-pin',
          stepId: step.id,
          field: 'context',
          message: `step "${step.id}" pins "${pin}", its own intent's stop artifact — on a first run the glob matches nothing and the step fails at dispatch; a step never pins its own output (an entry step pins nothing): drop the pin`,
        });
        continue;
      }
      const producers = (producersByGlob.get(pin) ?? []).filter((p) => p !== step.id);
      if (producers.length === 0) {
        // No step of THIS pipeline writes it, yet the catalog says an intent
        // does — so the pin resolves only from a container some OTHER
        // pipeline already filled. A project holds one active pipeline, so
        // that is never a co-activation: it is a deactivate-then-activate
        // swap, and on a project the upstream never ran the glob matches
        // nothing and the step fails at dispatch (`invalid-context-path`).
        // Advisory, not a gate — the swap is a legitimate boundary hand-over
        // when the report says so.
        if (catalogGlobs.has(pin)) {
          out.push({
            code: 'pin-has-no-producer-here',
            stepId: step.id,
            field: 'context',
            message: `step "${step.id}" pins "${pin}", which no step of this pipeline produces — it resolves only in a project another pipeline already filled, and a project holds one active pipeline at a time: the hand-over is deactivate-then-activate on the SAME project, never both at once. On a project the producer never ran this step fails at dispatch. Add the producing step here, or say the swap in the report's Left to a person`,
          });
        }
        continue;
      }
      const upstream = producers.filter((p) => ancestors.has(p));
      if (upstream.length === 0) {
        // What you pin, you needs — a producer outside the needs closure is
        // wired by file-order luck (works while sibling ordering happens to
        // run the producer first, breaks under any reordering).
        out.push({
          code: 'pin-not-in-needs',
          stepId: step.id,
          field: 'needs',
          message: `step "${step.id}" pins "${pin}" produced by step "${producers.join('"/"')}", which is not in its needs chain — what you pin, you needs: add the producer to needs, or drop the pin`,
        });
        continue;
      }
      // A `*` where the case's key belongs matches every case in the tree.
      // The one thing the pipeline CAN do about it is tell the step which of
      // the matched files is this run's — through a step-output reference or
      // a static partition variable in the directive. A directive with no
      // template reference at all has dropped the case identity.
      if (pin.includes('*') && !directiveHasVars) unthreaded.push({ pin, producer: upstream[0] });
    }
    if (unthreaded.length > 0) {
      const pins = unthreaded.map((u) => `"${u.pin}"`).join(', ');
      const producer = unthreaded[0].producer;
      out.push({
        code: 'case-identity-not-threaded',
        stepId: step.id,
        field: 'directive',
        message: `step "${step.id}" pins ${pins} — a domain-keyed glob that matches every case in the tree — and its directive carries no run-known value; thread the case: {{steps.${producer}.artifacts}} / {{steps.${producer}.answer}}, or a static partition variable`,
      });
    }
  }
  // Chained pipelines only (the observed failure mode): the trigger comment's
  // "pin only what this pipeline's own steps produce" gets over-applied and a
  // consumer ships with no pins at all, while its upstream steps DECLARE stop
  // globs. Advisory, never the hard gate — a consumer that truly needs no
  // upstream file stays saveable.
  if (def.on?.upstream !== undefined) {
    for (const step of def.steps) {
      if (isApprovalStep(step)) continue;
      if ((step.context ?? []).length > 0) continue;
      const ancestors = closureOf(step.id);
      const upstreamGlobs = [...producersByGlob.entries()]
        .filter(([, producers]) => producers.some((p) => p !== step.id && ancestors.has(p)))
        .map(([glob]) => glob);
      if (upstreamGlobs.length === 0) continue;
      out.push({
        code: 'chained-pinless-consumer',
        stepId: step.id,
        field: 'context',
        message: `chained pipeline: step "${step.id}" pins nothing while its upstream steps declare ${upstreamGlobs.map((g) => `"${g}"`).join(', ')} — only the UPSTREAM RUN's artifacts are out of pin reach; within this pipeline the duty is unchanged: pin the upstream step's stop glob, or leave the step pinless only if it truly consumes none of it`,
      });
    }
  }
  return out;
}

/** Every advisory the collectors fire, structured — before acknowledgements are applied. */
export function collectPipelineAdvisoryItems(def: PipelineDef, agents: PipelineCatalogAgent[]): PipelineAdvisory[] {
  return [...collectPipelineDefAdvisoryItems(def), ...collectPipelineCatalogAdvisoryItems(def, agents)];
}

const acknowledgementKey = (code: string, step: string | undefined): string => `${code}:${step ?? ''}`;

/**
 * The ONE owner of the advisory lifecycle — every reader (editor, save
 * response, GET, list, offline CLI) calls this and nothing else, so the
 * amber count means the same thing everywhere.
 */
export function resolvePipelineAdvisories(def: PipelineDef, agents: PipelineCatalogAgent[]): PipelineAdvisoryResolution {
  const acks = new Map((def.acknowledged ?? []).map((a) => [acknowledgementKey(a.code, a.step), a]));
  const open: PipelineAdvisory[] = [];
  const acknowledged: PipelineAcknowledgedAdvisory[] = [];
  const matched = new Set<string>();
  for (const item of collectPipelineAdvisoryItems(def, agents)) {
    const key = acknowledgementKey(item.code, item.stepId);
    const ack = acks.get(key);
    if (ack) {
      matched.add(key);
      acknowledged.push({ ...item, reason: ack.reason });
    } else {
      open.push(item);
    }
  }
  const stale = (def.acknowledged ?? []).filter((a) => !matched.has(acknowledgementKey(a.code, a.step)));
  return { open, acknowledged, stale };
}

/** True when a resolution has anything worth showing or sending. */
export function hasPipelineAdvisories(r: PipelineAdvisoryResolution): boolean {
  return r.open.length > 0 || r.acknowledged.length > 0 || r.stale.length > 0;
}
