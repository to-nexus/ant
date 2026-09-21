/**
 * Session-seal readers — the clarify / tool-approval park markers and the
 * completed step's output + verdict capture. All best-effort: a failed read
 * is an absent record, never a step failure.
 */

import {
  isApprovalStep,
  parseCustomJobRef,
  PIPELINE_STEP_OUTPUT_MAX_CHARS,
  type PipelineRunItem,
  type StepOutputRecord,
} from '@ant/shared';
import { filterCaseFields } from '../../../core/pipelines/cases';
import type { PipelineOwner } from '../../../core/ports/scheduler';
import { getUniversalSessionFilePath, readSessionTextBounded } from '../../../core/utils/sessionPaths';
import { selectSealedConversation } from '../../../core/customAgents/universalConversation';
import {
  resolveUniversalExecuteContext,
  expandArtifactGlobsBounded,
} from '../../../core/scheduling/UniversalDispatchGate';
import { stepAnswerFromText, stepArtifactsFromSeal } from '../../../core/pipelines/stepOutput';
import { getRun } from './runStore';
import type { PipelineCoordinatorDeps } from './types';

export async function detectClarifySeal(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  runId: string,
  stepId: string,
  jobId: string,
): Promise<{ question: string; toolUseId?: string } | null> {
  try {
    const run = await getRun(deps, runId);
    const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
    if (!run || !stepDef || isApprovalStep(stepDef)) return null;
    const ref = parseCustomJobRef(stepDef.customJobRef);
    if (!ref) return null;
    const containerPath = deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);
    // Run-scoped file: every step of THIS run seals here, no other run does.
    const sessionPath = getUniversalSessionFilePath(containerPath, ref, runId);
    // Bound the read on its own descriptor (M-NEW-029): the scheduler hot path
    // must not sync-read and JSON-parse an unbounded session. Oversize throws
    // and is swallowed by the catch below (treated as "no clarify seal").
    const raw = readSessionTextBounded(sessionPath);
    if (raw === null) return null;
    const session = JSON.parse(raw);
    const state = session?.state ?? session;
    if (state?.awaitingClarify !== true || state?.jobId !== jobId) return null;
    return {
      question: typeof state.clarifyQuestion === 'string' ? state.clarifyQuestion : '',
      ...(typeof state.clarifyToolUseId === 'string' && { toolUseId: state.clarifyToolUseId }),
    };
  } catch {
    return null;
  }
}

/** Same read channel as the clarify seal — the tool-approval pause markers. */
export async function detectApprovalSeal(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  runId: string,
  stepId: string,
  jobId: string,
): Promise<{ toolName: string; argsSummary: string; toolUseId?: string } | null> {
  try {
    const run = await getRun(deps, runId);
    const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
    if (!run || !stepDef || isApprovalStep(stepDef)) return null;
    const ref = parseCustomJobRef(stepDef.customJobRef);
    if (!ref) return null;
    const containerPath = deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);
    const raw = readSessionTextBounded(getUniversalSessionFilePath(containerPath, ref, runId));
    if (raw === null) return null;
    const session = JSON.parse(raw);
    const state = session?.state ?? session;
    if (state?.awaitingApproval !== true || state?.jobId !== jobId) return null;
    if (typeof state.approvalTool !== 'string' || state.approvalTool.length === 0) return null;
    return {
      toolName: state.approvalTool,
      argsSummary: typeof state.approvalArgsSummary === 'string' ? state.approvalArgsSummary : '',
      ...(typeof state.approvalToolUseId === 'string' && { toolUseId: state.approvalToolUseId }),
    };
  } catch {
    return null;
  }
}

/**
 * Capture a completed step's output and verdict.
 * - `output` — the `{{steps.*}}` substitution source and the run history's
 *   business-readable summary: `.answer` = the final assistant text of the
 *   seal's `session:main` (jobId-guarded, same read channel as the clarify
 *   detection); `.artifacts` = files matching the pinned intent's
 *   `hooks.stop` globs at completion. Best-effort — failure is an absent
 *   record, never a step failure.
 * - `verdict` — the sealed decision, VALIDATED against the pinned intent's
 *   declared outcomes with the step's `onMissingVerdict` fallback applied.
 *   `missingVerdict` = the intent declares outcomes but no valid verdict
 *   resolved — the caller fails the step (retryable: a re-run can decide).
 * - `cases` — a `discovers` step's sealed `<cases>`, filtered to the declared
 *   field vocabulary. Same contract shape as the verdict: `missingCases` =
 *   the step fans out but the run sealed no list (and `onMissing` is not
 *   `complete`); `casesError` = a tag whose body was not a list. Both fail
 *   the step (retryable). Only a DISCOVERY run captures cases — a case run's
 *   fan-out step arrived sealed and never dispatches.
 */
