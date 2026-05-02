/**
 * BC emission gate for the `learn` node.
 *
 * Decides whether the outer learn node should call `executionTier.breadcrumb`
 * for the current turn, and produces the SSOT diagnostic line the operator
 * sees in the console when a BC is unexpectedly absent.
 *
 * Pure / no I/O so it is unit-testable without standing up the full learn
 * node (which pulls in git, fileSystem, sessions, kanban, …).
 *
 * Policy:
 *   - `isLastTask`           — BC is a turn-boundary artefact; only the
 *                               final task in the queue emits one.
 *   - `turnTouchedAny`       — there must be at least one `file_*` event
 *                               recorded for this turnId in chat.jsonl
 *                               (SSOT: `collectTouchedFilesFromChatLog` in
 *                               `core/context/breadcrumb.ts`).
 *
 * The earlier policy combined `isLastTask && !taskFailed`. That conflated
 * `interruption` marking (verification-tail violations) with BC emission
 * and silently dropped BCs whenever the tail task was verification/error,
 * even when other tasks in the same turn had successfully written code.
 * `taskFailed` is still surfaced in the diagnostic line because operators
 * regularly need to disambiguate "why didn't a BC appear?" — but it does
 * NOT block emission.
 *
 * `silentSkipDiagnostics.test.ts` covers the four inner skip sites of
 * `writeBreadcrumb`. This helper covers the OUTER gate that decides
 * whether `writeBreadcrumb` is called at all.
 */

export interface BcGateInputs {
  isLastTask: boolean;
  taskFailed: boolean;
  isWorkerContext: boolean;
  hasOrchestratorFailure: boolean;
  touchedSize: number;
  mode: string | undefined;
  currentTaskType: string | undefined;
  violationsLen: number;
}

export interface BcGateDecision {
  bcShouldEmit: boolean;
  turnTouchedAny: boolean;
  diagnosticLine: string;
}

export function evaluateBcGate(inputs: BcGateInputs): BcGateDecision {
  const turnTouchedAny = inputs.touchedSize > 0;
  const bcShouldEmit = inputs.isLastTask && turnTouchedAny;
  const diagnosticLine =
    `📝 [Learn] BC eval — isLastTask=${inputs.isLastTask}, ` +
    `bcShouldEmit=${bcShouldEmit}, taskFailed=${inputs.taskFailed}, ` +
    `isWorkerContext=${inputs.isWorkerContext}, ` +
    `hasOrchestratorFailure=${inputs.hasOrchestratorFailure}, ` +
    `touched=${inputs.touchedSize}, mode=${inputs.mode}, ` +
    `currentTaskType=${inputs.currentTaskType}, ` +
    `violationsLen=${inputs.violationsLen}`;
  return { bcShouldEmit, turnTouchedAny, diagnosticLine };
}
