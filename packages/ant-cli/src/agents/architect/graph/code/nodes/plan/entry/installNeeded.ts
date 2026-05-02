import type { ArchitectGraphState } from '../../../state';
import { probeInstallStatus } from '../../../tasks/_shared/verify/env';

/**
 * Per-entry install-status probe. The probe logic (`areDepsInstalled` +
 * optional `detectPackageManager`) lives in
 * `tasks/_shared/verify/env.ts::probeInstallStatus`. This wrapper:
 *
 *   - delegates to `probeInstallStatus(featureRoot, opts)`;
 *   - writes the observation to `state._installNeededTransient` (read by
 *     `buildPlanPrompt`); a one-shot signal — there is no Session cache;
 *   - caches `state._detectedPackageManager` when detection was requested
 *     and the lockfile walk yielded a hit;
 *   - on probe failure, defaults to `installed: false` so the plan prompt
 *     sees "install needed" (safer than silently assuming "current").
 */
export async function recomputeInstallNeeded(
  state: ArchitectGraphState,
  opts?: { detectPmIfMissing?: boolean },
): Promise<void> {
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return;
  try {
    const { installed, packageManager } = await probeInstallStatus(featureRoot, {
      detectPackageManager: !!opts?.detectPmIfMissing && !state._detectedPackageManager,
    });

    if (installed === true) state._installNeededTransient = false;
    else if (installed === false) state._installNeededTransient = true;
    else state._installNeededTransient = undefined;

    console.log(`📦 [Plan] areDepsInstalled=${installed}`);

    if (packageManager && !state._detectedPackageManager) {
      state._detectedPackageManager = packageManager;
      console.log(`📦 [Plan] Detected package manager: ${packageManager}`);
    }
  } catch (err) {
    state._installNeededTransient = true;
    console.warn(`⚠️ [Plan] Dependency observation failed, defaulting to installNeeded=true: ${err}`);
  }
}
