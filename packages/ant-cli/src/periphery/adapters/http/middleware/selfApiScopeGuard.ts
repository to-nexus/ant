/**
 * `self-api` capability pin.
 *
 * A universal job whose definition declares an `apis` self entry receives a
 * bearer minted for its owner. That token rides in the job-runner child's env,
 * and the calls it authorizes are composed by an LLM — so it must not carry
 * the owner's whole session. This guard is the server-side bound.
 *
 * It is the ONLY bound. The definition's `allow` list is authored by the user
 * and one save away from `* *`, so it constrains only what the model is told
 * it may call; what it MAY call is decided here.
 *
 * Two refusals:
 *  - anything outside the account-agents surface — the job writes definitions,
 *    it does not drive projects, billing, or auth (a self-api token therefore
 *    also cannot mint another token: the auth routes sit outside the pin);
 *  - `promote` / `editors` inside that surface — publishing a definition to the
 *    organization, or handing out edit rights, is a person's decision made in
 *    the UI, never a side effect of a job turn;
 *  - `import` / `files/upload` — the two write routes that skip
 *    `gateDefinitionSave` and land raw bytes. A job authors through the
 *    validated funnel, so that a definition it wrote is one the loader
 *    accepts. Prose asking it nicely is not the same as refusing the route.
 *
 * Absence of the claim is an ordinary session and passes through untouched.
 * Mounts AFTER authentication (M-010: an unauthenticated request must not
 * reach a body parser) and before the account router.
 *
 * Mounted on every server that authenticates a bearer, not just the one that
 * owns the surface. The realtime server has no account-agents routes, so this
 * same guard refuses the claim there wholesale — otherwise a job-minted token
 * would reach its owner's SSE stream and `/bridge/*`, well outside the bound
 * declared above.
 */

import { Request, Response, NextFunction } from 'express';

/** Account-agents mount, as seen after `app.use('/api', …)` strips its prefix. */
export const SELF_API_SURFACE_PREFIX = '/account/agents';

/** Sub-paths the pin refuses even inside the surface. */
const FORBIDDEN_SUFFIXES = ['/promote', '/editors', '/import', '/files/upload'];

function isWithinSurface(path: string): boolean {
  return path === SELF_API_SURFACE_PREFIX || path.startsWith(`${SELF_API_SURFACE_PREFIX}/`);
}

export function createSelfApiScopeGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.scope !== 'self-api') {
      return next();
    }

    const path = req.path.replace(/\/+$/, '') || '/';
    if (!isWithinSurface(path)) {
      res.status(403).json({
        error: 'Out of scope',
        code: 'self-api-scope',
        message: `This job's token may only reach ${SELF_API_SURFACE_PREFIX}.`,
      });
      return;
    }
    const forbidden = FORBIDDEN_SUFFIXES.find((suffix) => path.endsWith(suffix));
    if (forbidden) {
      res.status(403).json({
        error: 'Out of scope',
        code: 'self-api-scope',
        message:
          forbidden === '/promote' || forbidden === '/editors'
            ? 'Promoting an agent to the organization and granting edit access are done by a person in agent settings, not by a job.'
            : 'This route writes definition files without validating them. Author through PUT /account/agents/:agentId/file instead.',
      });
      return;
    }

    next();
  };
}
