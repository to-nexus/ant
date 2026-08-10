/**
 * Server-mode SSOT.
 *
 * `ANT_SERVER_MODE` selects where the infrastructure runs, NOT which code path
 * executes — the data plane is identical in both (see AGENTS.md "Unified
 * Distributed System Principle"). It is legal to branch on it only for the two
 * narrow fork points the principle allows: auth tenant resolution, and
 * trust decisions that only exist because more than one tenant shares the
 * deployment (e.g. refusing a user-supplied absolute codebase path in cloud).
 *
 * This module is the single reader of the variable outside startup wiring;
 * `periphery/.../helpers/userContext.ts` re-exports it so route code keeps its
 * existing import site.
 */

/** True when this process serves a single, locally-trusted tenant. */
export function isLocalServerMode(): boolean {
  return (process.env.ANT_SERVER_MODE || 'local') !== 'cloud';
}
