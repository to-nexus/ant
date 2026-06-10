/**
 * Organization Name Slugifier
 *
 * Normalizes user-supplied organization names into stable lowercase ids.
 * Rules:
 *   - lowercase
 *   - non-[a-z0-9] runs collapsed into a single dash
 *   - leading/trailing dashes stripped
 *   - length clamped to [1, 64] (throws when empty or too short)
 *   - reserved words rejected (system-owned tenant ids)
 *
 * SSOT for organization id derivation. `_pending` is the pre-onboarding
 * JWT sentinel and MUST be reserved — anything else would let a user
 * impersonate the pre-onboarding state.
 */

/**
 * Organization names that the system reserves for itself.
 *
 * - `local` — fixed tenant for `ANT_SERVER_MODE=local` (no remote auth).
 * - `system` / `admin` / `ant` / `public` — operator / brand / shared
 *   semantics that future codepaths may grant special handling.
 * - `_pending` — pre-onboarding JWT sentinel. Cannot appear as a
 *   slugify output (the leading `_` is stripped during normalization),
 *   but listed so any future codepath that compares raw input against
 *   this set ALSO blocks it.
 * - `pending` — the post-slugify form of `_pending`. Reserving it here
 *   means a user typing "pending" into the onboarding screen will see
 *   a validation error rather than collide with the sentinel after
 *   normalization. The trade-off is intentional: "pending" is a
 *   reasonable English word but a poor organization name, and
 *   preventing the slug from matching `_pending` short-circuits an
 *   entire class of bugs in routes that compare `payload.org ===
 *   '_pending'`.
 */
export const RESERVED_ORG_NAMES: ReadonlySet<string> = new Set([
  'local',
  'individual', // shared individual-kind org id — system-owned, not a team name
  'system',
  'admin',
  'ant',
  'public',
  '_pending',
  'pending',
]);

const MAX_SLUG_LENGTH = 64;

export class InvalidOrganizationNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrganizationNameError';
  }
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  if (!slug) {
    throw new InvalidOrganizationNameError(
      'Organization name must contain at least one alphanumeric character',
    );
  }

  if (RESERVED_ORG_NAMES.has(slug)) {
    throw new InvalidOrganizationNameError(
      `"${slug}" is a reserved organization name and cannot be used`,
    );
  }

  return slug;
}

/** Non-throwing variant — returns null when input is invalid or reserved. */
export function trySlugify(input: string): string | null {
  try {
    return slugify(input);
  } catch {
    return null;
  }
}
