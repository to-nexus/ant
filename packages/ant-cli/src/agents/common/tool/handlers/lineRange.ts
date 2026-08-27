/**
 * Line-range argument coercion — single owner for the read tools
 * (read_file / read_reference_file / read_ant_source).
 *
 * Schemas declare startLine/endLine as `number`, but some providers emit
 * numeric strings ("650") regardless of the declared type; a `typeof`
 * check then silently degrades a range read into a full read
 * (narrow-ending-flour). Coerce server-side instead of loosening schemas.
 */

export function coerceLineArg(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return undefined;
}

export function coerceLineRange(args: Record<string, unknown>): {
  startLine?: number;
  endLine?: number;
} {
  return {
    startLine: coerceLineArg(args?.startLine),
    endLine: coerceLineArg(args?.endLine),
  };
}
