import type {
  Organization,
  Membership,
  UserRecord,
  Invitation,
  OrgDomainClaim,
  OrgJoinRequest,
  OrgMemberRemoval,
} from '../../../core/auth/types';
import type {
  OrganizationRepositoryPort,
  OrganizationSummary,
} from '../../../core/ports/organizationRepository';
import type { ApprovalStatus, AdminConfig } from '@ant/shared';

/**
 * No-op `OrganizationRepositoryPort` — the dormant fallback the factory selects
 * when the `@ant/cloud` overlay is absent (OSS / local mode). Local mode runs on
 * the fixed `local:local` tenant with no per-user org state, so reads return
 * empty and writes are no-ops. The kind-dispatch org/transfer routes stay in OSS
 * as dormant code; this keeps them NPE-safe past the (now un-gated) wiring.
 */
export class NoopOrganizationRepository implements OrganizationRepositoryPort {
  async getOrganization(): Promise<Organization | null> {
    return null;
  }

  async getOrCreateOrganization(input: {
    id: string;
    name: string;
  }): Promise<Organization> {
    return {
      id: input.id,
      name: input.name,
      ownerId: null,
      createdAt: new Date(0).toISOString(),
    };
  }

  async searchOrganizations(): Promise<OrganizationSummary[]> {
    return [];
  }

  async setOrganizationDiscoverable(): Promise<Organization | null> {
    return null;
  }

  // -------- Teams (local = no org concept; reads empty, writes refuse) --------

  async createOrganization(): Promise<Organization | null> {
    return null;
  }

  async updateOrganizationName(): Promise<Organization | null> {
    return null;
  }

  async softDeleteOrganization(): Promise<void> {
    // intentional no-op
  }

  async listOrganizations(): Promise<Organization[]> {
    return [];
  }

  async listOrgMemberships(): Promise<Membership[]> {
    return [];
  }

  async removeMembership(): Promise<void> {
    // intentional no-op
  }

  async setMembershipRole(): Promise<Membership | null> {
    return null;
  }

  async transferOwnership(): Promise<boolean> {
    return false;
  }

  async createInvite(): Promise<void> {
    // intentional no-op
  }

  async getInvite(): Promise<Invitation | null> {
    return null;
  }

  async getInviteByToken(): Promise<Invitation | null> {
    return null;
  }

  async listOrgInvites(): Promise<Invitation[]> {
    return [];
  }

  async listInvitesByEmail(): Promise<Invitation[]> {
    return [];
  }

  async updateInvite(): Promise<void> {
    // intentional no-op
  }

  async createDomainClaim(): Promise<OrgDomainClaim | null> {
    return null;
  }

  async getDomainClaim(): Promise<OrgDomainClaim | null> {
    return null;
  }

  async listOrgDomains(): Promise<OrgDomainClaim[]> {
    return [];
  }

  async updateDomainClaim(): Promise<void> {
    // intentional no-op
  }

  async patchDomainJoinPolicy(): Promise<OrgDomainClaim | null> {
    return null;
  }

  async deleteDomainClaim(): Promise<void> {
    // intentional no-op
  }

  async createJoinRequest(): Promise<OrgJoinRequest | null> {
    return null;
  }

  async getJoinRequest(): Promise<OrgJoinRequest | null> {
    return null;
  }

  async listJoinRequestsByOrg(): Promise<OrgJoinRequest[]> {
    return [];
  }

  async listJoinRequestsByUser(): Promise<OrgJoinRequest[]> {
    return [];
  }

  async setJoinRequestStatus(): Promise<OrgJoinRequest | null> {
    return null;
  }

  async recordMemberRemoval(): Promise<void> {
    // intentional no-op
  }

  async getMemberRemoval(): Promise<OrgMemberRemoval | null> {
    return null;
  }

  async listRemovedMembers(): Promise<OrgMemberRemoval[]> {
    return [];
  }

  async clearMemberRemoval(): Promise<void> {
    // intentional no-op
  }

  async attachMembership(input: {
    userId: string;
    organizationId: string;
  }): Promise<Membership> {
    return {
      userId: input.userId,
      organizationId: input.organizationId,
      role: 'member',
      createdAt: new Date(0).toISOString(),
    };
  }

  async getMembership(): Promise<Membership | null> {
    return null;
  }

  async listUserOrganizations(): Promise<Organization[]> {
    return [];
  }

  async listMembershipsByUser(): Promise<Membership[]> {
    return [];
  }

  async getUser(): Promise<UserRecord | null> {
    return null;
  }

  async getUserByEmail(): Promise<UserRecord | null> {
    return null;
  }

  async upsertUser(input: {
    id: string;
    email: string;
    currentOrganizationId: string | null;
  }): Promise<UserRecord> {
    return {
      id: input.id,
      email: input.email,
      currentOrganizationId: input.currentOrganizationId,
      createdAt: new Date(0).toISOString(),
    };
  }

  async backfillFromWorkspaceTree(): Promise<{
    orgsCreated: number;
    usersCreated: number;
    membershipsCreated: number;
    skipped: number;
  }> {
    return { orgsCreated: 0, usersCreated: 0, membershipsCreated: 0, skipped: 0 };
  }

  // -------- Approval / admin (local = always approved, no admin surface) --------

  async getUserApproval(): Promise<ApprovalStatus> {
    return 'approved';
  }

  async setUserApproval(): Promise<void> {
    // intentional no-op
  }

  async setTestAccountLevel(): Promise<void> {
    // intentional no-op
  }

  async listUsers(): Promise<UserRecord[]> {
    return [];
  }

  async getAdminConfig(): Promise<AdminConfig> {
    return { defaultApprovalMode: 'auto-approve', updatedAt: new Date(0).toISOString(), updatedBy: '' };
  }

  async setAdminConfig(): Promise<void> {
    // intentional no-op
  }

  async syncSuperAdmins(): Promise<void> {
    // intentional no-op
  }
}
