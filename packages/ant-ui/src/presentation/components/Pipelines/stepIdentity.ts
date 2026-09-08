/**
 * How a pipeline step names itself — ONE resolver for the canvas card, the
 * inspector's step-output chip groups and the directive preview.
 *
 * A pipeline is usually several INTENTS of the same agent × job, so the intent
 * is the discriminator and takes the primary line; `agent · job` recedes to a
 * caption. A step that pins no intent (the job self-selects at runtime) has no
 * discriminator to show, so the job name is promoted rather than leaving the
 * primary line blank.
 */

import { GENERAL_INTENT, isApprovalStep, parseCustomJobRef, type PipelineStepDef } from '@ant/shared';

/** Agent catalog rows identity resolves against (structural subset of `CustomAgentSummary`). */
export interface IdentityAgentSummary {
  id: string;
  name: string;
  jobs: Array<{ id: string; name: string }>;
}

type TFn = (key: string, fallback: string) => string;

export interface StepIdentity {
  /** The big line: pinned intent id → job display name → placeholder. */
  primary: string;
  /** `agent · job`, or `agent · <intent auto>` when no intent is pinned. */
  caption?: string;
  /** Full caption plus the raw `{agentId}/{jobId}` — the caption's title attribute. */
  captionTitle?: string;
  /** False when `primary` fell back to the job name (or a placeholder). */
  primaryIsIntent: boolean;
}

const SEP = ' · ';

export function resolveStepIdentity(step: PipelineStepDef, agents: IdentityAgentSummary[] | undefined, t: TFn): StepIdentity {
  if (isApprovalStep(step)) {
    return {
      primary: t('canvas.approval', 'Approval'),
      caption: step.timeout ? `${step.timeout.after} → ${step.timeout.onTimeout}` : t('canvas.noTimeout', 'no timeout'),
      primaryIsIntent: false,
    };
  }

  const ref = parseCustomJobRef(step.customJobRef);
  if (!ref) return { primary: t('canvas.unconfigured', 'Choose a job…'), primaryIsIntent: false };

  const agent = agents?.find((a) => a.id === ref.agentId);
  const agentName = agent?.name ?? ref.agentId;
  const jobName = agent?.jobs.find((j) => j.id === ref.jobId)?.name ?? ref.jobId;
  // `general` is the reserved catch-all, not a business discriminator — a step
  // pinned to it reads like an unpinned one.
  const intent = step.intent && step.intent !== GENERAL_INTENT ? step.intent : undefined;

  const primary = intent ?? jobName;
  const caption = intent ? `${agentName}${SEP}${jobName}` : `${agentName}${SEP}${t('canvas.intentAuto', 'intent chosen at run time')}`;
  return {
    primary,
    caption,
    captionTitle: `${caption}\n${step.customJobRef}`,
    primaryIsIntent: intent !== undefined,
  };
}
