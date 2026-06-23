/**
 * UI slot registry — the FE half of the OSS / cloud seam (component side).
 *
 * Cloud-only surfaces (the navbar credit menu, billing panels, the recharge
 * CTA, the create-team modal, the onboarding screen) are rendered through
 * `<Slot name="..." />` instead of a static import. The cloud bundle registers
 * a component for each slot name at boot (via the conditionally-imported
 * `@ant/cloud/ui` module, gated on `VITE_INCLUDE_CLOUD` in `main.tsx`). An OSS
 * build never registers anything, so every `<Slot/>` renders `null` and the
 * cloud components are dead-code-eliminated.
 *
 * Registered components are typically `React.lazy(...)`, so `<Slot/>` wraps
 * them in `<Suspense>`. Props passed to `<Slot/>` (other than `name` /
 * `fallback`) are forwarded to the registered component.
 */

import { Suspense, type ComponentType, type ReactNode } from 'react';

const registry = new Map<string, ComponentType<any>>();

export function registerSlot(name: string, component: ComponentType<any>): void {
  registry.set(name, component);
}

type SlotProps = { name: string; fallback?: ReactNode } & Record<string, unknown>;

export function Slot({ name, fallback = null, ...props }: SlotProps) {
  const Component = registry.get(name);
  if (!Component) return null;
  return (
    <Suspense fallback={fallback}>
      <Component {...props} />
    </Suspense>
  );
}
