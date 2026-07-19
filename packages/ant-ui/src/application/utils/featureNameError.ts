import { validateFeatureName } from '@ant/shared';

/**
 * Map a feature-name validation violation to an i18n key under
 * `explorer:feature.nameError.*`. Returns null when the name is valid.
 * Branch name == feature name, so names must satisfy git branch rules
 * (shared validator `validateFeatureName`).
 */
export function featureNameErrorKey(name: string): string | null {
  const check = validateFeatureName(name);
  return check.ok ? null : `feature.nameError.${check.violation}`;
}
