import { describe, it, expect } from 'vitest';
import { isPrivateAddress } from '../../src/agents/architect/graph/design/nodes/tool/handlers/assets';

// B2 (security review): the download_asset SSRF guard must treat cloud-metadata,
// loopback, private, link-local and CGNAT ranges as internal, while letting
// public addresses through.
describe('download_asset SSRF address classifier', () => {
  it('flags cloud metadata + loopback + private + link-local + CGNAT', () => {
    for (const ip of [
      '169.254.169.254', // AWS/GCP metadata (IPv4 link-local)
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '::1',
      'fe80::1', // IPv6 link-local
      'fd00::1', // IPv6 ULA
      '::ffff:127.0.0.1', // IPv4-mapped loopback
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('treats unparseable input as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});
