/**
 * Cloud plugin loader — the SINGLE site that names '@ant/cloud'.
 *
 * `loadCloudModule()` attempts an indirected dynamic import of the optional
 * `@ant/cloud` overlay package. The gate is the SERVER MODE (never probed in
 * local — local is free by decision), NOT `isBillingEnabled()`:
 * `isBillingEnabled()` is defined as "overlay loaded", so gating the loader
 * on it would be circular. The specifier is held in a `const` so
 * esbuild/Rollup cannot statically resolve it, and the package is an
 * optionalDependency — so the OSS build (where `@ant/cloud` is absent)
 * compiles and boots with the Noop adapters.
 *
 * Cloud mode WITHOUT the package is a legitimate profile (self-hosted cloud:
 * identity/org from OSS core, billing off). Managed deployments that must
 * fail loud instead set `ANT_REQUIRE_BILLING=1` — enforced by
 * `InfrastructureFactory.initCloud()`, not here.
 */

import { isLocalServerMode } from '../config/serverMode';
import { logger } from '../../utils/logger';
import type { CloudModule } from './cloudModule';

let cached: CloudModule | null | undefined; // undefined = not yet probed

export async function loadCloudModule(): Promise<CloudModule | null> {
  if (cached !== undefined) return cached;
  if (isLocalServerMode()) {
    cached = null; // local: never probe — free by decision
    return null;
  }
  try {
    const spec = '@ant/cloud'; // indirected so bundlers leave it as a runtime import
    const mod = (await import(/* @vite-ignore */ spec)) as { default?: CloudModule } & CloudModule;
    cached = (mod.default ?? mod) as CloudModule;
    return cached;
  } catch {
    logger.info(
      '[cloudPlugin] @ant/cloud not present — running without billing (self-hosted cloud profile)',
      { component: 'cloudPlugin' },
    );
    cached = null;
    return null;
  }
}

/** Synchronous read of the already-resolved module (null until/unless loaded). */
export function peekCloudModule(): CloudModule | null {
  return cached ?? null;
}

/** Test-only reset of the load cache. */
export function __resetCloudModuleCache(): void {
  cached = undefined;
}
