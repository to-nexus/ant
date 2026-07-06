/**
 * CustomDomainService — orchestrates the deploy-only custom-domain lifecycle:
 * register → verify (TXT) → active, plus list/delete and realtime status push.
 *
 * Serving/routing is NOT here — that lives in the deploy proxy
 * (`DeployService.resolveCustomDomain`). This service owns only the management
 * plane (registry writes + ownership verification + SSE).
 */

import type {
  CustomDomain,
  CustomDomainTarget,
  CustomDomainDnsInstructions,
  CustomDomainStatusEventData,
} from '@ant/shared';
import type { StateStorePort } from '../../../core/ports/stateStore';
import { getRealtimeBroadcastChannel } from '../../state/redisConstants';
import { logger } from '../../../utils/logger';
import {
  normalizeHostname,
  isValidHostname,
  generateVerificationToken,
  verifyDomainOwnership,
  buildDnsInstructions,
} from './verification';
import { getCustomDomainCnameTarget, getCustomDomainApexIps, isCustomDomainEnabled } from './config';

export interface DeployCoords {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
}

export type RegisterResult =
  | { ok: true; domain: CustomDomain; dns: CustomDomainDnsInstructions }
  | { ok: false; reason: 'not-enabled' | 'invalid-hostname' | 'already-taken'; message: string };

export class CustomDomainService {
  constructor(private readonly stateStore: StateStorePort) {}

  isEnabled(): boolean {
    return isCustomDomainEnabled();
  }

  private dnsFor(hostname: string, token: string): CustomDomainDnsInstructions {
    return buildDnsInstructions(hostname, token, {
      cnameTarget: getCustomDomainCnameTarget() || '',
      apexIps: getCustomDomainApexIps(),
    });
  }

  /**
   * Register a custom domain for a deploy package. Idempotent for the same
   * owner (re-registering returns the existing record + fresh DNS instructions);
   * rejected if the hostname is already claimed by a DIFFERENT deploy.
   */
  async register(
    coords: DeployCoords,
    rawHostname: string,
    target: CustomDomainTarget,
    slug: string | undefined,
    nowIso: string,
  ): Promise<RegisterResult> {
    if (!this.isEnabled()) {
      return { ok: false, reason: 'not-enabled', message: 'Custom domains are not enabled in this environment.' };
    }
    const hostname = normalizeHostname(rawHostname);
    if (!isValidHostname(hostname)) {
      return { ok: false, reason: 'invalid-hostname', message: 'Enter a valid fully-qualified hostname (e.g. app.example.com).' };
    }

    const existing = await this.stateStore.getCustomDomainByHost(hostname);
    if (existing && !this.sameOwner(existing, coords)) {
      return { ok: false, reason: 'already-taken', message: 'This hostname is already attached to another deploy.' };
    }

    // Re-register for the same owner reuses the token so the user's already-set
    // TXT record stays valid; a brand-new registration mints a fresh token.
    const verificationToken = existing?.verificationToken ?? generateVerificationToken();
    const domain: CustomDomain = {
      hostname,
      tenantId: coords.tenantId,
      userId: coords.userId,
      projectId: coords.projectId,
      feature: coords.feature,
      slug,
      target,
      verificationToken,
      status: existing?.status === 'active' ? 'active' : 'pending_dns',
      certStatus: existing?.certStatus ?? 'none',
      error: undefined,
      createdAt: existing?.createdAt ?? nowIso,
      verifiedAt: existing?.verifiedAt,
    };
    await this.stateStore.registerCustomDomain(domain);
    await this.broadcast(domain);
    return { ok: true, domain, dns: this.dnsFor(hostname, verificationToken) };
  }

  /** Attempt ownership verification. On success flips the record to `active`. */
  async verify(coords: DeployCoords, rawHostname: string, nowIso: string): Promise<CustomDomain | null> {
    const hostname = normalizeHostname(rawHostname);
    const domain = await this.stateStore.getCustomDomainByHost(hostname);
    if (!domain || !this.sameOwner(domain, coords)) return null;

    if (domain.status !== 'active') {
      await this.stateStore.updateCustomDomainStatus(hostname, { status: 'verifying', error: undefined });
    }
    const owned = await verifyDomainOwnership(hostname, domain.verificationToken);
    const patch = owned
      ? { status: 'active' as const, verifiedAt: nowIso, error: undefined }
      : { status: 'pending_dns' as const, error: 'TXT record not found yet. DNS can take time to propagate.' };
    await this.stateStore.updateCustomDomainStatus(hostname, patch);

    const updated = await this.stateStore.getCustomDomainByHost(hostname);
    if (updated) await this.broadcast(updated);
    return updated;
  }

  async list(coords: DeployCoords): Promise<Array<CustomDomain & { dns: CustomDomainDnsInstructions }>> {
    const domains = await this.stateStore.listCustomDomainsForDeploy(
      coords.tenantId, coords.userId, coords.projectId, coords.feature,
    );
    return domains.map((d) => ({ ...d, dns: this.dnsFor(d.hostname, d.verificationToken) }));
  }

  /** Delete a domain the caller owns. Returns false if not found / not owned. */
  async delete(coords: DeployCoords, rawHostname: string): Promise<boolean> {
    const hostname = normalizeHostname(rawHostname);
    const domain = await this.stateStore.getCustomDomainByHost(hostname);
    if (!domain || !this.sameOwner(domain, coords)) return false;
    await this.stateStore.deleteCustomDomain(hostname);
    await this.broadcast({ ...domain, status: 'error', error: 'removed' });
    return true;
  }

  private sameOwner(d: CustomDomain, c: DeployCoords): boolean {
    return d.tenantId === c.tenantId && d.userId === c.userId && d.projectId === c.projectId && d.feature === c.feature;
  }

  private async broadcast(domain: CustomDomain): Promise<void> {
    try {
      const channel = getRealtimeBroadcastChannel(domain.tenantId, domain.userId);
      const data: CustomDomainStatusEventData = {
        projectId: domain.projectId,
        feature: domain.feature,
        hostname: domain.hostname,
        target: domain.target,
        status: domain.status,
        certStatus: domain.certStatus,
        sessionKey: `${domain.projectId}:${domain.feature}:${domain.hostname}`,
        error: domain.error,
      };
      await this.stateStore.publish(channel, {
        type: 'customDomainStatus',
        projectId: domain.projectId,
        featureName: domain.feature,
        data,
        userContext: { organizationId: domain.tenantId, userId: domain.userId },
      });
    } catch (err: any) {
      logger.warn(`[CustomDomain] broadcast failed: ${err.message}`, { component: 'CustomDomainService' });
    }
  }
}