export async function captureStepOutput(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  runId: string,
  stepId: string,
  jobId: string,
): Promise<{
  output?: StepOutputRecord;
  verdict?: string;
  missingVerdict?: boolean;
  assignee?: string;
  cases?: PipelineRunItem[];
  missingCases?: boolean;
  casesError?: string;
}> {
  const run = await getRun(deps, runId).catch(() => null);
  const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
  if (!run || !stepDef || isApprovalStep(stepDef)) return {};
  const ref = parseCustomJobRef(stepDef.customJobRef);
  if (!ref) return {};
  const containerPath = deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);

  let answer: string | undefined;
  let answerTruncated = false;
  let sealVerdict: string | undefined;
  // Sealed reviewer nomination (raw; the gate validates it against candidates).
  let sealAssignee: string | undefined;
  // Sealed fan-out cases (raw; filtered to the step's declared fields below).
  let sealCases: PipelineRunItem[] | undefined;
  let sealCasesError: string | undefined;
  // The seal's own write evidence — set only when the seal is this job's.
  let sealedArtifacts: string[] | undefined;
  try {
    const raw = readSessionTextBounded(getUniversalSessionFilePath(containerPath, ref, runId));
    if (raw !== null) {
      const session = JSON.parse(raw);
      const state = session?.state ?? session;
      // The seal must belong to THIS step's job — the run file is shared by
      // every step of the same run.
      if (state?.jobId === jobId) {
        if (typeof state.verdict === 'string') sealVerdict = state.verdict;
        if (typeof state.assignee === 'string' && state.assignee.length > 0) sealAssignee = state.assignee;
        if (Array.isArray(state.cases)) sealCases = state.cases as PipelineRunItem[];
        if (typeof state.casesError === 'string' && state.casesError.length > 0) sealCasesError = state.casesError;
        const main = selectSealedConversation<any>(state);
        if (Array.isArray(main)) {
          for (let i = main.length - 1; i >= 0; i -= 1) {
            const msg = main[i];
            if (msg?.role !== 'assistant') continue;
            const text =
              typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('')
                  : '';
            const prose = stepAnswerFromText(text);
            if (prose.length > 0) {
              answer = prose;
              break;
            }
          }
        }
        sealedArtifacts = stepArtifactsFromSeal(state);
        if (answer && answer.length > PIPELINE_STEP_OUTPUT_MAX_CHARS) {
          answer = answer.slice(0, PIPELINE_STEP_OUTPUT_MAX_CHARS);
          answerTruncated = true;
        }
      }
    }
  } catch {
    /* best-effort seal read */
  }

  // `{{steps.<id>.artifacts}}` = the files THIS job wrote (seal evidence). The
  // whole-tree glob expansion is only the fallback for a seal without it — on
  // a domain-keyed glob it would list every case's file, not the run's own.
  let artifacts: string[] | undefined = sealedArtifacts;
  let declaredOutcomes: string[] = [];
  if (stepDef.intent) {
    try {
      const resolved = await resolveUniversalExecuteContext(deps.workspaceResolver, owner, run.projectId, stepDef.customJobRef);
      if (resolved.ok) {
        declaredOutcomes = resolved.intentOutcomes[stepDef.intent] ?? [];
        if (!artifacts) {
          const globs = resolved.intentStopGlobs[stepDef.intent] ?? [];
          const expanded = await expandArtifactGlobsBounded(containerPath, globs);
          if (expanded.length > 0) artifacts = expanded;
        }
      }
    } catch {
      /* best-effort */
    }
  }

  const output =
    !answer && !artifacts
      ? undefined
      : {
          ...(answer && { answer }),
          ...(answerTruncated && { answerTruncated: true }),
          ...(artifacts && { artifacts }),
          capturedAt: new Date().toISOString(),
        };

  // Fan-out contract — only on a discovery run's discovers step.
  const discoveryCapture =
    stepDef.discovers && run.firedBy !== 'discovery'
      ? sealCasesError
        ? { casesError: sealCasesError }
        : sealCases
          ? { cases: filterCaseFields(sealCases, stepDef.discovers) }
          : stepDef.discovers.onMissing === 'complete'
            ? { cases: [] as PipelineRunItem[] }
            : { missingCases: true }
      : {};
  const base = { ...(output && { output }), ...(sealAssignee && { assignee: sealAssignee }), ...discoveryCapture };
  // Verdict contract — only when the pinned intent declares a vocabulary.
  if (declaredOutcomes.length === 0) return base;
  let verdict = sealVerdict && declaredOutcomes.includes(sealVerdict) ? sealVerdict : undefined;
  if (!verdict) {
    const fallback = stepDef.onMissingVerdict;
    if (fallback && fallback !== 'fail' && declaredOutcomes.includes(fallback)) verdict = fallback;
  }
  return { ...base, ...(verdict ? { verdict } : { missingVerdict: true }) };
}
