/**
 * Custom-domain ownership verification (deploy-only).
 *
 * Ownership is proven by a DNS TXT record the user places under their own
 * zone: `_ant-challenge.<hostname>` must contain the token we issued. Only a
 * party that controls the domain's authoritative DNS can create it, so a
 * successful lookup proves control. Verification MUST pass before the domain
 * routes traffic or is eligible for on-demand certificate issuance
 * (`tls-ask` returns 200 only for `status === 'active'`) — this is what
 * prevents domain-hijacking / certificate abuse.
 *
 * This module is pure infra glue (DNS + crypto). No routing/state decisions.
 */

import { promises as dns } from 'dns';
import { randomBytes } from 'crypto';
import type { CustomDomainDnsInstructions } from '@ant/shared';
import { logger } from '../../../utils/logger';

/** TXT record name prefix the user must create under their hostname. */
export const CHALLENGE_PREFIX = '_ant-challenge';

/** Generate an unguessable challenge token for a new custom-domain registration. */
export function generateVerificationToken(): string {
  return `ant-verify-${randomBytes(24).toString('hex')}`;
}

/** Normalize a user-supplied hostname to the canonical lowercased form (no trailing dot / scheme / path). */
export function normalizeHostname(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

/** Basic hostname shape guard — rejects empty, spaces, single-label, or bare IPs. */
export function isValidHostname(hostname: string): boolean {
  if (!hostname || /\s/.test(hostname)) return false;
  if (!hostname.includes('.')) return false; // must be FQDN
  if (/^[0-9.]+$/.test(hostname)) return false; // reject IPv4 literal
  return /^[a-z0-9.-]+$/.test(hostname) && !hostname.startsWith('.') && !hostname.startsWith('-');
}

/**
 * Heuristic apex (root-domain) detection: exactly two labels (`example.com`).
 * Approximate for multi-part public suffixes (`example.co.uk`); the register
 * route may accept an explicit override. Apex domains cannot use a CNAME and
 * must point an A record at the NLB EIPs.
 */
export function isApexDomain(hostname: string): boolean {
  return hostname.split('.').filter(Boolean).length === 2;
}

/**
 * Verify the `_ant-challenge.<hostname>` TXT record contains `token`.
 * Returns false (never throws) on any DNS error (NXDOMAIN, timeout, etc.).
 */
export async function verifyDomainOwnership(hostname: string, token: string): Promise<boolean> {
  const name = `${CHALLENGE_PREFIX}.${hostname}`;
  try {
    const records = await dns.resolveTxt(name);
    // resolveTxt returns string[][] — each record may be split into chunks.
    return records.some((chunks) => chunks.join('').trim() === token);
  } catch (err: any) {
    logger.debug(`[CustomDomain] TXT lookup failed for ${name}: ${err?.code || err?.message}`, {
      component: 'CustomDomainVerify',
    });
    return false;
  }
}

/**
 * Build the DNS records the user must create. `cnameTarget` is the stable
 * platform CNAME target (e.g. `ant-domains.cross.nexus`); `apexIps` are the NLB
 * elastic IPs used for apex A records.
 */
export function buildDnsInstructions(
  hostname: string,
  token: string,
  opts: { cnameTarget: string; apexIps: string[] },
): CustomDomainDnsInstructions {
  const apex = isApexDomain(hostname);
  return {
    txt: { name: `${CHALLENGE_PREFIX}.${hostname}`, value: token },
    connection: apex
      ? { kind: 'a', name: hostname, values: opts.apexIps }
      : { kind: 'cname', name: hostname, value: opts.cnameTarget },
    apex,
  };
}
