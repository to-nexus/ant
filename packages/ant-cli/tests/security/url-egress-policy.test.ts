import { describe, it, expect } from 'vitest';
import {
  isEgressPolicyError,
  isLoopbackHost,
  isPrivateAddress,
  resolvePublicEgress,
} from '../../src/core/config/urlPolicy';

// One owner for "may this process open a connection to that host"
// (core/config/urlPolicy). The rows below are the classifier tables every
// consumer inherits — download_asset, the fetch_url self-fetcher, cloud-mode
// `apis.baseUrl`, http_request, and the shell curl/wget guard.
describe('isPrivateAddress — internal address classifier', () => {
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

describe('isLoopbackHost — the dev-server predicate', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '0.0.0.0', '::'])('accepts %s', (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });

  it.each(['169.254.169.254', '10.0.0.1', '192.168.0.1', 'example.com', 'localhost.evil.com', '127.0.0.256', 'fe80::1'])(
    'refuses %s',
    (h) => {
      expect(isLoopbackHost(h)).toBe(false);
    },
  );
});

describe('resolvePublicEgress — literal hosts decide without DNS', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data/', /internal address/],
    ['http://127.0.0.1:4100/api', /internal address/],
    ['http://[::1]:8080/', /internal address/],
    ['http://10.0.0.5/', /internal address/],
    ['http://localhost/', /internal address/],
    ['file:///etc/passwd', /scheme/],
    ['ftp://8.8.8.8/x', /scheme/],
    ['not a url', /Invalid URL/],
  ])('refuses %s as a policy error', async (url, re) => {
    const err = await resolvePublicEgress(url).then(() => null, (e) => e);
    expect(err, url).toBeTruthy();
    expect(isEgressPolicyError(err)).toBe(true);
    expect(String(err.message)).toMatch(re);
  });

  it('pins a public literal address without a lookup', async () => {
    const v = await resolvePublicEgress('https://93.184.216.34/page');
    expect(v.address).toBe('93.184.216.34');
    expect(v.family).toBe(4);
    expect(v.url.hostname).toBe('93.184.216.34');
  });
});
