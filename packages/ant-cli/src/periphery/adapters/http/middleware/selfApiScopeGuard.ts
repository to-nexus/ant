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
 * it may call; what it MAY call is decided here. That is also why the pin is
 * NOT scoped per definition: any user can save a definition declaring any
 * `allow`, so a per-definition scope would grant exactly what this file
 * already decides — one claim, one rule set.
 *
 * ONE surface — `/definitions`, the scoped-template family (a definition is a
 * user|org|builtin template resolved closest-wins, never an account-owned
 * record) — with TWO resources under it whose polarity is DELIBERATELY
 * OPPOSITE:
 *
 *  - `/definitions/agents` — allow-except. The whole resource is authoring, so
 *    the default is admit, minus:
 *      · `promote` / `editors` — publishing a definition to the organization,
 *        or handing out edit rights, is a person's decision made in the UI,
 *        never a side effect of a job turn;
 *      · `import` / `files/upload` — the two write routes that skip
 *        `gateDefinitionSave` and land raw bytes. A job authors through the
 *        validated funnel, so that a definition it wrote is one the loader
 *        accepts. Prose asking it nicely is not the same as refusing the route.
 *
 *  - `/definitions/pipelines` — deny-except. Most of THAT resource is
 *    operational, not authoring (activate, run-now, approvals, runs), so an
 *    allow-except list would silently admit every route added later — the
 *    failure mode this guard exists to prevent. Only the definition-authoring
 *    shapes below are admitted; everything else, present or future, is refused
 *    by default.
 *    A pipeline a job writes lands DISABLED (the create route forces it) and
 *    stays immutable once enabled, so "the job drafts, a person publishes and
 *    activates" is a property of the routes — this pin is what keeps the job
 *    from stepping over it.
 *
 * Anything outside the surface is refused: the job authors definitions, it does
 * not drive projects, credentials, billing, or auth (a self-api token therefore
 * also cannot mint another token: the auth routes sit outside the pin).
 *
 * Absence of the claim is an ordinary session and passes through untouched.
 * Mounts AFTER authentication (M-010: an unauthenticated request must not
 * reach a body parser) and before the account router.
 *
 * Mounted on every server that authenticates a bearer, not just the one that
 * owns the surface. The realtime server has none of it, so this same guard
 * refuses the claim there wholesale — otherwise a job-minted token would reach
 * its owner's SSE stream and `/bridge/*`, well outside the bound declared
 * above.
 */

import { Request, Response, NextFunction } from 'express';

/** Agent-definition mount, as seen after `app.use('/api', …)` strips its prefix. */
export const SELF_API_SURFACE_PREFIX = '/definitions/agents';

/** Pipeline-definition mount, same prefix-stripped view. */
export const SELF_API_PIPELINES_PREFIX = '/definitions/pipelines';

/** Sub-paths the pin refuses inside the account-agents surface. */
const AGENTS_FORBIDDEN_SUFFIXES = ['/promote', '/editors', '/import', '/files/upload'];

/** Both resources live here; nothing else does. */
const SELF_API_FAMILY_PREFIX = '/definitions';

/**
 * Literal first segments under the pipelines resource that are ROUTES, not
 * pipeline ids.
 * A `:id` rule must never swallow one: `GET /pipelines/approvals` is an
 * operational read, and an id-shaped match would admit it. Express resolves
 * this by registration order; this guard matches independently, so the
 * exclusion has to be explicit.
 */
const PIPELINE_RESERVED_SEGMENTS = new Set(['preview-fires', 'activatable-projects', 'approvals', 'runs']);

/**
 * The pipeline routes a definition-authoring job may reach, as METHOD + the
 * segment shape following the prefix. `:id` matches exactly one segment that
 * is not a reserved literal.
 *
 * Refused by omission, each for a stated reason:
 *   enable / disable            publish state — the `promote` axis
 *   activate / deactivate       binds a project and locks out its interactive jobs
 *   run-now                     fires unattended work and spends credits
 *   promote / editors           organization publish + edit rights
 *   approvals/**                a job must not resolve its own HITL gate
 *   runs/**                     operational history; a job's own run log is
 *                               already grafted read-only into its plane
 *   download                    bulk export; `GET /pipelines/:id` carries the def
 */
const PIPELINE_ALLOWED_ROUTES: ReadonlyArray<{ method: string; tail: readonly string[] }> = [
  { method: 'GET', tail: [] },
  { method: 'POST', tail: [] },
  { method: 'POST', tail: ['preview-fires'] },
  { method: 'GET', tail: ['activatable-projects'] },
  { method: 'GET', tail: [':id'] },
  { method: 'PUT', tail: [':id'] },
  { method: 'DELETE', tail: [':id'] },
  { method: 'GET', tail: [':id', 'permissions'] },
];

function isWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isAllowedPipelineRoute(method: string, tail: string[]): boolean {
  return PIPELINE_ALLOWED_ROUTES.some(
    (rule) =>
      rule.method === method &&
      rule.tail.length === tail.length &&
      rule.tail.every((seg, i) => (seg === ':id' ? !PIPELINE_RESERVED_SEGMENTS.has(tail[i]) : seg === tail[i])),
  );
}

function refuse(res: Response, message: string): void {
  res.status(403).json({ error: 'Out of scope', code: 'self-api-scope', message });
}

export function createSelfApiScopeGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.scope !== 'self-api') {
      return next();
    }

    const path = req.path.replace(/\/+$/, '') || '/';
    // HEAD routes as GET everywhere in Express; `api__ant__get` issues both.
    const method = req.method.toUpperCase() === 'HEAD' ? 'GET' : req.method.toUpperCase();

    if (isWithin(path, SELF_API_SURFACE_PREFIX)) {
      const forbidden = AGENTS_FORBIDDEN_SUFFIXES.find((suffix) => path.endsWith(suffix));
      if (!forbidden) {
        return next();
      }
      return refuse(
        res,
        forbidden === '/promote' || forbidden === '/editors'
          ? 'Promoting an agent to the organization and granting edit access are done by a person in agent settings, not by a job.'
          : `This route writes definition files without validating them. Author through PUT ${SELF_API_SURFACE_PREFIX}/:agentId/file instead.`,
      );
    }

    if (isWithin(path, SELF_API_PIPELINES_PREFIX)) {
      const tail = path.slice(SELF_API_PIPELINES_PREFIX.length).split('/').filter(Boolean);
      if (isAllowedPipelineRoute(method, tail)) {
        return next();
      }
      return refuse(
        res,
        "This job's token authors pipeline definitions. Enabling, activating, running, sharing and approving a pipeline are decided by a person in the Pipelines tab.",
      );
    }

    return refuse(res, `This job's token may only reach ${SELF_API_FAMILY_PREFIX}.`);
  };
}
