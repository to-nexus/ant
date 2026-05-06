/**
 * Codebase / shell guards — handler-level rejection helpers.
 *
 * Policy SSOT: see `docs/internals/15-design-job.md` "Codebase
 * mutation gate" and `docs/internals/14-code-job.md`.
 *
 * Two orthogonal gates feed this module:
 *
 *  - `allowMutateInCodebase` (path-aware) — `edit_file` /
 *    `delete_file` / `mkdir` / `create_file` reject paths under
 *    `codebase/` unless the flag is `true`. Set ONLY by the
 *    architect/code job's `execute` phase. Every other phase
 *    (architect/design plan + docGen, architect/code plan,
 *    planner/plan) leaves it falsy so mutate handlers refuse
 *    `codebase/` writes via {@link rejectCodebaseMutate}. Artifact
 *    paths (architecture/, plan/, assets/, visual/, meta/, sessions/)
 *    remain freely mutable in all phases — refactor / document-update
 *    intents need them.
 *
 *  - `allowShellExecution` (binary) — `run_command` is rejected
 *    outright unless the flag is `true`. Set by the architect/code
 *    job (every phase: plan tool-loop runs build/typecheck/test
 *    gates and dependency probes; execute applies fixes). Document-
 *    or plan-producing jobs (architect/design, planner) leave it
 *    falsy and surface {@link rejectRunCommand}. The two gates were
 *    coupled under a single flag historically; the split was made
 *    after the `agile-nodding-pouch` silent false-pass regression
 *    where the verification task could not run any gates because
 *    its plan phase shared `allowMutateInCodebase=false` with
 *    document-producing phases.
 *
 * Both helpers return a friendly soft-reject string the handler can
 * surface back to the LLM verbatim. The model uses the message to
 * recover on the next turn (write into an artifact, or describe the
 * change in the spec/plan document instead of performing it).
 */

import type { ToolExecutionContext } from '../types';
import type { ResolvedToolPath } from './pathResolver';

const CODEBASE_PREFIX = 'codebase/';

export function isCodebasePath(fsPath: string | undefined | null): boolean {
  if (!fsPath) return false;
  return fsPath === 'codebase' || fsPath.startsWith(CODEBASE_PREFIX);
}

export interface CodebaseGateRejection {
  content: string;
  error: string;
}

/**
 * Build the soft-reject payload for a `codebase/` mutate attempt in a
 * non-execute phase. Returned shape matches `ToolResult` so handlers
 * can `return rejection;` directly.
 */
export function rejectCodebaseMutate(
  toolName: string,
  resolved: ResolvedToolPath,
): CodebaseGateRejection {
  const path = resolved.displayPath;
  const msg =
    `${toolName} blocked: "${path}" is under codebase/ which is read-only in this phase. ` +
    `Code changes belong to the code job's execute phase. ` +
    `For document updates, target an artifact path (architecture/, plan/, assets/, visual/, meta/, sessions/) instead. ` +
    `For describing the intended code change, write it into the spec / plan document via <file>/<append>/<edit>.`;
  return { content: msg, error: msg };
}

/**
 * Reject `run_command` outright when the shell-execution gate is
 * closed (`ctx.allowShellExecution !== true`).
 *
 * `run_command` runs an arbitrary shell line whose effective targets
 * cannot be inferred from `args`, so a path-level check is impossible
 * and the gate is binary. Document- or plan-producing jobs (design,
 * planner) leave the flag falsy and the design/planner tool registries
 * also omit `RUN_COMMAND` so the LLM normally never sees the tool —
 * this rejection is the defence-in-depth handler-side enforcement for
 * the same policy. The architect/code job leaves the flag `true` for
 * every phase: plan tool-loop runs verification / test-runner install
 * / error diagnostic / dep-discovery commands, and execute applies
 * source mutations.
 */
export function rejectRunCommand(): CodebaseGateRejection {
  const msg =
    `run_command is not available in this job. Shell execution is reserved for jobs whose normal ` +
    `workflow runs build / test / install commands (architect/code). ` +
    `For document- or plan-producing jobs gather information via read_file / list_files / search_code, ` +
    `or describe the change in the spec / plan document instead of running it.`;
  return { content: msg, error: msg };
}

/**
 * Returns true when the gate forbids this mutate attempt and the
 * caller should short-circuit with `rejectCodebaseMutate`.
 */
export function shouldRejectCodebaseMutate(
  ctx: ToolExecutionContext,
  resolved: ResolvedToolPath,
): boolean {
  if (ctx.allowMutateInCodebase === true) return false;
  return isCodebasePath(resolved.fsPath);
}
