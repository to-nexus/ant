/**
 * Gate assignee — candidate / assignee split (doc 46 §5a-ii).
 *
 * `candidates` = who MAY decide a gate: the activator ∪ the activation's
 * roster for that gate (permission, human-set, unchanged by anything here).
 * `assignees` = who this RUN's gate is routed to: a hint that narrows the
 * request notice and sorts the inbox, never the resolve authority. Sources,
 * highest first: a candidate's reassign (PUT) > the sealed `<assignee>` of the
 * first direct upstream step that nominated one > none (every candidate).
 * A nomination naming a non-candidate is DROPPED (audited), never widened
 * into authority.
 */

import type { PipelineActivation, PipelineDef, RunRecord } from '@ant/shared';
import { effectiveNeeds } from './ChainExecutor';

/** Member ids are lowercase (emails in cloud); the tag body is normalized the same way. */
export const ASSIGNEE_MAX_CHARS = 254;

const ASSIGNEE_TAG = /<assignee>\s*([^<\s]{1,254})\s*<\/assignee>/gi;

/** The LAST `<assignee>` of a reply, lowercased — absent when none or over-long. */
export function parseAssigneeNomination(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const matches = [...text.matchAll(ASSIGNEE_TAG)];
  if (matches.length === 0) return undefined;
  const raw = matches[matches.length - 1][1].trim().toLowerCase();
  return raw.length > 0 && raw.length <= ASSIGNEE_MAX_CHARS ? raw : undefined;
}

/** Activator first, then the gate's roster — deduped, the inbox select's order. */
export function gateCandidates(
  ownerUserId: string,
  activation: Pick<PipelineActivation, 'approvers'> | null | undefined,
  stepId: string,
): string[] {
  return [...new Set([ownerUserId, ...(activation?.approvers?.[stepId] ?? [])])];
}

/**
 * The nomination a gate reads: the first DIRECT `needs` step (definition
 * order) whose record sealed an `assignee`. Transitive upstream is not
 * consulted — the nominating step is the one the gate directly follows.
 */
export function nominatedAssigneeFor(def: PipelineDef, run: Pick<RunRecord, 'steps'>, gateStepId: string): string | undefined {
  const index = def.steps.findIndex((s) => s.id === gateStepId);
  if (index < 0) return undefined;
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  for (const dep of effectiveNeeds(def, index)) {
    const nominated = byId.get(dep)?.assignee;
    if (nominated) return nominated;
  }
  return undefined;
}

export interface ResolvedAssignees {
  /** ⊆ candidates; absent = everyone. */
  assignees?: string[];
  /** A nomination that named no candidate — dropped, surfaced on the `awaiting_human` line. */
  unresolved?: string;
}

/** Keep a nomination only when it names a candidate. */
export function resolveGateAssignees(nominated: string | undefined, candidates: readonly string[]): ResolvedAssignees {
  if (!nominated) return {};
  return candidates.includes(nominated) ? { assignees: [nominated] } : { unresolved: nominated };
}

/**
 * Audience narrowing: the activator always, plus the assignees that are still
 * candidates (a roster edit can drop one). No surviving assignee = the whole
 * roster, so a stale hint never silences a gate.
 */
export function narrowAudience(
  ownerUserId: string,
  roster: readonly string[],
  assignees: readonly string[] | undefined,
): string[] {
  const candidates = new Set([ownerUserId, ...roster]);
  const live = (assignees ?? []).filter((a) => candidates.has(a));
  if (live.length === 0) return [...candidates];
  return [...new Set([ownerUserId, ...live])];
}
