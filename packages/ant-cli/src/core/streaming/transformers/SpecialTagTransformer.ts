/**
 * SpecialTagTransformer — chat-render walker over OutputTagRegistry.
 *
 * Phase 4 of the Output Tag Matrix migration: this class is the
 * downstream consumer of the registry's `transform` hooks. It owns
 * exactly two responsibilities:
 *
 *   1. Walk the registry on each `transform(content)` call and return
 *      the first matching entry's transform result.
 *   2. Track the post-walk side effect of `<done>true</done>` so
 *      callers can read `_explicitDone` after streaming completes.
 *
 * It does NOT own the tag inventory, the rendering rules, or the
 * suppress / format policy — those live in
 * `core/streaming/OutputTagRegistry.ts` (data) and
 * `core/streaming/outputTagTransforms.ts` (functions). Adding a new
 * canonical tag does NOT touch this file; it only requires a registry
 * entry. The matrix lint test (`tests/core/output-tag-registry.test.ts`)
 * fails the build if a new tag is missing wiring.
 *
 * Suppressed entries (no `transform` hook) consume silently — equivalent
 * to the old `() => ({ consumed: true })` self-registrations. The same
 * guarantee is enforced by `validateEntryShape` in the registry: a
 * `consumed-suppressed` entry has no `transform`, and the walker treats
 * "no hook" as "consume without text".
 */

import type { TransformResult } from '../OutputTagRegistry';
import { allTags, findTag } from '../OutputTagRegistry';
import { type UserLanguage } from '../../utils/languageDetector';

export type { TransformResult };

export class SpecialTagTransformer {
  private language: UserLanguage;
  private _explicitDone: boolean = false;

  constructor(language: UserLanguage = 'en') {
    this.language = language;
  }

  /** True once the walker has observed `<done>true</done>`. */
  get explicitDone(): boolean {
    return this._explicitDone;
  }

  /**
   * Walk the registry; return the first matching entry's transform
   * result. Entries declared `consumed-suppressed` (no `transform` hook)
   * consume silently. Unmatched content falls through with
   * `{ text: content, consumed: false }`.
   */
  transform(content: string): TransformResult {
    for (const entry of allTags()) {
      const match = content.match(entry.pattern);
      if (!match) continue;

      // Post-walk side effect: explicit-done flag. Tracked here (not
      // inside the transform body) so the registry hook stays a pure
      // function. The `<done>true</done>` rendering itself is owned by
      // `outputTagTransforms.transformDone`.
      if (entry.name === 'done' && match[1]?.toLowerCase() === 'true') {
        this._explicitDone = true;
      }

      return entry.transform
        ? entry.transform(match, { language: this.language })
        : { consumed: true };
    }

    return { text: content, consumed: false };
  }

  /**
   * Full-buffer scan for `<done>true</done>` — side-effect only. Used by
   * surfaces that buffer the stream without running per-chunk `transform`
   * (e.g. parallel task_response card in `CommonRenderStrategy`). The
   * per-chunk `transform()` path is first-match-only by design; on a
   * buffer where `<done>` is NOT the first registered tag to match, it
   * would miss the side effect. This method walks every match globally so
   * `_explicitDone` reflects the buffer's terminal intent.
   *
   * Rendering / suppression policy for `<done>` is NOT touched here — it
   * still lives in the registry entry's `transform` hook. This method
   * only promotes the side-effect flag that downstream code
   * (`docGenRouter` / execute routers) reads to decide task termination.
   */
  scanExplicitDone(buffer: string): void {
    if (!buffer || this._explicitDone) return;
    const entry = findTag('done');
    if (!entry) return;
    const flags = entry.pattern.flags.includes('g')
      ? entry.pattern.flags
      : entry.pattern.flags + 'g';
    const re = new RegExp(entry.pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(buffer)) !== null) {
      if (m[1]?.toLowerCase() === 'true') {
        this._explicitDone = true;
        return;
      }
    }
  }
}
