import type { Organization, Membership, UserRecord } from '../../../core/auth/types';
import type {
  OrganizationRepositoryPort,
  OrganizationSummary,
} from '../../../core/ports/organizationRepository';

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
}
