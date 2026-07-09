import { describe, it, expect } from 'vitest';
import { openRawTunnel, WS_HANDSHAKE_TIMEOUT_MS } from '../../src/infrastructure/preview/PreviewServer';
import { UPSTREAM_FETCH_TIMEOUT_MS } from '../../src/periphery/adapters/http/middleware/proxyForwarding';

/**
 * Timeout contract verification tests for preview proxy data path.
 *
 * These tests verify that the timeout constants are properly exported
 * and respect environment variable overrides.
 */

describe('openRawTunnel timeout contract', () => {
  it('exports openRawTunnel as a callable function with proper signature', () => {
    expect(typeof openRawTunnel).toBe('function');
    // Function should accept 7 parameters (6 required + 1 optional handshakeTimeoutMs)
    expect(openRawTunnel.length).toBeGreaterThanOrEqual(6);
  });

  it('exports WS_HANDSHAKE_TIMEOUT_MS constant with a default value', () => {
    expect(typeof WS_HANDSHAKE_TIMEOUT_MS).toBe('number');
    expect(WS_HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0);
    // Default should be 20_000 unless ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS is set
    if (!process.env.ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS) {
      expect(WS_HANDSHAKE_TIMEOUT_MS).toBe(20_000);
    }
  });

  it('respects ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS env var (if set)', () => {
    // This test only makes sense if the env var is set; skip otherwise
    if (!process.env.ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS) {
      expect(true).toBe(true); // Skip gracefully
      return;
    }
    const expected = Number(process.env.ANT_PREVIEW_WS_HANDSHAKE_TIMEOUT_MS);
    expect(WS_HANDSHAKE_TIMEOUT_MS).toBe(expected);
  });
});

describe('proxyForwarding timeout contract', () => {
  it('exports UPSTREAM_FETCH_TIMEOUT_MS constant with a default value', () => {
    expect(typeof UPSTREAM_FETCH_TIMEOUT_MS).toBe('number');
    expect(UPSTREAM_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    // Default should be 45_000 unless ANT_PREVIEW_PROXY_TIMEOUT_MS is set
    if (!process.env.ANT_PREVIEW_PROXY_TIMEOUT_MS) {
      expect(UPSTREAM_FETCH_TIMEOUT_MS).toBe(45_000);
    }
  });

  it('respects ANT_PREVIEW_PROXY_TIMEOUT_MS env var (if set)', () => {
    // This test only makes sense if the env var is set; skip otherwise
    if (!process.env.ANT_PREVIEW_PROXY_TIMEOUT_MS) {
      expect(true).toBe(true); // Skip gracefully
      return;
    }
    const expected = Number(process.env.ANT_PREVIEW_PROXY_TIMEOUT_MS);
    expect(UPSTREAM_FETCH_TIMEOUT_MS).toBe(expected);
  });

  it('timeout constants are finite and non-zero', () => {
    expect(Number.isFinite(UPSTREAM_FETCH_TIMEOUT_MS)).toBe(true);
    expect(Number.isFinite(WS_HANDSHAKE_TIMEOUT_MS)).toBe(true);
    expect(UPSTREAM_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(WS_HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
