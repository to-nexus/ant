import type { ArchitectGraphState } from '../../../state';
import { onInstallObserved } from '../../../tasks/_shared/verify/sessionLifecycle';
import { probeInstallStatus } from '../../../tasks/_shared/verify/env';

/**
 * Single-source install-needed observer at plan entry.
 *
 * The probe logic itself (`areDepsInstalled` + optional
 * `detectPackageManager` dynamic imports, lockfile walk) lives in the
 * verify SSOT module `tasks/_shared/verify/env.ts::probeInstallStatus`.
 * This wrapper owns only the state lifecycle around that probe:
 *
 *   - guard: skip when no verify Session is active (`installed === null`
 *     also short-circuits there);
 *   - delegate to `probeInstallStatus(featureRoot, opts)`;
 *   - funnel the observation through the Session lifecycle (`onInstallObserved`);
 *   - cache `state._detectedPackageManager` when detection was requested
 *     and the lockfile walk yielded a hit;
 *   - on probe failure, default to `installed: false` (plan prompt sees
 *     "install needed" — safer than silently assuming "current").
 */
export async function recomputeInstallNeeded(
  state: ArchitectGraphState,
  opts?: { detectPmIfMissing?: boolean },
): Promise<void> {
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return;
  if (!state.verification) return;
  try {
    const { installed, packageManager } = await probeInstallStatus(featureRoot, {
      detectPackageManager: !!opts?.detectPmIfMissing && !state._detectedPackageManager,
    });

    if (installed === true) onInstallObserved(state, true);
    else if (installed === false) onInstallObserved(state, false);

    console.log(`📦 [Plan] areDepsInstalled=${installed}`);

    if (packageManager && !state._detectedPackageManager) {
      state._detectedPackageManager = packageManager;
      console.log(`📦 [Plan] Detected package manager: ${packageManager}`);
    }
  } catch (err) {
    onInstallObserved(state, false);
    console.warn(`⚠️ [Plan] Dependency observation failed, defaulting to installNeeded=true: ${err}`);
  }
}
