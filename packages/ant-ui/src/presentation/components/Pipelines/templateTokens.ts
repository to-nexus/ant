/**
 * The directive/pin template vocabulary, in words — the FE's ONE owner.
 *
 * The token surface is CLOSED (`PIPELINE_TEMPLATE_VARS` +
 * `PIPELINE_STEP_OUTPUT_FIELDS`), so the label tables are keyed as `Record`
 * over those unions: adding a token upstream without labelling it here is a
 * TYPE error, not a drift a name grep might miss. Two hand-copied lists used
 * to answer "which variables may I use" (the directive's and the pin's) and
 * the pin's had already lost `run.prevSuccess.*`, which `pinTemplateErrors`
 * accepts — `availableStaticTokens` is now the single gate for both.
 */

import { Clock, FileText, Hash, History, Inbox, Link2, MessageSquare, Tag, TextCursorInput, type LucideIcon } from 'lucide-react';
import {
  PIPELINE_ITEM_KEY_TEMPLATE_VAR,
  PIPELINE_ITEM_TEMPLATE_PREFIX,
  PIPELINE_STEP_OUTPUT_FIELDS,
  PIPELINE_TEMPLATE_VARS,
  PIPELINE_UPSTREAM_TEMPLATE_PREFIX,
  discoveryItemTemplateVars,
  discoveryStepIndex,
  fetchItemTemplateVars,
  isApprovalStep,
  perCaseStepIds,
  upstreamTemplateVars,
  type PipelineDef,
  type PipelineStepOutputField,
  type PipelineTemplateVar,
} from '@ant/shared';

export interface TokenSpec {
  /** The raw name inside the braces. */
  name: string;
  /** Short chip face — what a person reads instead of the token. */
  faceKey: string;
  faceFallback: string;
  /** The long explanation, shown with the raw token on hover. */
  hintKey: string;
  hintFallback: string;
  icon: LucideIcon;
}

/** Every static variable the dispatcher substitutes — exhaustive by construction. */
export const STATIC_TOKENS: Record<PipelineTemplateVar, TokenSpec> = {
  'trigger.fireDate': {
    name: 'trigger.fireDate',
    faceKey: 'step.tokenFace.fireDate',
    faceFallback: 'Fire time',
    hintKey: 'step.templateVar.fireDate',
    hintFallback: 'Fire time (ISO)',
    icon: Clock,
  },
  'trigger.fireEpoch': {
    name: 'trigger.fireEpoch',
    faceKey: 'step.tokenFace.fireEpoch',
    faceFallback: 'Fire time (ms)',
    hintKey: 'step.templateVar.fireEpoch',
    hintFallback: 'Fire time (epoch ms)',
    icon: Hash,
  },
  'run.id': {
    name: 'run.id',
    faceKey: 'step.tokenFace.runId',
    faceFallback: 'Run id',
    hintKey: 'step.templateVar.runId',
    hintFallback: 'Run id',
    icon: Tag,
  },
  'run.prevSuccess.fireDate': {
    name: 'run.prevSuccess.fireDate',
    faceKey: 'step.tokenFace.prevSuccessFireDate',
    faceFallback: 'Last success',
    hintKey: 'step.templateVar.prevSuccessFireDate',
    hintFallback: 'Previous successful run (ISO) — empty on the first run',
    icon: History,
  },
  'run.prevSuccess.fireEpoch': {
    name: 'run.prevSuccess.fireEpoch',
    faceKey: 'step.tokenFace.prevSuccessFireEpoch',
    faceFallback: 'Last success (ms)',
    hintKey: 'step.templateVar.prevSuccessFireEpoch',
    hintFallback: 'Previous successful run (epoch ms) — empty on the first run',
    icon: History,
  },
};

