/**
 * URL egress policy — the single owner of "may this process open a connection
 * to that host".
 *
 * Every server-side reach to a URL the model (or a definition author) chose
 * answers one of two questions, and each question has exactly one predicate:
 *
 *  - LOOPBACK: is this the dev server the job itself started on this host?
 *    `isLoopbackHost` — `http_request`, shell `curl`/`wget`.
 *  - PUBLIC EGRESS: does this http(s) URL resolve ONLY to public addresses?
 *    `resolvePublicEgress` — `download_asset`, the `fetch_url` self-fetcher,
 *    a declared `apis.baseUrl` in cloud mode. Every A/AAAA record is
 *    classified (`isPrivateAddress`), and the vetted address is what the
 *    connection is pinned to, so a later DNS answer cannot rebind the socket
 *    to an internal target.
 *
 * `fetchPublicUrl` is the one fetch loop built on the second predicate:
 * pinned connection, manual redirects re-vetted per hop, byte-bounded body.
 * Do not open a second fetch path for public reads — every previous SSRF
 * finding was a consumer that had its own.
 */

import * as net from 'net';

/** A refusal decided by this policy — distinct from a network failure. */
export class EgressPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressPolicyError';
  }
}

export function isEgressPolicyError(e: unknown): e is EgressPolicyError {
  return e instanceof Error && e.name === 'EgressPolicyError';
}

/** Node's `URL.hostname` keeps the brackets of an IPv6 literal (`[::1]`). */
function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Loopback host test for the dev-server tools (port already removed). Accepts
 * `localhost`, 127.0.0.0/8, `::1`, and the unspecified binds `0.0.0.0` / `::`
 * (a server bound there answers on loopback).
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const octets = m.slice(1, 5).map(Number);
    return octets.every(o => o >= 0 && o <= 255) && octets[0] === 127;
  }
  return false;
}

/**
 * True when `ip` is a loopback / private / link-local / CGNAT address (IPv4 or
 * IPv6). Unparseable input is treated as unsafe. `169.254.169.254` (cloud
 * metadata) falls under the IPv4 link-local block.
 */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80')) return true; // link-local
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export interface VettedEgress {
  url: URL;
  /** The one address the connection must be pinned to. */
  address: string;
  family: number;
}

/**
 * Validate one http(s) URL and resolve it to a single vetted public address.
 * A literal-IP host is classified without DNS; a name has EVERY record
 * checked. Throws `EgressPolicyError` on a policy refusal; a DNS failure
 * propagates as an ordinary error.
 */
export async function resolvePublicEgress(rawUrl: string): Promise<VettedEgress> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new EgressPolicyError(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new EgressPolicyError(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  const host = stripBrackets(parsed.hostname);
  const literalFamily = net.isIP(host);
  if (literalFamily !== 0) {
    if (isPrivateAddress(host)) throw new EgressPolicyError(`Blocked internal address for host: ${host}`);
    return { url: parsed, address: host, family: literalFamily };
  }
  if (isLoopbackHost(host)) throw new EgressPolicyError(`Blocked internal address for host: ${host}`);

  const { lookup } = await import('dns/promises');
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    throw new EgressPolicyError(`Blocked internal address for host: ${host}`);
  }
  return { url: parsed, address: resolved[0].address, family: resolved[0].family };
}

export interface PublicFetchOptions {
  /** Hard ceiling on the body. */
  maxBytes: number;
  /** What happens past the ceiling: refuse the response, or keep the first `maxBytes`. */
  onOverflow: 'throw' | 'truncate';
  timeoutMs: number;
  maxRedirects: number;
  headers?: Record<string, string>;
}

export interface PublicFetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

/**
 * Pinned, manually-redirected, byte-bounded GET of a public URL.
 *
 * Redirects are followed one hop at a time, each `Location` re-vetted through
 * `resolvePublicEgress` before the next connection; the connection is pinned
 * to the vetted address via a custom `connect.lookup` while Host/SNI keep the
 * original hostname (TLS + vhosts keep working). No cookies, no ambient
 * credentials — only the caller's explicit headers ride along. A 4xx/5xx is an
 * error naming the status; the caller decides how to frame it.
 */
export async function fetchPublicUrl(rawUrl: string, opts: PublicFetchOptions): Promise<PublicFetchResult> {
  const { Agent, request } = await import('undici');
  let current = rawUrl;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const vetted = await resolvePublicEgress(current);
    const agent = new Agent({
      connect: {
        lookup: (_hostname: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void) =>
          cb(null, vetted.address, vetted.family),
      },
    });

    try {
      // undici `request` does not follow redirects on its own — each 3xx is
      // returned so it can be re-validated above before the next hop.
      const res = await request(current, {
        method: 'GET',
        headers: opts.headers,
        dispatcher: agent,
        headersTimeout: opts.timeoutMs,
        bodyTimeout: opts.timeoutMs,
      });

      const status = res.statusCode;
      if (status >= 300 && status < 400) {
        const loc = res.headers['location'];
        await res.body.dump();
        if (!loc || hop === opts.maxRedirects) {
          throw new Error('Too many redirects or missing redirect target');
        }
        current = new URL(Array.isArray(loc) ? loc[0] : loc, current).toString();
        continue;
      }
      if (status >= 400) {
        await res.body.dump();
        throw new Error(`HTTP ${status}`);
      }

      const declared = Number(res.headers['content-length']);
      if (opts.onOverflow === 'throw' && Number.isFinite(declared) && declared > opts.maxBytes) {
        await res.body.dump();
        throw new Error(`Response exceeds ${opts.maxBytes} bytes`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let truncated = false;
      for await (const chunk of res.body) {
        const buf = chunk as Buffer;
        if (total + buf.length > opts.maxBytes) {
          if (opts.onOverflow === 'throw') {
            res.body.destroy();
            throw new Error(`Response exceeds ${opts.maxBytes} bytes`);
          }
          chunks.push(buf.subarray(0, opts.maxBytes - total));
          total = opts.maxBytes;
          truncated = true;
          res.body.destroy();
          break;
        }
        total += buf.length;
        chunks.push(buf);
      }
      const ct = res.headers['content-type'];
      return {
        url: current,
        status,
        contentType: (Array.isArray(ct) ? ct[0] : ct) ?? '',
        body: Buffer.concat(chunks, total),
        truncated,
      };
    } finally {
      await agent.close().catch(() => {});
    }
  }
  throw new Error('Too many redirects');
}
