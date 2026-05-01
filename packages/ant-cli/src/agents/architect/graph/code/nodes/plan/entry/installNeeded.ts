import type { ArchitectGraphState } from '../../../state';
import { onInstallObserved } from '../../../tasks/_shared/verify/sessionLifecycle';

/**
 * Single-source install-needed observer at plan entry. Delegates to the
 * `_shared/verify/sessionLifecycle` SSOT so `state.verification` mutation
 * stays funnelled through one writer. `installed === null` (not a JS
 * project) leaves the Session untouched.
 */
export async function recomputeInstallNeeded(
  state: ArchitectGraphState,
  opts?: { detectPmIfMissing?: boolean },
): Promise<void> {
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return;
  if (!state.verification) return;
  try {
    const { areDepsInstalled } = await import(
      '../../../../../../common/tool/handlers/invalidationScope'
    );
    const { detectPackageManager } = await import(
      '../../../../../../../core/utils/packageManager'
    );
    const installed = await areDepsInstalled(featureRoot);

    if (installed === true) onInstallObserved(state, true);
    else if (installed === false) onInstallObserved(state, false);

    console.log(`📦 [Plan] areDepsInstalled=${installed}`);

    if (opts?.detectPmIfMissing && !state._detectedPackageManager) {
      const detectedPM = await detectPackageManager(featureRoot);
      if (detectedPM) {
        state._detectedPackageManager = detectedPM;
        console.log(`📦 [Plan] Detected package manager: ${detectedPM}`);
      }
    }
  } catch (err) {
    onInstallObserved(state, false);
    console.warn(`⚠️ [Plan] Dependency observation failed, defaulting to installNeeded=true: ${err}`);
  }
}
