/**
 * Cloud plugin loader — the SINGLE site that names '@ant/cloud'.
 *
 * `loadCloudModule()` attempts an indirected dynamic import of the optional
 * `@ant/cloud` overlay package, gated on `isBillingEnabled()`. The specifier is
 * held in a `const` so esbuild/Rollup cannot statically resolve it, and the
 * package is an optionalDependency — so the OSS build (where `@ant/cloud` is
 * absent) compiles and boots with the Noop adapters.
 *
 * Cloud mode (`ANT_SERVER_MODE=cloud`) expects the package to be present; a
 * load failure there is fatal-by-policy and surfaced to the caller (the factory
 * throws at boot rather than silently degrading to Noop).
 */

import { isBillingEnabled } from '../config/billingCapability';
import { logger } from '../../utils/logger';
import type { CloudModule } from './cloudModule';

let cached: CloudModule | null | undefined; // undefined = not yet probed

export async function loadCloudModule(): Promise<CloudModule | null> {
  if (cached !== undefined) return cached;
  if (!isBillingEnabled()) {
    cached = null; // OSS / local: never probe
    return null;
  }
  try {
    const spec = '@ant/cloud'; // indirected so bundlers leave it as a runtime import
    const mod = (await import(/* @vite-ignore */ spec)) as { default?: CloudModule } & CloudModule;
    cached = (mod.default ?? mod) as CloudModule;
    return cached;
  } catch (err) {
    logger.error(
      '[cloudPlugin] @ant/cloud requested (cloud mode) but not loadable',
      { component: 'cloudPlugin' },
      err,
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
