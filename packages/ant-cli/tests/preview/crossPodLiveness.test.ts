/**
 * Tests for the cross-pod liveness gate used by both deploy and preview proxies.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { resolveCrossPodLiveness } from '../../src/core/utils/crossPodLiveness';

describe('resolveCrossPodLiveness', () => {
  describe('locally-owned short-circuit', () => {
    it('returns local-owned immediately without probing', async () => {
      const target = { host: 'invalid.unreachable.host', port: 99999 };
      const liveness = await resolveCrossPodLiveness(target, true);
      expect(liveness).toBe('local-owned');
    });
  });

  describe('cross-pod reachability probe', () => {
    let server: net.Server;
    let port: number;

    beforeEach(async () => {
      server = net.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          port = typeof addr === 'object' ? addr.port : 0;
          resolve();
        });
      });
    });

    afterEach(() => {
      if (server) server.close();
    });

    it('returns reachable for an open listening port', async () => {
      const target = { host: '127.0.0.1', port };
      const liveness = await resolveCrossPodLiveness(target, false, 1000);
      expect(liveness).toBe('reachable');
    });

    it('returns unreachable for a closed port', async () => {
      // Use a port that's extremely unlikely to be listening
      const target = { host: '127.0.0.1', port: 54321 };
      const liveness = await resolveCrossPodLiveness(target, false, 500);
      expect(liveness).toBe('unreachable');
    });

    it('returns unreachable for a black-holed host', async () => {
      // 127.0.0.2 is a loopback address that typically doesn't respond
      // (not the same as 127.0.0.1). This is flaky in some environments,
      // so we use a timeout to allow quick failure.
      const target = { host: '127.0.0.2', port: 12345 };
      const liveness = await resolveCrossPodLiveness(target, false, 100);
      expect(liveness).toBe('unreachable');
    });
  });
});
