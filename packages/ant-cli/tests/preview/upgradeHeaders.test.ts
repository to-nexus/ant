/**
 * Regression guard for the WebSocket upgrade header rewrite shared by the
 * preview and deploy tunnels (`PreviewServer.rewriteUpgradeHeaders`).
 *
 * The preview proxy fronts per-package dev servers on a public domain. A dev
 * server's cross-origin protection (e.g. Next.js `allowedDevOrigins`) rejects
 * the HMR websocket when the forwarded `Origin` is the public preview domain
 * rather than the dev server's own origin — which manifests as a perpetually
 * failing HMR socket in preview. The tunnel therefore normalizes BOTH `Host`
 * and `Origin` to the upstream so the dev server sees a same-origin handshake.
 */

import { describe, it, expect } from 'vitest';
import { rewriteUpgradeHeaders } from '../../src/infrastructure/preview/PreviewServer';

const HOST = '127.0.0.1';
const PORT = 30001;

describe('rewriteUpgradeHeaders', () => {
  it('rewrites Host to the upstream', () => {
    const out = rewriteUpgradeHeaders(['Host', 'ant-preview.crosstoken.io'], HOST, PORT);
    expect(out).toContain(`Host: ${HOST}:${PORT}`);
    expect(out).not.toContain('Host: ant-preview.crosstoken.io');
  });

  it('rewrites Origin to the upstream so the dev server sees same-origin (HMR cross-origin fix)', () => {
    const out = rewriteUpgradeHeaders(
      ['Origin', 'https://ant-preview.crosstoken.io'],
      HOST,
      PORT,
    );
    expect(out).toContain(`Origin: http://${HOST}:${PORT}`);
    expect(out).not.toContain('Origin: https://ant-preview.crosstoken.io');
  });

  it('matches Host/Origin case-insensitively', () => {
    const out = rewriteUpgradeHeaders(
      ['HOST', 'pub.example', 'ORIGIN', 'https://pub.example'],
      HOST,
      PORT,
    );
    expect(out).toContain(`Host: ${HOST}:${PORT}`);
    expect(out).toContain(`Origin: http://${HOST}:${PORT}`);
  });

  it('passes other headers through unchanged', () => {
    const out = rewriteUpgradeHeaders(
      ['Sec-WebSocket-Key', 'abc==', 'Upgrade', 'websocket'],
      HOST,
      PORT,
    );
    expect(out).toContain('Sec-WebSocket-Key: abc==');
    expect(out).toContain('Upgrade: websocket');
  });

  it('does NOT synthesize an Origin when the request had none', () => {
    const out = rewriteUpgradeHeaders(['Host', 'pub.example'], HOST, PORT);
    expect(out.some((h) => h.toLowerCase().startsWith('origin:'))).toBe(false);
  });
});
