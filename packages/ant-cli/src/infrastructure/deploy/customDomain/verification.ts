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

/**
 * Parse a user-supplied hostname into the canonical base + wildcard intent. A
 * leading `*.` marks a wildcard registration and is stripped to the base domain
 * (which is what ownership is verified against and what the record is keyed by).
 */
export function parseHostnameInput(input: string): { hostname: string; wildcard: boolean } {
  const trimmed = normalizeHostname(input);
  if (trimmed.startsWith('*.')) {
    return { hostname: trimmed.slice(2), wildcard: true };
  }
  return { hostname: trimmed, wildcard: false };
}

/**
 * Parent-domain candidates for wildcard walk-up matching, most-specific first.
 * Strips one leftmost label at a time, keeping only suffixes with >= 2 labels
 * (never the host itself, never a bare public suffix). `a.b.example.com` →
 * `['b.example.com', 'example.com']`. Routing checks each candidate for an
 * active `wildcard` registration; the first hit wins.
 */
export function parentHostCandidates(hostname: string): string[] {
  const labels = hostname.split('.').filter(Boolean);
  const candidates: string[] = [];
  // Start one label in (exclude the host itself); stop while >= 2 labels remain.
  for (let i = 1; labels.length - i >= 2; i++) {
    candidates.push(labels.slice(i).join('.'));
  }
  return candidates;
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
 * platform CNAME target (e.g. `ant-domains.your-domain.tld`); `apexIps` are the NLB
 * elastic IPs used for apex A records.
 *
 * When `wildcard` is set, `hostname` is the base domain and the connection is a
 * `*.<base>` CNAME covering every subdomain; the bare apex (which a wildcard
 * CNAME cannot cover) gets an additional A-record when apex IPs are provisioned.
 */
export function buildDnsInstructions(
  hostname: string,
  token: string,
  opts: { cnameTarget: string; apexIps: string[] },
  wildcard = false,
): CustomDomainDnsInstructions {
  const txt = { name: `${CHALLENGE_PREFIX}.${hostname}`, value: token };

  if (wildcard) {
    return {
      txt,
      connection: { kind: 'cname', name: `*.${hostname}`, value: opts.cnameTarget },
      apex: false,
      wildcard: true,
      ...(opts.apexIps.length > 0
        ? { apexConnection: { kind: 'a' as const, name: hostname, values: opts.apexIps } }
        : {}),
    };
  }

  const apex = isApexDomain(hostname);
  return {
    txt,
    connection: apex
      ? { kind: 'a', name: hostname, values: opts.apexIps }
      : { kind: 'cname', name: hostname, value: opts.cnameTarget },
    apex,
  };
}
