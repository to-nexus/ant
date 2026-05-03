/**
 * Codebase Mutation Gate — handler-level path guard.
 *
 * Policy SSOT: see `docs/architecture/15-design-job.md` "Codebase
 * mutation gate" and `docs/architecture/14-code-job.md`.
 *
 * Mutate (`edit_file` / `delete_file` / `mkdir` / `create_file` /
 * `run_command`) under `codebase/` is permitted ONLY when the active
 * tool execution context sets `allowMutateInCodebase === true`. That
 * flag is set ONLY by the architect/code job's `execute` phase; every
 * other phase (architect/design plan + docGen, architect/code plan,
 * planner/plan) leaves the flag falsy so mutate handlers refuse
 * `codebase/` writes here. Artifact paths (architecture/, plan/,
 * assets/, visual/, meta/, sessions/) remain freely mutable in all
 * phases — refactor / document-update intents need them.
 *
 * This module returns a friendly soft-reject string the handler can
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
 * Reject `run_command` outright when the gate is closed.
 *
 * `run_command` runs an arbitrary shell line whose effective targets
 * cannot be inferred from `args`, so we cannot do a path check.
 * Document/plan-producing phases never have a legitimate need for
 * arbitrary shell commands, so closing the gate disables the tool
 * entirely in those phases.
 */
export function rejectRunCommand(): CodebaseGateRejection {
  const msg =
    `run_command is unavailable in this phase. Arbitrary shell execution is reserved for the ` +
    `code job's execute phase, where mutating source code is the artifact. ` +
    `For information gathering use read_file / list_files / search_code.`;
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
