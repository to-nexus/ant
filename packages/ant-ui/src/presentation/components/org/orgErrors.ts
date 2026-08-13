/**
 * Org error mapping — `@ant/shared/orgTeam.ts` stable codes → localized
 * messages (`config:org.errors.*`). Single mapping site so every org surface
 * (panel sections, banners, modal) renders the same copy for the same code.
 */

import type { TFunction } from 'i18next';
import { ApiError } from '@/infrastructure/http/api/client';

const CODE_KEYS: Record<string, [string, string]> = {
  ORG_ID_TAKEN: ['org.errors.idTaken', 'That team id is already taken.'],
  ORG_ID_RESERVED: ['org.errors.idReserved', 'That name is reserved and cannot be used.'],
  ORG_NAME_INVALID: ['org.errors.nameInvalid', 'Enter a valid name.'],
  ORG_NOT_FOUND: ['org.errors.notFound', 'Organization not found.'],
  ORG_DELETED: ['org.errors.deleted', 'This organization was deleted.'],
  ORG_NOT_EMPTY: ['org.errors.notEmpty', 'Remove all members before deleting the organization.'],
  NOT_A_MEMBER: ['org.errors.notAMember', 'Member not found.'],
  ALREADY_MEMBER: ['org.errors.alreadyMember', 'Already a member of this organization.'],
  ROLE_FORBIDDEN: ['org.errors.roleForbidden', 'Your role does not allow this action.'],
  OWNER_MUST_TRANSFER: ['org.errors.ownerMustTransfer', 'Transfer ownership first.'],
  CANNOT_CHANGE_OWNER_ROLE: ['org.errors.cannotChangeOwnerRole', 'Ownership changes go through transfer.'],
  MEMBERSHIP_REQUIRED: ['org.errors.membershipRequired', 'You are no longer a member of this organization.'],
  INVITE_NOT_FOUND: ['org.errors.inviteNotFound', 'Invite not found.'],
  INVITE_EXPIRED: ['org.errors.inviteExpired', 'This invite has expired.'],
  INVITE_REVOKED: ['org.errors.inviteRevoked', 'This invite was revoked.'],
  INVITE_ALREADY_ACCEPTED: ['org.errors.inviteAlreadyAccepted', 'This invite was already used.'],
  INVITE_ALREADY_PENDING: ['org.errors.inviteAlreadyPending', 'An invite for this email is already pending.'],
  INVITE_EMAIL_MISMATCH: ['org.errors.inviteEmailMismatch', 'This invite was issued for a different email.'],
  DOMAIN_ALREADY_CLAIMED: ['org.errors.domainAlreadyClaimed', 'This domain is already claimed by another organization.'],
  DOMAIN_INVALID: ['org.errors.domainInvalid', 'Enter a valid domain.'],
  DOMAIN_NOT_FOUND: ['org.errors.domainNotFound', 'Domain claim not found.'],
  DOMAIN_NOT_VERIFIED: ['org.errors.domainNotVerified', 'Your email domain does not grant access to this organization.'],
  CONSUMER_DOMAIN_NOT_CLAIMABLE: ['org.errors.consumerDomain', 'Consumer email domains cannot be claimed.'],
};

/** Localized message for an org API failure; falls back to the raw message. */
export function orgErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError && err.code && CODE_KEYS[err.code]) {
    const [key, fallback] = CODE_KEYS[err.code];
    return t(key, fallback);
  }
  if (err instanceof Error && err.message) return err.message;
  return t('org.errors.generic', 'Something went wrong. Please try again.');
}

/** Stable code extractor (UI branches like ALREADY_MEMBER-as-success). */
export function orgErrorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}
