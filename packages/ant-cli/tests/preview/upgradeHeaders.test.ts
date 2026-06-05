/**
 * Regression guard for the WebSocket upgrade header rewrite shared by the
 * preview and deploy tunnels (`PreviewServer.rewriteUpgradeHeaders`).
 *
 * The preview proxy fronts per-package dev servers on a public domain. A dev
 * server's cross-origin protection (e.g. Next.js `allowedDevOrigins`) rejects
 * the HMR websocket when the forwarded `Origin` is anything it does not trust:
 *   - the public preview domain (`ant-preview.crosstoken.io`), or
 *   - the upstream's cloud connect address (a pod IP like `10.0.28.196`).
 * Both manifest as a perpetually failing HMR socket in preview. The tunnel
 * therefore normalizes BOTH `Host` and `Origin` to LOOPBACK — a host every dev
 * server trusts as same-origin — independent of the connect host. The function
 * no longer receives the connect host, so a pod IP cannot leak into the headers.
 */

import { describe, it, expect } from 'vitest';
import { rewriteUpgradeHeaders } from '../../src/infrastructure/preview/PreviewServer';

const LOOPBACK = '127.0.0.1';
const PORT = 30001;

describe('rewriteUpgradeHeaders', () => {
  it('rewrites Host to loopback', () => {
    const out = rewriteUpgradeHeaders(['Host', 'ant-preview.crosstoken.io'], PORT);
    expect(out).toContain(`Host: ${LOOPBACK}:${PORT}`);
    expect(out).not.toContain('Host: ant-preview.crosstoken.io');
  });

  it('rewrites Origin to loopback so the dev server sees same-origin (HMR cross-origin fix)', () => {
    const out = rewriteUpgradeHeaders(['Origin', 'https://ant-preview.crosstoken.io'], PORT);
    expect(out).toContain(`Origin: http://${LOOPBACK}:${PORT}`);
    expect(out).not.toContain('Origin: https://ant-preview.crosstoken.io');
  });

  // The cloud-only failure: in cloud the upstream is reached via a pod IP, and
  // the old rewrite stamped that pod IP into Origin/Host — which Next.js's
  // `allowedDevOrigins` rejects. The headers must be loopback regardless of any
  // upstream address present on the inbound request.
  it('never leaks a non-loopback upstream host (pod IP) into Host/Origin', () => {
    const out = rewriteUpgradeHeaders(
      ['Host', '10.0.28.196:30001', 'Origin', 'http://10.0.28.196:30001'],
      PORT,
    );
    expect(out).toContain(`Host: ${LOOPBACK}:${PORT}`);
    expect(out).toContain(`Origin: http://${LOOPBACK}:${PORT}`);
    expect(out.join('\n')).not.toContain('10.0.28.196');
  });

  it('matches Host/Origin case-insensitively', () => {
    const out = rewriteUpgradeHeaders(
      ['HOST', 'pub.example', 'ORIGIN', 'https://pub.example'],
      PORT,
    );
    expect(out).toContain(`Host: ${LOOPBACK}:${PORT}`);
    expect(out).toContain(`Origin: http://${LOOPBACK}:${PORT}`);
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
