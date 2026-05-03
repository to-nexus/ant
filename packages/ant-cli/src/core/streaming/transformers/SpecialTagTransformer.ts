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
import { allTags } from '../OutputTagRegistry';
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
}
