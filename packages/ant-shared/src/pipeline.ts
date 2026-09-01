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

import { parseCustomJobRef, isValidCustomId, validateArtifactGlob, GENERAL_INTENT } from './custom-agents';
import { DIRECTIVE_MAX_CHARS } from './session-log';
import type { CustomAgentOrgPermissions } from './custom-agents';

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
/** Edge condition against the closest `needs` ancestor's outcome. */
export type StepEdgeCondition = 'success' | 'failure' | 'always';
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
}

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
}

export type PipelineStepDef = JobStepDef | ApprovalStepDef;

export function isApprovalStep(step: PipelineStepDef): step is ApprovalStepDef {
  return (step as ApprovalStepDef).type === 'approval';
}

export interface PipelineDef {
  version: typeof PIPELINE_DEF_VERSION;
  name: string;
  on: { schedule: PipelineScheduleTrigger };
  defaults?: { onStepFailure?: StepFailurePolicy };
  steps: PipelineStepDef[];
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
export const PIPELINE_EXPORT_FILE_NAMES: readonly string[] = [
  PIPELINE_FILE_NAME,
  PIPELINE_AVAILABILITY_FILE_NAME,
];

export function isExportablePipelineFile(relPath: string): boolean {
  return PIPELINE_EXPORT_FILE_NAMES.includes(relPath.replace(/\\/g, '/'));
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
  /** Reserved for the canonical phase (project+feature scope). Universal ⇒ omitted. */
  featureId?: string;
}

const ACTIVATION_KEYS = ['pipelineId', 'pipelineScope', 'projectId', 'activatedAt', 'activatedBy', 'featureId'];

/** Plain messages, empty = valid (validateMcpServers precedent). */
export function validatePipelineActivation(raw: unknown): string[] {
  if (!isPlainObject(raw)) return ['activation must be an object'];
  const errors: string[] = [];
  errors.push(...unknownKeyErrors(raw, ACTIVATION_KEYS, 'activation'));
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
 * + derived FE state). Activation alone means `waiting`; a live run makes it
 * `running` / `awaiting_human`.
 */
export interface ActivePipelineInfo {
  pipelineId: string;
  pipelineName: string;
  state: 'waiting' | 'running' | 'awaiting_human';
  nextFireAt?: string;
  currentRunId?: string;
}

/**
 * Directive template whitelist — the ONLY substitutions the dispatcher
 * performs. No general template engine, no user code path. `steps.*`
 * substitution is a reserved v2 axis; the validator rejects it explicitly
 * so an author never concludes the knob silently works.
 */
export const PIPELINE_TEMPLATE_VARS = ['trigger.fireDate', 'trigger.fireEpoch', 'run.id'] as const;
export type PipelineTemplateVar = (typeof PIPELINE_TEMPLATE_VARS)[number];

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
  maxConcurrentRuns: number;
}

export const DEFAULT_PIPELINE_CAPS: PipelineCaps = {
  maxPipelines: 20,
  maxStepsPerPipeline: 20,
  minCronIntervalMinutes: 5,
  maxConcurrentRuns: 3,
};

// ============================================
// Run / step / gate records (runs JSONL + Redis projection + API)
// ============================================

export type PipelineRunStatus =
  | 'running'
  | 'awaiting_human'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'expired';

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

export type PipelineFiredBy = 'cron' | 'manual';

export type GateDecision = 'approved' | 'rejected' | 'expired_approve' | 'expired_reject';

