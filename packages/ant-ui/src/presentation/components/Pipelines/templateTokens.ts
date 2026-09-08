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

import { Clock, FileText, Hash, History, MessageSquare, Tag, type LucideIcon } from 'lucide-react';
import {
  PIPELINE_STEP_OUTPUT_FIELDS,
  PIPELINE_TEMPLATE_VARS,
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
  if (def.on?.schedule) names.push('run.prevSuccess.fireDate', 'run.prevSuccess.fireEpoch');
  return names.map((n) => STATIC_TOKENS[n]);
}

export type TokenSegment =
  | { kind: 'text'; text: string }
  | { kind: 'static'; raw: string; spec: TokenSpec }
  | { kind: 'stepOutput'; raw: string; stepId: string; spec: TokenSpec }
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
export function segmentTemplate(text: string): TokenSegment[] {
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
    else out.push({ kind: 'unknown', raw, name });
    cursor = m.index + raw.length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

/** Whether a preview would show anything a person cannot already read. */
export const hasTokens = (segments: TokenSegment[]): boolean => segments.some((s) => s.kind !== 'text');
