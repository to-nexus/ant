/**
 * Design-graph error classes.
 *
 * Same pattern as `periphery/adapters/figma/errors.ts` — a typed error the
 * parallel worker (`workerCheckTaskStatus`) throws and the shared
 * `TaskOrchestrator` classifies (alongside `isFigmaMCPConnectionError`,
 * `isRecursionLimitError`) to raise a resumable interruption instead of
 * completing a task as a phantom success.
 */
import type { InterruptionDetails } from '@ant/shared';

/**
 * Thrown when a design task's execute phase produced zero artifacts and left
 * its target document absent — a degenerate/drained run that must fail loud
 * (resumable) rather than complete. Carries the ready-built interruption so the
 * orchestrator's checkpoint keeps the same message/metadata as the serial path.
 */
export class DesignNoOutputError extends Error {
  readonly interruption: InterruptionDetails;
  constructor(interruption: InterruptionDetails) {
    super(interruption.message);
    this.name = 'DesignNoOutputError';
    this.interruption = interruption;
  }
}

export function isDesignNoOutputError(error: Error): boolean {
  return error instanceof DesignNoOutputError || error.name === 'DesignNoOutputError';
}
