/**
 * Super-admin identity — env allowlist is the AUTHORITATIVE source for admin
 * gating. `ANT_SUPER_ADMIN_EMAILS` is a comma-separated list of emails. This is
 * a distinct concept from the future per-organization admin role: the super
 * admin is the platform operator.
 *
 * The DB `UserRecord.isSuperAdmin` flag is a PROJECTION of this list (synced on
 * login + a boot reconcile). Gating (`requireAdmin`) reads this helper, not the
 * DB flag, so a stale projection can never grant or revoke access.
 */

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** Emails configured as super-admins (lowercased). */
export function parseSuperAdminEmails(): string[] {
  return parseList(process.env.ANT_SUPER_ADMIN_EMAILS);
}

/** True when `email` is in the env super-admin allowlist. */
export function isSuperAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return parseSuperAdminEmails().includes(email.toLowerCase());
}
