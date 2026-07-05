/**
 * Regression: deploy proxy `/_next/image` basePath parity (Phase 1 P1-a).
 *
 * A Next.js app deployed with basePath `/deploy/<urlKey>` emits optimizer URLs
 * whose `url` param stays the authored root-absolute `/images/x` (next/image
 * never prefixes the src). The optimizer resolves it with `new URL(url,origin)`
 * ignoring basePath → fetches `/images/x` while public/ is served at
 * `/deploy/<urlKey>/images/x` → 404 → optimizer 400. Prepending the basePath
 * to the param fixes it (parity with the preview proxy). deployProxy previously
 * had NO such rewrite (deploy more broken than preview).
 */

import { describe, it, expect } from 'vitest';
import { rewriteNextImagePath } from '../../src/periphery/adapters/http/middleware/deployProxy';

const KEY = 'org--user--proj--feat';
const BASE = `/deploy/${KEY}`;

describe('deployProxy rewriteNextImagePath', () => {
  it('prepends the deploy basePath to a root-absolute optimizer url param', () => {
    const input = `${BASE}/_next/image?url=%2Fimages%2Fbranch-ochi-1.jpg&w=640&q=75`;
    const out = rewriteNextImagePath(input, BASE);
    const url = new URL(`http://localhost${out}`);
    expect(url.searchParams.get('url')).toBe(`${BASE}/images/branch-ochi-1.jpg`);
    // Other params preserved.
    expect(url.searchParams.get('w')).toBe('640');
    expect(url.searchParams.get('q')).toBe('75');
  });

  it('is idempotent — never double-prefixes an already-scoped param', () => {
    const already = `${BASE}/_next/image?url=${encodeURIComponent(`${BASE}/images/x.png`)}&w=64&q=75`;
    expect(rewriteNextImagePath(already, BASE)).toBe(already);
  });

  it('passes through non-image paths untouched', () => {
    const page = `${BASE}/about`;
    expect(rewriteNextImagePath(page, BASE)).toBe(page);
    const asset = `${BASE}/_next/static/chunks/main.js`;
    expect(rewriteNextImagePath(asset, BASE)).toBe(asset);
  });

  it('returns the path unchanged when there is no url param', () => {
    const noParam = `${BASE}/_next/image`;
    expect(rewriteNextImagePath(noParam, BASE)).toBe(noParam);
  });
});
