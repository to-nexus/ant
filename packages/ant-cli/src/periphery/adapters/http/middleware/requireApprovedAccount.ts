/**
 * Account-approval surface guard.
 *
 * Approval (`UserRecord.approvalStatus`) is an IDENTITY-axis verdict: it answers
 * "may this person use the product at all", not "may this person afford this
 * call". So it belongs on the whole authenticated surface, mounted once after
 * verification — the same shape as `selfApiScopeGuard`.
 *
 * It used to be six hand-placed pre-flight calls at compute-start handlers (job
 * start/learn/resume/continue, chat, team create). That blocked starting agent
 * work and nothing else: a `pending` account could still create and delete
 * projects, upload files, boot preview/deploy child processes, attach a GitHub
 * PAT, write agent definitions, drive a live IDE pod, open every SSE stream, and
 * mint a 90-day desktop token. A guard that enumerates the routes someone
 * remembered is not a boundary; this one enumerates the SET.
 *
 * Two passes through:
 *  - no `req.user` — the request took the JWT gate's public-path branch
 *    (`/api/auth/me`, `/api/auth/signout`, `/api/system/config`, `/api/health`,
 *    the OAuth endpoints). There is no identity to judge, and those are exactly
 *    what the pending screen and sign-out need, so the exemption is DERIVED from
 *    `PUBLIC_PATHS` rather than re-listed here — a second copy would drift;
 *  - a surface the CALLER declares exempt because it carries a strictly stronger
 *    gate of its own. Today that is ant-api's `/admin`, guarded by the
 *    env-authoritative `isSuperAdminEmail`: `setUserApproval` can stamp a super
 *    admin `denied` while `syncSuperAdmins` only re-approves at boot, so gating
 *    it would brick the operator out of the screen that undoes the mistake.
 *    The exemption is per-MOUNT, never global — ant-preview also serves an
 *    `/admin/instances`, and that one has no super-admin gate, so exempting it
 *    would hand an unapproved account a surface nothing else bounds.
 *
 * The verdict itself is read through `checkApproval`, which stays the single
 * owner of "consult the organization-repository port, fail open on infra error".
 * Fail-open is deliberate here: Redis is the whole system's dependency, so a blip
 * that flipped this closed would convert an outage into a total lockout of every
 * approved user, reported under a misleading pending code.
 *
 * Local mode never mounts this (every mount site sits inside a cloud-only
 * branch), and `NoopOrganizationRepository` answers `'approved'` anyway, so the
 * local/cloud fork does not widen.
 */

import { Request, Response, NextFunction } from 'express';
import { checkApproval, approvalErrorCode, approvalHttpStatus } from '../routes/helpers/approvalGate';

/** ant-api's super-admin surface, as seen after `app.use('/api', …)` strips its prefix. */
export const ADMIN_SURFACE_PREFIX = '/admin';

export interface RequireApprovedAccountOptions {
  /** Sub-surfaces of THIS mount that carry a stronger gate of their own. */
  exemptPrefixes?: string[];
}

export function createRequireApprovedAccount(options: RequireApprovedAccountOptions = {}) {
  const exemptPrefixes = options.exemptPrefixes ?? [];
  const isExempt = (path: string) =>
    exemptPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) return next();

      const path = req.path.replace(/\/+$/, '') || '/';
      if (isExempt(path)) return next();

      const notApproved = await checkApproval({
        userId,
        organizationId: req.organization?.id ?? req.user?.organizationId ?? '',
      });
      if (!notApproved) return next();

      // `unknown` is a stale session, not a judgement: the JWT is valid but no
      // record backs it. 401 so the client re-authenticates — that recreates a
      // legitimate user's record and lets a deleted account sign up afresh.
      res.status(approvalHttpStatus(notApproved.status)).json({
        error: notApproved.status === 'unknown' ? 'Session identity no longer exists.' : 'Account is not approved.',
        code: approvalErrorCode(notApproved.status),
        message:
          notApproved.status === 'unknown'
            ? 'This session is no longer valid. Please sign in again.'
            : notApproved.status === 'denied'
              ? 'This account has been deactivated. Please contact the operator.'
              : 'This account is waiting for operator approval.',
      });
    } catch {
      // `checkApproval` already fails open on a repository error; this catches
      // anything above it so the guard can never 500 a request it cannot judge.
      next();
    }
  };
}
