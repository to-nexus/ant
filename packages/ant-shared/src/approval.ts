/**
 * Account approval + admin-dashboard contract (BE ↔ FE / admin app).
 *
 * Cloud-only feature. OSS/local treats every account as `approved` (the Noop
 * adapters return `'approved'` / `auto-approve`), so nothing here gates a local
 * tenant. Approval is a per-user "verification" value today; the future org
 * system will let org-admins verify their own members (that seam reads the same
 * field through the repository port).
 */

import type { SubscriptionTier, BalanceSnapshot, CreditTransaction } from './billing';
import type { OrganizationKind } from './org';

/** Per-user verification state. `undefined` in storage ⇒ treated as `approved`. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

/** Global policy applied to accounts created AFTER the toggle is set. */
export type DefaultApprovalMode = 'auto-approve' | 'require-approval';

/** Admin-settable global config (Redis `ant:admin:config`). */
export interface AdminConfig {
  defaultApprovalMode: DefaultApprovalMode;
  /** ISO-8601 of last change. */
  updatedAt: string;
  /** Admin email that last changed it. */
  updatedBy: string;
}

/** One membership row in the admin detail view (kept primitive — no core import). */
export interface AdminMembershipInfo {
  organizationId: string;
  role: string;
}

/**
 * Identity-axis fields — one value per user, repeated across that user's rows.
 */
export interface AdminUserIdentity {
  userId: string;
  email: string;
  name?: string;
  picture?: string;
  approvalStatus: ApprovalStatus;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  isSuperAdmin: boolean;
  /** 0 = normal; ≥1 = test-payment enabled (2/3 reserved for future capabilities). */
  testAccountLevel: number;
}

/**
 * Scope-axis fields — one value per (user × org) billing account. Credits and
 * tier are keyed by the pair, so a user in personal + two teams has three.
 */
export interface AdminScopeInfo {
  organizationId: string;
  organizationName?: string;
  organizationKind: OrganizationKind;
  /** Absent ⇒ the ledger account outlived its membership. */
  role?: string;
  orphaned: boolean;
  /** This scope is the user's currently-active one. */
  active: boolean;
  /** null ⇒ the ledger holds no account for this scope. */
  tier: SubscriptionTier | null;
  credits: number | null;
  /** Monthly grant is past due, so the shown balance predates it. */
  grantOverdue: boolean;
  /**
   * The account predates the current billing schema; it exists but its stored
   * balance is pre-reseed, so `tier`/`credits` are withheld rather than wrong.
   */
  stale: boolean;
}

/** One row of the admin account list: a (user × scope) billing account. */
export interface AdminAccountRow extends AdminUserIdentity, AdminScopeInfo {}

export interface AdminAccountListResponse {
  rows: AdminAccountRow[];
  defaultApprovalMode: DefaultApprovalMode;
}

/** Per-scope billing detail for one user. */
export interface AdminScopeDetail extends AdminScopeInfo {
  balance: BalanceSnapshot | null;
  transactions: CreditTransaction[];
}

/** Full admin detail for one user — identity + every scope it holds. */
export interface AdminUserDetail extends AdminUserIdentity {
  memberships: AdminMembershipInfo[];
  scopes: AdminScopeDetail[];
}

/** Body of `POST /admin/users/:id/approval`. */
export interface SetApprovalRequest {
  status: ApprovalStatus;
}

/** Body of `POST /admin/users/:id/test-level`. */
export interface SetTestLevelRequest {
  testAccountLevel: number;
}

/** Body of `PUT /admin/config`. */
export interface SetDefaultPolicyRequest {
  defaultApprovalMode: DefaultApprovalMode;
}

/** Body of `POST /admin/users/:id/refund`. Ledger-only adjustment (no PG). */
export interface RefundRequest {
  /** Target scope. Required — the wrong guess credits the wrong wallet. */
  organizationId: string;
  credits: number;
  reason?: string;
  idempotencyKey: string;
}

/** Query options for `listUsers` — identity-axis only (the repo knows no scopes). */
export interface AdminUserListQuery {
  limit?: number;
  cursor?: string;
  status?: ApprovalStatus;
}

/** Query for `GET /admin/users`; `organizationId` filters the assembled rows. */
export interface AdminAccountListQuery extends AdminUserListQuery {
  organizationId?: string;
}

// ── Stable error codes (surfaced to clients as `{ code }`) ─────────────────
export const ACCOUNT_PENDING_APPROVAL = 'ACCOUNT_PENDING_APPROVAL';
export const ACCOUNT_DENIED = 'ACCOUNT_DENIED';
export const ADMIN_REQUIRED = 'ADMIN_REQUIRED';
export const TEST_PAYMENT_NOT_ALLOWED = 'TEST_PAYMENT_NOT_ALLOWED';
export const REFUND_SCOPE_REQUIRED = 'REFUND_SCOPE_REQUIRED';
