/**
 * Auth/session-lifecycle completeness gate.
 *
 * Deliberately NOT under `serviceVirtualization/` and carries NO
 * `hasBusinessConnection` precondition: persisting + rehydrating an
 * authenticated session across a process / page restart is true PRODUCTION
 * behavior — identical in the mock and production adapters — not a
 * service-virtualization concern. It fires for the auth/session boundary
 * OWNER whether or not a business connection exists (a frontend-only app with
 * its own auth still needs the round-trip), so it must stay independent of
 * every SV gate (which all require `hasBusinessConnection`).
 *
 * Owner shape mirrors the SV world-seed owner — the platform-band shared
 * service that builds the session boundary, or the setup task that scaffolds
 * it — so the directive reaches the one task that authors the session
 * bootstrap, not every read-surface consumer that merely reads identity.
 */
export interface AuthSessionLifecycleGateInput {
  /** Task type at the call site (`currentTask.type` for execute, plan-side
   *  task type for plan). */
  taskType?: string | undefined;
  /** Scheduling band of the current task (read-only). Routes the directive to
   *  the platform-band session-boundary owner; never written. */
  band?: string | undefined;
}

/**
 * True for the task that owns the auth/session boundary — the platform-band
 * shared-service feature, or setup that scaffolds it. No `hasBusinessConnection`
 * precondition by design (see module header).
 */
export function isAuthSessionLifecycleActive(
  input: AuthSessionLifecycleGateInput,
): boolean {
  return (
    (input.taskType === 'feature' && input.band === 'platform') ||
    input.taskType === 'setup'
  );
}
