/**
 * React-hook wrappers around the pure selectors in `ideSelectors.ts`. Kept in
 * a separate module so unit tests for the pure selectors can import them
 * without dragging in the zustand store (and transitively `window` via
 * SSEManager).
 *
 * Only the hooks actually consumed by app code are exported — the pure
 * selectors are available directly via `ideSelectors.ts` for the
 * `useStore(selectXxx)` call sites that don't need a dedicated hook.
 */

import { useStore } from '../index';
import {
  selectIdeBaseUrl,
  selectIdeWorkspacePath,
  selectIdeReloadTimestamp,
  selectIdeOverlayMode,
} from './ideSelectors';

export const useIdeBaseUrl = () => useStore(selectIdeBaseUrl);
export const useIdeWorkspacePath = () => useStore(selectIdeWorkspacePath);
export const useIdeReloadTimestamp = () => useStore(selectIdeReloadTimestamp);
export const useIdeOverlayMode = () => useStore(selectIdeOverlayMode);
