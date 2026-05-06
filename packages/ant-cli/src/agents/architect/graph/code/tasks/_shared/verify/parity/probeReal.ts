/**
 * `_shared/verify/parity/probeReal` — best-effort reachability probe for the
 * production endpoint of every business `@connection` declared in the
 * project's `.env.example`.
 *
 * The parity orchestrator (`./index.ts`) uses the result to decide whether
 * the second variant (USE_MOCK=false → production adapter) is worth running
 * at all. When the real endpoint does not respond, running the production
 * variant would fail for environmental reasons unrelated to adapter parity,
 * so we skip it and emit a warning instead of a retryable violation.
 *
 * Design constraints:
 *
 * - **Best-effort** — never throws to the caller. A network error / timeout
 *   resolves to `{ reachable: false }`, NOT a rejection.
 * - **Bounded** — total time spent probing all endpoints is capped by
 *   `PROBE_TIMEOUT_MS` per endpoint × `connections.length`.
 * - **No payload assumptions** — uses HEAD (falls back to GET on 405) so we
 *   do not require the endpoint to be JSON / a specific verb.
 * - **No follow-redirects loop** — single hop; redirect targets are treated
 *   as "endpoint exists" (3xx is reachable for our purposes).
 */

import { URL } from 'url';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

const PROBE_TIMEOUT_MS = 2_000;

export interface ProbeTarget {
  /** Connection name (used for diagnostic messages and toggle env var derivation). */
  name: string;
  /** Connection URL — typically `state.connections[i].value` from PreviewService. */
  url: string;
}

export interface ProbeOutcome {
  name: string;
  url: string;
  reachable: boolean;
  /** First-line summary suitable for warning text — present on both branches. */
  detail: string;
}

export interface ProbeRealResult {
  /** Per-target outcomes in input order. */
  outcomes: ProbeOutcome[];
  /** Convenience: every outcome reported reachable === true. */
  allReachable: boolean;
  /** Convenience: not a single outcome reachable. */
  noneReachable: boolean;
}

function isHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

async function probeOne(target: ProbeTarget): Promise<ProbeOutcome> {
  const parsed = isHttpUrl(target.url);
  if (!parsed) {
    return {
      name: target.name,
      url: target.url,
      reachable: false,
      detail: 'non-http url skipped',
    };
  }

  const reqFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false;
    const safeResolve = (outcome: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const req = reqFn(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method: 'HEAD',
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Drain response so the socket can close cleanly.
        res.resume();
        // Any HTTP response (including 4xx / 5xx) means the endpoint
        // exists; the production adapter would receive a real response
        // shape from it. Network-level failure is what we treat as
        // "unreachable".
        safeResolve({
          name: target.name,
          url: target.url,
          reachable: status > 0,
          detail: `HEAD → ${status}`,
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      safeResolve({
        name: target.name,
        url: target.url,
        reachable: false,
        detail: `timeout after ${PROBE_TIMEOUT_MS}ms`,
      });
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      safeResolve({
        name: target.name,
        url: target.url,
        reachable: false,
        detail: `${err.code ?? 'error'}: ${err.message}`,
      });
    });

    req.end();
  });
}

export async function probeReal(
  targets: readonly ProbeTarget[],
): Promise<ProbeRealResult> {
  if (targets.length === 0) {
    return { outcomes: [], allReachable: false, noneReachable: true };
  }
  const outcomes = await Promise.all(targets.map(probeOne));
  const allReachable = outcomes.every((o) => o.reachable);
  const noneReachable = outcomes.every((o) => !o.reachable);
  return { outcomes, allReachable, noneReachable };
}
