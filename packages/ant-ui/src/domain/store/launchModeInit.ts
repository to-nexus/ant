/// <reference types="vite/client" />

/**
 * SSOT helper for resolving the initial `launchMode` ('local' | 'cloud').
 *
 * Resolution order (first non-empty wins):
 *   1. localStorage migration — copy legacy `'ant-ui:backend-mode'` into
 *      `'ant-ui:launch-mode'` when the new key is absent. Legacy key removed.
 *   2. localStorage `'ant-ui:launch-mode'` — explicit user choice persists.
 *   3. Origin detection — `VITE_CLOUD_BACKEND_BASE` same-origin as the page
 *      means this is a managed / cloud-self-host build → 'cloud'.
 *   4. Default → 'local'.
 *
 * Both `configSlice.ts` (zustand init) and `client.ts` (network base URL)
 * call into this so they never disagree on which mode the app booted in.
 */
export const LAUNCH_MODE_STORAGE_KEY = 'ant-ui:launch-mode';
const LEGACY_BACKEND_MODE_STORAGE_KEY = 'ant-ui:backend-mode';

function readStoredLaunchMode(): 'local' | 'cloud' | null {
  try {
    const legacy = localStorage.getItem(LEGACY_BACKEND_MODE_STORAGE_KEY);
    const current = localStorage.getItem(LAUNCH_MODE_STORAGE_KEY);
    if (legacy && !current) {
      localStorage.setItem(LAUNCH_MODE_STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_BACKEND_MODE_STORAGE_KEY);
    } else if (legacy && current) {
      localStorage.removeItem(LEGACY_BACKEND_MODE_STORAGE_KEY);
    }
    const stored = localStorage.getItem(LAUNCH_MODE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = stored.startsWith('"') ? JSON.parse(stored) : stored;
    return parsed === 'local' || parsed === 'cloud' ? parsed : null;
  } catch {
    return null;
  }
}

function isManagedOrigin(): boolean {
  const cloudBase = import.meta.env.VITE_CLOUD_BACKEND_BASE as string | undefined;
  if (!cloudBase) return false;
  try {
    return new URL(cloudBase).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function determineInitialLaunchMode(): 'local' | 'cloud' {
  const stored = readStoredLaunchMode();
  if (stored) return stored;
  if (isManagedOrigin()) return 'cloud';
  return 'local';
}

/**
 * True when the current build's `VITE_CLOUD_BACKEND_BASE` resolves to the
 * page's own origin. Used by the GNB selector to decide whether to expose
 * the Local toggle (hidden on managed / cloud-self-host builds) and by
 * docs/test scaffolding to mirror the runtime check.
 */
export function isManagedBuild(): boolean {
  return isManagedOrigin();
}