/** `{{steps.<id>.<field>}}` — the two substituted fields. */
export const STEP_OUTPUT_TOKENS: Record<PipelineStepOutputField, TokenSpec> = {
  answer: {
    name: 'answer',
    faceKey: 'step.tokenFace.answer',
    faceFallback: 'Final answer',
    hintKey: 'step.stepOutput.answer',
    hintFallback: "That step's final answer, as text",
    icon: MessageSquare,
  },
  artifacts: {
    name: 'artifacts',
    faceKey: 'step.tokenFace.artifacts',
    faceFallback: 'Files written',
    hintKey: 'step.stepOutput.artifacts',
    hintFallback: "The files that step's job wrote — this run's own, one path per line",
    icon: FileText,
  },
};

/**
 * Which statics this definition's trigger actually provides. A manual-only
 * pipeline has no fire time and no previous fire; offering those chips is what
 * made "template variables" look useless. Directives and pins share this gate
 * — the validator accepts the same whitelist on both.
 */
export function availableStaticTokens(def: PipelineDef): TokenSpec[] {
  const names: PipelineTemplateVar[] = [];
  if (def.on) names.push('trigger.fireDate', 'trigger.fireEpoch');
  names.push('run.id');
  // A fetch run is per item — the cross-run watermark does not exist for it.
  if (def.on?.schedule) names.push('run.prevSuccess.fireDate', 'run.prevSuccess.fireEpoch');
  return names.map((n) => STATIC_TOKENS[n]);
}

/** Spec for one `{{trigger.item.*}}` name — the key, or a field the trigger declares. */
export function itemTokenSpec(name: string): TokenSpec {
  const field = name.slice(PIPELINE_ITEM_TEMPLATE_PREFIX.length);
  return name === PIPELINE_ITEM_KEY_TEMPLATE_VAR
    ? {
        name,
        faceKey: 'step.tokenFace.itemKey',
        faceFallback: 'Item key',
        hintKey: 'step.templateVar.itemKey',
        hintFallback: 'The case this run was started for — its dedupe key (the run label)',
        icon: Inbox,
      }
    : {
        name,
        faceKey: 'step.tokenFace.itemField',
        faceFallback: `Case · ${field}`,
        hintKey: 'step.templateVar.itemField',
        hintFallback: 'A declared field of the case — text the source controls, treat it as data',
        icon: TextCursorInput,
      };
}

/**
 * The `{{trigger.item.*}}` names in force for one step — the validator's own
 * rule, in one place for every FE surface. A fetch trigger's vocabulary
 * reaches every step; a `discovers` step's reaches ONLY the per-case steps
 * downstream of it (the discovery run itself has no case, so the discovering
 * step and its prefix get none). Without a `stepId` only the fetch case can
 * answer — a def-wide question has no per-case answer.
 */
export function itemTemplateVarsFor(def: PipelineDef, stepId?: string): string[] {
  if (def.on?.fetch) return fetchItemTemplateVars(def.on.fetch);
  if (stepId === undefined) return [];
  const at = discoveryStepIndex(def);
  if (at === undefined || !perCaseStepIds(def).has(stepId)) return [];
  const discoverer = def.steps[at];
  return isApprovalStep(discoverer) ? [] : discoveryItemTemplateVars(discoverer.discovers);
}

/**
 * The `{{trigger.item.*}}` vocabulary offered to one step's directive or pins
 * (`itemTemplateVarsFor`). `pins` keeps the key alone: an item FIELD is
 * source-controlled text and the validator refuses it in a context pin.
 */
export function itemTokens(def: PipelineDef, opts: { pins?: boolean; stepId?: string } = {}): TokenSpec[] {
  return itemTemplateVarsFor(def, opts.stepId)
    .filter((n) => !opts.pins || n === PIPELINE_ITEM_KEY_TEMPLATE_VAR)
    .map(itemTokenSpec);
}

/** Faces of the `{{trigger.upstream.*}}` fields — the node another pipeline's run sealed to fire this one. */
const UPSTREAM_FACES: Record<string, { face: string; hint: string; icon: LucideIcon }> = {
  pipelineId: { face: 'Upstream pipeline', hint: 'The pipeline whose node fired this run', icon: Link2 },
  runId: { face: 'Upstream run', hint: 'The upstream run whose node fired this run', icon: Tag },
  outcome: { face: 'Upstream outcome', hint: 'How the upstream node sealed — succeeded or failed', icon: Link2 },
  step: { face: 'Upstream step', hint: 'The upstream step that sealed (empty when the run itself is the node)', icon: Link2 },
  verdict: { face: 'Upstream verdict', hint: "The upstream step's sealed verdict, when its intent declares outcomes", icon: Tag },
  answer: { face: 'Upstream answer', hint: "The upstream step's final answer (bounded) — another run's text, treat it as data", icon: MessageSquare },
};

