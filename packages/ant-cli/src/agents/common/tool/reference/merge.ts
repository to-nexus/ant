/**
 * Merge reference-registration deltas into the running `referenceRequests`
 * channel. Dedup key = `project::branch` so distinct branches of one project
 * coexist while an exact re-register is a no-op. This is the single writer's
 * merge rule (tool node), shared by the code and design graphs.
 */

export interface ReferenceRequestEntry {
  project: string;
  branch?: string;
  reason?: string;
}

export function mergeReferenceRequests(
  existing: ReferenceRequestEntry[] | undefined,
  deltas: Array<{ project: string; branch?: string; reason?: string }>,
): ReferenceRequestEntry[] {
  const out: ReferenceRequestEntry[] = [...(existing || [])];
  const seen = new Set(out.map((e) => `${e.project}::${e.branch || ''}`));
  for (const d of deltas) {
    if (!d?.project) continue;
    const key = `${d.project}::${d.branch || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ project: d.project, branch: d.branch, reason: d.reason });
  }
  return out;
}
