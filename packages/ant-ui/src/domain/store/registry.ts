/**
 * Optional-slice registry — the FE half of the OSS / cloud seam.
 *
 * The core store ([index.ts]) composes a fixed set of neutral slices, then
 * folds in any slice creators registered here. Cloud-only slices (billing
 * today) register themselves at boot via the conditionally-imported
 * `@ant/cloud/ui` module (gated on `VITE_INCLUDE_CLOUD` in `main.tsx`). An OSS
 * build never imports that module, so the array stays empty and the slices are
 * dead-code-eliminated.
 *
 * Invariant: this module MUST NOT import the store (`./index`) or anything
 * that does, otherwise importing a registrar would create the store before
 * registration runs. Registration always happens before store creation —
 * see `main.tsx`'s bootstrap ordering.
 */

import type { StateCreator } from 'zustand';

type OptionalSliceCreator = StateCreator<any, [], [], any>;

const optionalSliceCreators: OptionalSliceCreator[] = [];

export function registerOptionalSlice(creator: OptionalSliceCreator): void {
  optionalSliceCreators.push(creator);
}

export function getOptionalSlices(): readonly OptionalSliceCreator[] {
  return optionalSliceCreators;
}
