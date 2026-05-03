import { isBinaryImageFilePath } from '@/infrastructure/http/api';

export type ViewMode = 'raw' | 'preview';

export const DEFAULT_VIEW_MODE: ViewMode = 'preview';
export const VIEW_MODE_PREFERENCE: readonly ViewMode[] = ['preview', 'raw'];

export function supportedViewModes(path: string | null | undefined): ReadonlySet<ViewMode> {
  if (!path) {
    return new Set<ViewMode>(['preview']);
  }
  if (isBinaryImageFilePath(path)) {
    return new Set<ViewMode>(['preview']);
  }
  // Default policy: every non-image file supports both raw and preview.
  return new Set<ViewMode>(['raw', 'preview']);
}

export function canToggleViewMode(path: string | null | undefined): boolean {
  if (!path) return false;
  return supportedViewModes(path).size > 1;
}

export function resolveViewMode(
  path: string | null | undefined,
  byPath: Readonly<Record<string, ViewMode>>,
): ViewMode {
  const supported = supportedViewModes(path);
  const candidate = (path ? byPath[path] : undefined) ?? DEFAULT_VIEW_MODE;
  if (supported.has(candidate)) {
    return candidate;
  }
  return VIEW_MODE_PREFERENCE.find((mode) => supported.has(mode)) ?? DEFAULT_VIEW_MODE;
}