export interface GateRecord {
  gateId: string;
  cardId: string;
  prompt: string;
  armedAt: string;
  timeoutAt?: string;
  onTimeout?: GateTimeoutAction;
  decision?: GateDecision;
  decidedBy?: string;
  decidedAt?: string;
  via?: 'in-app' | 'api';
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

export interface StepRecord {
  stepId: string;
  status: PipelineStepStatus;
  /** Current jobId (clarify end-and-resume can repoint it — 1 step = 1..n jobIds). */
  jobId?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  gate?: GateRecord;
  clarify?: ClarifyRecord;
  /** Chat turn the step's user-turn line was minted under (coordinator-owned). */
  turnId?: string;
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
}

/** Append-only run event line (`.ant/pipeline-activations/{projectId}/runs/{runId}.jsonl`). */
export interface PipelineRunEvent {
  ts: string;
  event:
    | 'fired'
    | 'step_dispatched'
    | 'step_completed'
    | 'awaiting_human'
    | 'human_resolved'
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
  state: 'waiting' | 'running' | 'awaiting_human' | 'broken';
  /** Server-computed next fire; absent on `broken`. */
  nextFireAt?: string;
  currentRunId?: string;
  lastRun?: { runId: string; status: PipelineRunStatus; firedAt: string };
}

/** List-rail entry. `nextFireAt` is SERVER-computed — the FE never parses cron. */
export interface PipelineListEntry {
  id: string;
  name: string;
  cron: string;
  tz?: string;
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
  /** Pending approval gates across own activations. */
  pendingApprovalCount: number;
}

export interface PipelinePendingApproval {
  /** Absent = gate (pre-clarify rows). Clarify rows carry the clarifyId in gateId/cardId. */
  kind?: 'gate' | 'clarify';
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
  /** Clarify rows only: the asking job (funnel key). */
  jobId?: string;
}

// ============================================
// Validation — plain messages, empty = valid (validateMcpServers precedent)
// ============================================

const STEP_ID_HINT = 'lowercase letters, digits and hyphens (e.g. "collect-sources")';
const DEF_KEYS = ['version', 'name', 'on', 'defaults', 'steps'];
/** Keys that existed in def v1 or belong to future axes — reject loudly, never ignore. */
const RESERVED_DEF_KEYS: Record<string, string> = {
  enabled: '"enabled" lives in the availability sidecar — use POST /api/pipelines/{id}/enable|disable, not the definition',
  projectId: '"projectId" moved to activation — the project binding is set when activating, not in the definition',
};
const SCHEDULE_KEYS = ['cron', 'tz', 'onMissed', 'overlap'];
const JOB_STEP_KEYS = ['id', 'customJobRef', 'intent', 'directive', 'context', 'needs', 'on'];
const APPROVAL_STEP_KEYS = ['id', 'type', 'prompt', 'needs', 'on', 'channels', 'timeout'];
/** Author-visible knobs that exist in the design but not in v1 — reject loudly, never ignore. */
const RESERVED_STEP_KEYS: Record<string, string> = {
  retry: 'step "retry" is not supported yet (scheduler-level retry is a v2 knob)',
  remindAfter: 'step "remindAfter" is not supported yet (reminder arms are a v2 knob)',
  jobType: 'step "jobType" is not supported yet (canonical pipeline steps are a future axis)',
  feature: 'step "feature" is not supported yet (canonical pipeline steps are a future axis)',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

function templateVarErrors(directive: string, stepId: string): string[] {
  const errors: string[] = [];
  const re = /\{\{\s*([^}]*?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(directive)) !== null) {
    const name = m[1];
    if ((PIPELINE_TEMPLATE_VARS as readonly string[]).includes(name)) continue;
    if (name.startsWith('steps.')) {
      errors.push(`step "${stepId}": template variable "{{${name}}}" is not supported yet (step-output substitution is a v2 axis)`);
    } else {
      errors.push(`step "${stepId}": unknown template variable "{{${name}}}" (allowed: ${PIPELINE_TEMPLATE_VARS.map((v) => `{{${v}}}`).join(', ')})`);
    }
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
 * Every rule the pipeline store enforces, as plain messages. Empty = valid.
 * Intent-id EXISTENCE (against the job's catalog) and cron minimum-interval
 * are server-side checks — they need the definition loader / cron parser.
 */
export function validatePipelineDef(
  raw: unknown,
  caps: Pick<PipelineCaps, 'maxStepsPerPipeline'> = DEFAULT_PIPELINE_CAPS,
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

  // Trigger
  if (!isPlainObject(raw.on) || !isPlainObject(raw.on.schedule)) {
    errors.push('on.schedule is required (cron trigger)');
  } else {
    const sched = raw.on.schedule as Record<string, unknown>;
    errors.push(...unknownKeyErrors(raw.on, ['schedule'], 'on'));
    errors.push(...unknownKeyErrors(sched, SCHEDULE_KEYS, 'on.schedule'));
    const cronErr = cronShapeError(sched.cron);
    if (cronErr) errors.push(cronErr);
    if (sched.tz !== undefined && (typeof sched.tz !== 'string' || sched.tz.trim().length === 0)) {
      errors.push('on.schedule.tz must be a non-empty string (IANA timezone)');
    }
    if (sched.onMissed !== undefined && sched.onMissed !== 'skip' && sched.onMissed !== 'runOnce') {
      errors.push(`on.schedule.onMissed must be "skip" or "runOnce" (got: ${String(sched.onMissed)})`);
    }
    if (sched.overlap !== undefined && sched.overlap !== 'skip' && sched.overlap !== 'queue') {
      errors.push(
        sched.overlap === 'cancelPrevious'
          ? 'on.schedule.overlap "cancelPrevious" is not supported yet — use "skip" or "queue"'
          : `on.schedule.overlap must be "skip" or "queue" (got: ${String(sched.overlap)})`,
      );
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

  const ids = new Set<string>();
  const shapedSteps: Array<{ id: string; needs?: string[]; isApproval: boolean }> = [];
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

    if (rawStep.needs !== undefined) {
      if (!Array.isArray(rawStep.needs) || rawStep.needs.some((n) => typeof n !== 'string')) {
        errors.push(`step "${stepId}": needs must be an array of step ids`);
      } else if ((rawStep.needs as string[]).includes(stepId)) {
        errors.push(`step "${stepId}": needs must not reference itself`);
      }
    }
    if (rawStep.on !== undefined && rawStep.on !== 'success' && rawStep.on !== 'failure' && rawStep.on !== 'always') {
      errors.push(`step "${stepId}": on must be "success", "failure" or "always" (got: ${String(rawStep.on)})`);
    }

    if (rawStep.type === 'approval') {
      errors.push(...unknownKeyErrors(rawStep, APPROVAL_STEP_KEYS, `step "${stepId}"`, RESERVED_STEP_KEYS));
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
    } else if (rawStep.type !== undefined) {
      errors.push(`step "${stepId}": unknown step type "${String(rawStep.type)}" (job steps omit type; gates use type: approval)`);
    } else {
      errors.push(...unknownKeyErrors(rawStep, JOB_STEP_KEYS, `step "${stepId}"`, RESERVED_STEP_KEYS));
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
          errors.push(...templateVarErrors(rawStep.directive, stepId));
        }
      }
      if (rawStep.intent !== undefined) {
        if (typeof rawStep.intent !== 'string' || (!isValidCustomId(rawStep.intent) && rawStep.intent !== GENERAL_INTENT)) {
          errors.push(`step "${stepId}": intent must be a catalog intent id (${STEP_ID_HINT})`);
        }
      }
      if (rawStep.context !== undefined) {
        if (!Array.isArray(rawStep.context) || rawStep.context.some((c) => typeof c !== 'string' || c.trim().length === 0)) {
          errors.push(`step "${stepId}": context must be an array of non-empty paths`);
        } else {
          // Glob pins share the hooks.stop artifact vocabulary; concrete
          // paths stay loose here and are judged at dispatch, as before.
          for (const pin of rawStep.context as string[]) {
            const v = pin.trim();
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
  // Gate-anchor rule (pure structure — file order): an approval step's chat
  // card anchors to the producing job's turn, so a rootless gate has no home.
  shapedSteps.forEach((step, index) => {
    if (!step.isApproval) return;
    const effective = step.needs ?? (index > 0 ? [shapedSteps[index - 1].id] : []);
    if (effective.length === 0) {
      errors.push(`step "${step.id}": an approval gate needs an upstream step (it cannot be the entry step)`);
    }
  });
  if (errors.length === 0 && !isAcyclic(shapedSteps)) {
    errors.push('steps: the needs graph must be acyclic');
  }

  return errors;
}
