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

/** Row in the admin user list — auth identity + billing summary. */
export interface AdminUserSummary {
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
  /** Billing summary derived from BalanceSnapshot. */
  tier: SubscriptionTier;
  credits: number;
}

/** Full admin detail for one user — summary + memberships + billing detail. */
export interface AdminUserDetail extends AdminUserSummary {
  memberships: AdminMembershipInfo[];
  balance: BalanceSnapshot;
  transactions: CreditTransaction[];
}

export interface AdminUserListResponse {
  users: AdminUserSummary[];
  defaultApprovalMode: DefaultApprovalMode;
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
  credits: number;
  reason?: string;
  idempotencyKey: string;
}

/** Query options for `listUsers`. */
export interface AdminUserListQuery {
  limit?: number;
  cursor?: string;
  status?: ApprovalStatus;
}

// ── Stable error codes (surfaced to clients as `{ code }`) ─────────────────
export const ACCOUNT_PENDING_APPROVAL = 'ACCOUNT_PENDING_APPROVAL';
export const ACCOUNT_DENIED = 'ACCOUNT_DENIED';
export const ADMIN_REQUIRED = 'ADMIN_REQUIRED';
export const TEST_PAYMENT_NOT_ALLOWED = 'TEST_PAYMENT_NOT_ALLOWED';
