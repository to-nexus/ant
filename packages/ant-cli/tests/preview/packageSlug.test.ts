import { describe, it, expect } from 'vitest';
import {
  packageSlug,
  isUrlKey,
  toUrlKeyWithService,
  parseUrlKey,
} from '../../src/periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';

/**
 * `packageSlug` is the SSOT helper used by every producer/consumer of the
 * 5-part urlKey segment. These tests pin its semantics so future refactors
 * cannot silently change URL identity rules across services (preview proxy,
 * deploy proxy, ConnectionDetector resolution).
 */
describe('packageSlug', () => {
  it('passes through already-slug-safe names unchanged', () => {
    expect(packageSlug('web')).toBe('web');
    expect(packageSlug('admin-app')).toBe('admin-app');
  });

  it('replaces forward and back slashes with single hyphens', () => {
    expect(packageSlug('apps/web')).toBe('apps-web');
    expect(packageSlug('apps\\web')).toBe('apps-web');
    expect(packageSlug('packages/sub/leaf')).toBe('packages-sub-leaf');
  });

  it('strips scope prefix and other non-alphanumeric characters', () => {
    expect(packageSlug('@scope/ui')).toBe('scope-ui');
    expect(packageSlug('@my-org/web.app')).toBe('my-org-webapp');
  });

  it('collapses runs of separators into a single hyphen', () => {
    expect(packageSlug('apps///web')).toBe('apps-web');
    expect(packageSlug('apps---web')).toBe('apps-web');
  });

  it('trims leading and trailing hyphens', () => {
    expect(packageSlug('-web-')).toBe('web');
    expect(packageSlug('//apps//')).toBe('apps');
  });

  it('falls back to "pkg" when the input collapses to empty', () => {
    expect(packageSlug('')).toBe('pkg');
    expect(packageSlug('///')).toBe('pkg');
    expect(packageSlug('....')).toBe('pkg');
  });

  it('produces output that round-trips through urlKey helpers', () => {
    // Critical: the slug we emit MUST be safe to inject as the 5th
    // segment of a URL-safe serverKey.
    const internal = 'org:user:proj:feat';
    const slug = packageSlug('apps/web');
    const urlKey = toUrlKeyWithService(internal, slug);

    expect(isUrlKey(urlKey)).toBe(true);
    const parsed = parseUrlKey(urlKey);
    expect(parsed?.serviceName).toBe('apps-web');
  });

  it('never produces a `--` substring (would clash with URL_KEY_SEPARATOR)', () => {
    const tricky = ['a--b', 'a---b', 'apps//-//web', '----'];
    for (const t of tricky) {
      const out = packageSlug(t);
      expect(out.includes('--')).toBe(false);
    }
  });

  it('is deterministic — same input yields same output', () => {
    const a = packageSlug('apps/web');
    const b = packageSlug('apps/web');
    expect(a).toBe(b);
  });
});

/**
 * Demonstrates the dedup contract `packageSlug` itself does NOT enforce —
 * callers (PreviewService, DeployService) must dedupe collisions. This test
 * documents the expected discipline so reviewers can spot drift.
 */
describe('packageSlug — dedup contract (caller discipline)', () => {
  it('returns colliding slugs for inputs that map to the same value', () => {
    expect(packageSlug('apps/web')).toBe(packageSlug('apps-web'));
    expect(packageSlug('apps_web')).toBe(packageSlug('appsweb'));
  });

  it('callers using the prescribed -N suffix dedup do not produce `--`', () => {
    // Rule documented in PreviewService.assignPackageUrlIdentity / DeployService.assignDeployIdentity:
    //   slug-2, slug-3, …  (single hyphen, never `--`).
    const seen = new Set<string>();
    const make = (name: string): string => {
      const base = packageSlug(name);
      let slug = base;
      let n = 2;
      while (seen.has(slug)) slug = `${base}-${n++}`;
      seen.add(slug);
      return slug;
    };

    // Three inputs that all baseline-slug to `apps-web`:
    //   apps/web     → apps-web
    //   apps-web     → apps-web (literal collision)
    //   @apps/web    → apps-web (`@` stripped, `/` → `-`)
    expect(make('apps/web')).toBe('apps-web');
    expect(make('apps-web')).toBe('apps-web-2');
    expect(make('@apps/web')).toBe('apps-web-3');

    for (const s of seen) {
      expect(s.includes('--')).toBe(false);
    }
  });
});
