/**
 * Pipeline scheduling contract (BE↔FE) — file-defined pipelines that chain
 * universal (custom agent) job runs on a cron trigger with human approval
 * gates. Vocabulary: **Pipeline** = one YAML definition (trigger + step DAG),
 * **Run** = one firing of a pipeline, **Step** = one DAG node (a universal job
 * dispatch, or an approval gate that issues no job).
 *
 * The definition lives on disk (`.ant/pipelines/{id}/pipeline.yaml`, account
 * scope — disk is SSOT); Redis holds only rebuildable projections. This module
 * is dependency-free by package doctrine: structural validation only. Cron
 * parsing / next-fire computation is server-side (`core/pipelines/cron.ts`) —
 * the FE never computes cron locally, it round-trips `preview-fires`.
 *
 * `validatePipelineDef` follows the `validateMcpServers` precedent: every rule
 * as plain messages, empty = valid. Callers decide the failure shape — the
 * store throws, the HTTP gate answers 400, the editor form disables saving.
 */

import { parseCustomJobRef, isValidCustomId, GENERAL_INTENT } from './custom-agents';

// ============================================
// Definition (pipeline.yaml)
// ============================================

export const PIPELINE_FILE_NAME = 'pipeline.yaml';
export const PIPELINE_DEF_VERSION = 1;

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
  /** Work statement for the run. Template vars: see PIPELINE_TEMPLATE_VARS. */
  directive: string;
  /** `@ctx` pins — container-relative artifact paths, existence-checked at dispatch. */
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
  enabled: boolean;
  /** All steps' sessions/artifacts land in this universal container. */
  projectId: string;
  on: { schedule: PipelineScheduleTrigger };
  defaults?: { onStepFailure?: StepFailurePolicy };
  steps: PipelineStepDef[];
}

/**
 * Directive template whitelist — the ONLY substitutions the dispatcher
 * performs. No general template engine, no user code path. `steps.*`
 * substitution is a reserved v2 axis; the validator rejects it explicitly
 * so an author never concludes the knob silently works.
 */
export const PIPELINE_TEMPLATE_VARS = ['trigger.fireDate', 'trigger.fireEpoch', 'run.id'] as const;
export type PipelineTemplateVar = (typeof PIPELINE_TEMPLATE_VARS)[number];

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

export interface StepRecord {
  stepId: string;
  status: PipelineStepStatus;
  /** Current jobId (clarify end-and-resume can repoint it — 1 step = 1..n jobIds). */
  jobId?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  gate?: GateRecord;
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
}

/** Append-only run event line (`.ant/pipelines/{id}/runs/{runId}.jsonl`). */
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

/** List-rail entry. `nextFireAt` is SERVER-computed — the FE never parses cron. */
export interface PipelineListEntry {
  id: string;
  name: string;
  enabled: boolean;
  projectId: string;
  cron: string;
  tz?: string;
  stepCount: number;
  nextFireAt?: string;
  lastRun?: { runId: string; status: PipelineRunStatus; firedAt: string };
  pendingApprovalCount: number;
}

export interface PipelinePendingApproval {
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
}

// ============================================
// Validation — plain messages, empty = valid (validateMcpServers precedent)
// ============================================

const STEP_ID_HINT = 'lowercase letters, digits and hyphens (e.g. "collect-sources")';
const DEF_KEYS = ['version', 'name', 'enabled', 'projectId', 'on', 'defaults', 'steps'];
const SCHEDULE_KEYS = ['cron', 'tz', 'onMissed', 'overlap'];
const JOB_STEP_KEYS = ['id', 'customJobRef', 'intent', 'directive', 'context', 'needs', 'on'];
const APPROVAL_STEP_KEYS = ['id', 'type', 'prompt', 'needs', 'on', 'channels', 'timeout'];
/** Author-visible knobs that exist in the design but not in v1 — reject loudly, never ignore. */
const RESERVED_STEP_KEYS: Record<string, string> = {
  retry: 'step "retry" is not supported yet (scheduler-level retry is a v2 knob)',
  remindAfter: 'step "remindAfter" is not supported yet (reminder arms are a v2 knob)',
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
  errors.push(...unknownKeyErrors(raw, DEF_KEYS, 'pipeline'));

  if (raw.version !== PIPELINE_DEF_VERSION) {
    errors.push(`version must be ${PIPELINE_DEF_VERSION} (got: ${String(raw.version)})`);
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  } else if (raw.name.length > 100) {
    errors.push('name must be at most 100 characters');
  }
  if (typeof raw.enabled !== 'boolean') errors.push('enabled must be a boolean');
  if (typeof raw.projectId !== 'string' || raw.projectId.trim().length === 0) {
    errors.push('projectId must be a non-empty string');
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
  const shapedSteps: Array<{ id: string; needs?: string[] }> = [];
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
      if (typeof rawStep.directive !== 'string' || rawStep.directive.trim().length === 0) {
        errors.push(`step "${stepId}": directive must be a non-empty string`);
      } else {
        errors.push(...templateVarErrors(rawStep.directive, stepId));
      }
      if (rawStep.intent !== undefined) {
        if (typeof rawStep.intent !== 'string' || (!isValidCustomId(rawStep.intent) && rawStep.intent !== GENERAL_INTENT)) {
          errors.push(`step "${stepId}": intent must be a catalog intent id (${STEP_ID_HINT})`);
        }
      }
      if (rawStep.context !== undefined) {
        if (!Array.isArray(rawStep.context) || rawStep.context.some((c) => typeof c !== 'string' || c.trim().length === 0)) {
          errors.push(`step "${stepId}": context must be an array of non-empty paths`);
        }
      }
    }

    shapedSteps.push({
      id: stepId,
      needs: Array.isArray(rawStep.needs) ? (rawStep.needs as unknown[]).filter((n): n is string => typeof n === 'string') : undefined,
    });
  });

  // needs references + cycle check (only meaningful once ids are sane)
  for (const step of shapedSteps) {
    for (const dep of step.needs ?? []) {
      if (!ids.has(dep)) errors.push(`step "${step.id}": needs references unknown step "${dep}"`);
    }
  }
  if (errors.length === 0 && !isAcyclic(shapedSteps)) {
    errors.push('steps: the needs graph must be acyclic');
  }

  return errors;
}
