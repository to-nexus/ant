/**
 * Preview data-path timeout contract.
 *
 * `WS_HANDSHAKE_TIMEOUT_MS` / `UPSTREAM_FETCH_TIMEOUT_MS` are module-load-time
 * IIFEs over an env var with a hardcoded fallback. Two things are worth locking:
 * the default, and that a valid override actually wins (an operator raising the
 * timeout in a pod must not be silently ignored).
 *
 * Previously the override cases read:
 *
 *     if (!process.env.ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS) {
 *       expect(true).toBe(true); // Skip gracefully
 *       return;
 *     }
 *
 * That var is set by no CI job and no config, so both cases were permanent
 * no-ops. Overrides are now exercised for real by stubbing the env and
 * re-importing the module, which is the only way to re-run a load-time IIFE.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { openRawTunnel, WS_HANDSHAKE_TIMEOUT_MS } from '../../src/infrastructure/preview/PreviewServer';
import { UPSTREAM_FETCH_TIMEOUT_MS } from '../../src/periphery/adapters/http/middleware/proxyForwarding';

const WS_MODULE = '../../src/infrastructure/preview/PreviewServer';
const PROXY_MODULE = '../../src/periphery/adapters/http/middleware/proxyForwarding';

/** Re-evaluate a module's load-time constants under a stubbed env var. */
async function reimportWith<T>(
  envVar: string,
  value: string,
  modulePath: string,
  pick: (mod: any) => T,
): Promise<T> {
  vi.stubEnv(envVar, value);
  vi.resetModules();
  return pick(await import(modulePath));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('WS_HANDSHAKE_TIMEOUT_MS', () => {
  it('defaults to 20s when the env var is unset', () => {
    expect(process.env.ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS).toBeUndefined();
    expect(WS_HANDSHAKE_TIMEOUT_MS).toBe(20_000);
  });

  it('honors a valid ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS override', async () => {
    const v = await reimportWith(
      'ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS', '35000',
      WS_MODULE, (m) => m.WS_HANDSHAKE_TIMEOUT_MS,
    );
    expect(v).toBe(35_000);
  });

  it('falls back to the default on an unparseable override (never NaN)', async () => {
    const v = await reimportWith(
      'ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS', 'not-a-number',
      WS_MODULE, (m) => m.WS_HANDSHAKE_TIMEOUT_MS,
    );
    expect(v).toBe(20_000);
    expect(Number.isNaN(v)).toBe(false);
  });
});

describe('UPSTREAM_FETCH_TIMEOUT_MS', () => {
  it('defaults to 45s when the env var is unset', () => {
    expect(process.env.ANT_PREVIEW_PROXY_TIMEOUT_MS).toBeUndefined();
    expect(UPSTREAM_FETCH_TIMEOUT_MS).toBe(45_000);
  });

  it('honors a valid ANT_PREVIEW_PROXY_TIMEOUT_MS override', async () => {
    const v = await reimportWith(
      'ANT_PREVIEW_PROXY_TIMEOUT_MS', '90000',
      PROXY_MODULE, (m) => m.UPSTREAM_FETCH_TIMEOUT_MS,
    );
    expect(v).toBe(90_000);
  });

  it('falls back to the default on an unparseable override (never NaN)', async () => {
    const v = await reimportWith(
      'ANT_PREVIEW_PROXY_TIMEOUT_MS', '',
      PROXY_MODULE, (m) => m.UPSTREAM_FETCH_TIMEOUT_MS,
    );
    expect(v).toBe(45_000);
    expect(Number.isNaN(v)).toBe(false);
  });
});

describe('openRawTunnel signature', () => {
  it('accepts the handshake timeout as a trailing optional parameter', () => {
    // 6 required + optional handshakeTimeoutMs — Function.length counts only
    // the params before the first default/rest, so it pins the required arity.
    expect(typeof openRawTunnel).toBe('function');
    expect(openRawTunnel.length).toBeGreaterThanOrEqual(6);
  });
});
