import type { AuroraSelectOption } from '../../ConfigEditor/aurora';

/**
 * A native select renders an unmatched value as BLANK and the first
 * interaction overwrites it — an authored `verdict:a|b` or an intent whose
 * catalog failed to parse would vanish silently. Surface the value instead.
 */
export function withCurrentValue(
  options: AuroraSelectOption[],
  value: string | undefined,
  unknownLabel: (v: string) => string,
): { options: AuroraSelectOption[]; hasError: boolean } {
  if (!value || options.some((o) => o.value === value)) return { options, hasError: false };
  return { options: [{ value, label: unknownLabel(value) }, ...options], hasError: true };
}
