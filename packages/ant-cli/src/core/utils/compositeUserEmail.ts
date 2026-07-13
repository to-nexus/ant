/**
 * Composite user-email codec — `${userId}@${organizationId}`.
 *
 * Cloud userIds are full lowercased emails (org model SSOT), so the composite
 * contains MULTIPLE '@' characters (`probe@to.nexus@individual`). A naive
 * `split('@')` shears the userId apart ({probe, to.nexus}) and silently
 * misroutes every workspace-path lookup downstream — the prime-nesting-grate
 * RCA: the cancelled/resume card was dropped on "no turn anchor" because all
 * disk anchor sources read a nonexistent feature path.
 *
 * Prefer passing the structured `userContext` object end-to-end; parse the
 * composite string only as a legacy-payload fallback, and always at the LAST
 * '@' boundary (organizationIds never contain '@').
 */
export function parseCompositeUserEmail(
  email: string,
): { userId: string; organizationId: string } | undefined {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return undefined;
  return { userId: email.slice(0, at), organizationId: email.slice(at + 1) };
}
