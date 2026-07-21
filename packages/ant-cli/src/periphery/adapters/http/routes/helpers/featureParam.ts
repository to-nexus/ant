import type { Router } from 'express';
import { featureSlugToName } from '@ant/shared';

/**
 * Feature names may contain `/` (git-style branches). On the wire they travel
 * as a `/`-free slug (see `@ant/shared` `featureNameToSlug`); this registers
 * the inverse decode for every feature route param, so handlers and services
 * downstream operate on the canonical raw name in one place per router.
 *
 * Registering a param name that a given router never uses is harmless — the
 * callback simply never fires.
 */
export function registerFeatureParamDecoders(router: Router): void {
  const paramNames = ['feature', 'featureId', 'featureName'] as const;
  for (const name of paramNames) {
    router.param(name, (req, _res, next, value) => {
      if (typeof value === 'string') req.params[name] = featureSlugToName(value);
      next();
    });
  }
}

/** Decode a `?feature=` / `?featureName=` query slug to the raw name. */
export function decodeFeatureQuery<T extends string | undefined>(value: T): T {
  return (typeof value === 'string' ? featureSlugToName(value) : value) as T;
}

/**
 * Decode a `/`-free feature slug captured by a REGEX route (positional param)
 * back to the raw name. `router.param` fires only for NAMED params, never for
 * regex capture groups, so regex handlers must call this explicitly.
 */
export function decodeFeatureSegment(value: string): string {
  return featureSlugToName(value);
}
