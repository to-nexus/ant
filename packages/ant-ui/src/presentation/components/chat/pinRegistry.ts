/**
 * Bubble registry for the chat pin.
 *
 * `ChatHistory` needs the live element of each user bubble to decide which
 * prompt has scrolled off. It registers them explicitly instead of querying
 * the DOM: a `querySelectorAll` on the virtuoso scroller silently returns
 * nothing when any assumption about the render tree is off, and an empty
 * result is indistinguishable from "no prompt is off-screen" — which is how
 * the pin ended up tracking mount state instead of geometry.
 */

import { createContext, useCallback, useContext } from 'react';

export type RegisterBubble = (turnId: string, element: HTMLElement | null) => void;

const noop: RegisterBubble = () => {};

export const PinRegistryContext = createContext<RegisterBubble>(noop);

/**
 * Ref callback for a user bubble. Stable per `turnId` — an unstable ref
 * callback makes React re-run it (old with null, new with the element) on
 * every render, churning the registry for no reason.
 */
export function useRegisterBubble(turnId: string) {
  const register = useContext(PinRegistryContext);
  return useCallback(
    (element: HTMLElement | null) => {
      register(turnId, element);
    },
    [register, turnId],
  );
}
