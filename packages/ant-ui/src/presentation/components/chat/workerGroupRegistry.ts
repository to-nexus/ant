/**
 * Worker-group element registry (pinRegistry pattern).
 *
 * The dock's jump-to-group needs each group container's live element for the
 * fine-scroll after Virtuoso lands on the turn row. Groups register
 * explicitly through context instead of DOM queries — see pinRegistry.ts for
 * why an empty `querySelectorAll` result is a silent failure mode.
 */

import { createContext, useCallback, useContext } from 'react';

export type RegisterGroup = (key: string, element: HTMLElement | null) => void;

const noop: RegisterGroup = () => {};

export const WorkerGroupRegistryContext = createContext<RegisterGroup>(noop);

export function workerGroupElementKey(turnId: string, workerScope: string): string {
  return `${turnId}:${workerScope}`;
}

/** Stable ref callback for a group container root. */
export function useRegisterGroup(turnId: string, workerScope: string) {
  const register = useContext(WorkerGroupRegistryContext);
  return useCallback(
    (element: HTMLElement | null) => {
      register(workerGroupElementKey(turnId, workerScope), element);
    },
    [register, turnId, workerScope],
  );
}
