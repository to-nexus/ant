import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';

/**
 * Anti-clobber merge for connection re-detection.
 *
 * Re-detection (`ConnectionDetector.detect`) derives `category` / `resolution`
 * from the `.env.example` `@connection` annotations only. A user can edit those
 * in the Preview Config panel (saved to Redis as `userModified: true`) without
 * yet persisting them back to `.env.example` (that requires the Fix → code-job
 * path). A naive full-overwrite save after a post-job refresh would silently
 * discard those edits.
 *
 * This overlays the user's saved intent on top of the fresh detection:
 *   - detected connection with a `userModified` saved twin whose intent the
 *     source has NOT yet caught up to → take the SAVED connection (the user's
 *     choice), but adopt the fresh runtime `status` from detection;
 *   - detected connection whose `.env.example` now MATCHES the user's saved
 *     edit (the code job landed it) → take detection and drop `userModified`,
 *     so the "변경됨" badge clears once the source agrees;
 *   - detected connection with no (or untouched) saved twin → use detection;
 *   - `userModified` saved connections the detector can't see (user-added, or
 *     pending source removal) → preserved additively, so they aren't lost.
 *
 * The mock toggle (`virtualization.active`) is intentionally NOT special-cased:
 * it lives in `.env`, which the detector re-reads, so it is already fresh on the
 * detected side and survives for untouched connections.
 *
 * Pure — no I/O. Keyed by connection `id`.
 */
export function mergeDetectedWithSaved(
  detected: ServiceConnection[],
  saved: ServiceConnection[],
): ServiceConnection[] {
  const savedById = new Map(saved.map(s => [s.id, s]));

  // The source has caught up to the user's edit when the detected
  // (annotation-derived) user-editable fields equal the saved ones.
  const sourceCaughtUp = (d: ServiceConnection, s: ServiceConnection): boolean =>
    d.category === s.category &&
    d.envVar === s.envVar &&
    d.name === s.name &&
    JSON.stringify(d.resolution) === JSON.stringify(s.resolution);

  const merged = detected.map(d => {
    const s = savedById.get(d.id);
    if (s?.userModified && !sourceCaughtUp(d, s)) {
      return { ...s, status: d.status };
    }
    // Untouched, or the source now matches the edit → take fresh detection
    // (which carries no `userModified`, so the dirty badge clears).
    return d;
  });

  const detectedIds = new Set(detected.map(d => d.id));
  const orphanUserEdits = saved.filter(s => s.userModified && !detectedIds.has(s.id));

  return [...merged, ...orphanUserEdits];
}