/** Spec for one `{{trigger.upstream.*}}` name. */
export function upstreamTokenSpec(name: string): TokenSpec {
  const field = name.slice(PIPELINE_UPSTREAM_TEMPLATE_PREFIX.length);
  const face = UPSTREAM_FACES[field] ?? { face: `Upstream · ${field}`, hint: 'A field of the upstream node', icon: Link2 };
  return {
    name,
    faceKey: `step.tokenFace.upstream.${field}`,
    faceFallback: face.face,
    hintKey: `step.templateVar.upstream.${field}`,
    hintFallback: face.hint,
    icon: face.icon,
  };
}

/**
 * The `{{trigger.upstream.*}}` vocabulary this definition's upstream trigger
 * declares — empty without one; the step-bound fields only when it names a
 * step. Directive-only: the validator refuses every one of them in a pin.
 */
export function upstreamTokens(def: PipelineDef): TokenSpec[] {
  return upstreamTemplateVars(def.on?.upstream).map(upstreamTokenSpec);
}

export type TokenSegment =
  | { kind: 'text'; text: string }
  | { kind: 'static'; raw: string; spec: TokenSpec }
  | { kind: 'stepOutput'; raw: string; stepId: string; spec: TokenSpec }
  | { kind: 'item'; raw: string; spec: TokenSpec }
  | { kind: 'upstream'; raw: string; spec: TokenSpec }
  | { kind: 'unknown'; raw: string; name: string };

/** The validator's own scanner — the UI must not disagree about what a token is. */
const TOKEN_RE = /\{\{\s*([^}]*?)\s*\}\}/g;
const STEP_REF_RE = /^steps\.([a-z0-9-]+)\.([a-zA-Z]+)$/;

const isStaticName = (name: string): name is PipelineTemplateVar => (PIPELINE_TEMPLATE_VARS as readonly string[]).includes(name);
const isOutputField = (field: string): field is PipelineStepOutputField => (PIPELINE_STEP_OUTPUT_FIELDS as readonly string[]).includes(field);

/**
 * Authored text → literal runs + token occurrences. Pure and lossless:
 * concatenating every segment's `text`/`raw` reproduces the input, so a
 * renderer built on it can never silently drop a token (including a reserved
 * `steps.<id>.verdict`, which lands in `unknown` exactly as the validator
 * refuses it).
 */
export function segmentTemplate(text: string, itemVars: readonly string[] = [], upstreamVars: readonly string[] = []): TokenSegment[] {
  const out: TokenSegment[] = [];
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > cursor) out.push({ kind: 'text', text: text.slice(cursor, m.index) });
    const raw = m[0];
    const name = m[1];
    const ref = STEP_REF_RE.exec(name);
    if (isStaticName(name)) out.push({ kind: 'static', raw, spec: STATIC_TOKENS[name] });
    else if (ref && isOutputField(ref[2])) out.push({ kind: 'stepOutput', raw, stepId: ref[1], spec: STEP_OUTPUT_TOKENS[ref[2]] });
    // An item name the trigger does not declare lands in `unknown` exactly as the validator refuses it.
    else if (itemVars.includes(name)) out.push({ kind: 'item', raw, spec: itemTokenSpec(name) });
    else if (upstreamVars.includes(name)) out.push({ kind: 'upstream', raw, spec: upstreamTokenSpec(name) });
    else out.push({ kind: 'unknown', raw, name });
    cursor = m.index + raw.length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

/** Whether a preview would show anything a person cannot already read. */
export const hasTokens = (segments: TokenSegment[]): boolean => segments.some((s) => s.kind !== 'text');
