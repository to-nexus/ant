/**
 * Regression guard for the WebSocket upgrade header rewrite shared by the
 * preview and deploy tunnels (`PreviewServer.rewriteUpgradeHeaders`).
 *
 * The preview proxy fronts per-package dev servers on a public domain. A dev
 * server's cross-origin protection rejects the HMR websocket when the forwarded
 * `Origin` is anything it does not trust:
 *   - the public preview domain (`ant-preview.crosstoken.io`),
 *   - the upstream's cloud connect address (a pod IP like `10.0.28.196`), or
 *   - the loopback IP `127.0.0.1` — Next 16 trusts the literal hostname
 *     `localhost` (hardcoded `['localhost','*.localhost',…]`) but NOT the IP,
 *     so the earlier `127.0.0.1` rewrite still got a 403 ("Blocked … from 127.0.0.1").
 * The tunnel therefore normalizes BOTH `Host` and `Origin` to `localhost` — the
 * dev server's own trusted self-origin — independent of the connect host.
 */

import { describe, it, expect } from 'vitest';
import { rewriteUpgradeHeaders } from '../../src/infrastructure/preview/PreviewServer';

const TRUSTED = 'localhost';
const PORT = 30001;

describe('rewriteUpgradeHeaders', () => {
  it('rewrites Host to the trusted localhost name', () => {
    const out = rewriteUpgradeHeaders(['Host', 'ant-preview.crosstoken.io'], PORT);
    expect(out).toContain(`Host: ${TRUSTED}:${PORT}`);
    expect(out).not.toContain('Host: ant-preview.crosstoken.io');
  });

  it('rewrites Origin to localhost so the dev server sees same-origin (HMR cross-origin fix)', () => {
    const out = rewriteUpgradeHeaders(['Origin', 'https://ant-preview.crosstoken.io'], PORT);
    expect(out).toContain(`Origin: http://${TRUSTED}:${PORT}`);
    expect(out).not.toContain('Origin: https://ant-preview.crosstoken.io');
  });

  // Locks the localhost-vs-127.0.0.1 distinction: Next 16's dev allowlist hardcodes
  // `localhost` but NOT the loopback IP, so stamping `127.0.0.1` (the prior fix)
  // is still 403'd. The headers MUST use the hostname, never the IP.
  it('uses the hostname `localhost`, NOT the loopback IP 127.0.0.1', () => {
    const out = rewriteUpgradeHeaders(
      ['Host', 'ant-preview.crosstoken.io', 'Origin', 'https://ant-preview.crosstoken.io'],
      PORT,
    );
    expect(out.join('\n')).not.toContain('127.0.0.1');
    expect(out).toContain(`Host: ${TRUSTED}:${PORT}`);
    expect(out).toContain(`Origin: http://${TRUSTED}:${PORT}`);
  });

  // The cloud-only failure: in cloud the upstream is reached via a pod IP, and
  // the old rewrite stamped that pod IP into Origin/Host — which the dev server
  // rejects. The headers must be `localhost` regardless of any upstream address
  // present on the inbound request.
  it('never leaks a non-loopback upstream host (pod IP) into Host/Origin', () => {
    const out = rewriteUpgradeHeaders(
      ['Host', '10.0.28.196:30001', 'Origin', 'http://10.0.28.196:30001'],
      PORT,
    );
    expect(out).toContain(`Host: ${TRUSTED}:${PORT}`);
    expect(out).toContain(`Origin: http://${TRUSTED}:${PORT}`);
    expect(out.join('\n')).not.toContain('10.0.28.196');
  });

  it('matches Host/Origin case-insensitively', () => {
    const out = rewriteUpgradeHeaders(
      ['HOST', 'pub.example', 'ORIGIN', 'https://pub.example'],
      PORT,
    );
    expect(out).toContain(`Host: ${TRUSTED}:${PORT}`);
    expect(out).toContain(`Origin: http://${TRUSTED}:${PORT}`);
  });

  it('passes other headers through unchanged', () => {
    const out = rewriteUpgradeHeaders(
      ['Sec-WebSocket-Key', 'abc==', 'Upgrade', 'websocket'],
      PORT,
    );
    expect(out).toContain('Sec-WebSocket-Key: abc==');
    expect(out).toContain('Upgrade: websocket');
  });

  it('does NOT synthesize an Origin when the request had none', () => {
    const out = rewriteUpgradeHeaders(['Host', 'pub.example'], PORT);
    expect(out.some((h) => h.toLowerCase().startsWith('origin:'))).toBe(false);
  });
});
