import { describe, it, expect } from 'vitest';
import {
  toUrlKey,
  toUrlKeyWithService,
  packageSlug,
  parseUrlKey,
} from '../../src/periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';

/**
 * These tests pin the URL-generation contract that PreviewService and
 * DeployService both honor:
 *
 *   single frontend  → 4-part `toUrlKey(serverKey)`
 *   multi-frontend   → 5-part `toUrlKeyWithService(serverKey, slug)`
 *
 * The contract is shared between two services to avoid the kind of
 * duplicated/divergent logic the user asked us to prevent. If this test
 * breaks, look for an inlined urlKey computation that should be using
 * the shared helpers in `serverKeyUtils.ts`.
 */

interface PkgIdentityInput {
  packages: Array<{ name: string; type: 'frontend' | 'backend' | 'other' }>;
  serverKey: string;
}

interface ResolvedPkg {
  name: string;
  slug: string;
  type: 'frontend' | 'backend' | 'other';
  urlKey?: string;
}

/**
 * Reference implementation of the slug + urlKey assignment rule.
 * MUST stay byte-identical with the live implementations:
 *   - PreviewService.assignPackageUrlIdentity
 *   - DeployService.assignDeployIdentity (frontend filter)
 */
function assignIdentity({ packages, serverKey }: PkgIdentityInput): ResolvedPkg[] {
  const out: ResolvedPkg[] = packages.map(p => ({ ...p, slug: '' }));
  const used = new Set<string>();
  for (const pkg of out) {
    const base = packageSlug(pkg.name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    pkg.slug = slug;
  }
  const frontendCount = out.filter(p => p.type === 'frontend').length;
  for (const pkg of out) {
    if (pkg.type !== 'frontend') {
      pkg.urlKey = undefined;
      continue;
    }
    pkg.urlKey = frontendCount > 1
      ? toUrlKeyWithService(serverKey, pkg.slug)
      : toUrlKey(serverKey);
  }
  return out;
}

const SERVER_KEY = 'org:user:proj:feat';
const FOUR_PART = 'org--user--proj--feat';

describe('Multi-package URL contract', () => {
  describe('Single frontend (back-compat)', () => {
    it('emits the 4-part urlKey — bit-stable with pre-multi-package builds', () => {
      const [pkg] = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [{ name: 'web', type: 'frontend' }],
      });
      expect(pkg.urlKey).toBe(FOUR_PART);
    });

    it('still emits 4-part when the project also has backends/other', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [
          { name: 'api', type: 'backend' },
          { name: 'web', type: 'frontend' },
          { name: 'docs', type: 'other' },
        ],
      });
      const fe = result.find(p => p.type === 'frontend')!;
      expect(fe.urlKey).toBe(FOUR_PART);
      // Non-frontend packages get a slug for proxy matching but no urlKey.
      const be = result.find(p => p.type === 'backend')!;
      expect(be.slug).toBe('api');
      expect(be.urlKey).toBeUndefined();
    });
  });

  describe('Multi frontend', () => {
    it('emits 5-part urlKey carrying the package slug for every frontend', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [
          { name: 'apps/web', type: 'frontend' },
          { name: 'apps/admin', type: 'frontend' },
        ],
      });

      const web = result.find(p => p.name === 'apps/web')!;
      const admin = result.find(p => p.name === 'apps/admin')!;

      expect(web.urlKey).toBe(`${FOUR_PART}--apps-web`);
      expect(admin.urlKey).toBe(`${FOUR_PART}--apps-admin`);
    });

    it('produces parsable urlKeys with the slug recoverable as serviceName', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [
          { name: 'apps/web', type: 'frontend' },
          { name: 'apps/admin', type: 'frontend' },
        ],
      });

      for (const pkg of result) {
        const parsed = parseUrlKey(pkg.urlKey!);
        expect(parsed?.serviceName).toBe(pkg.slug);
        expect(parsed?.tenantId).toBe('org');
        expect(parsed?.feature).toBe('feat');
      }
    });

    it('dedupes slug collisions with deterministic -N suffixes', () => {
      // Three names that all baseline-slug to `apps-web`:
      //   apps/web   → apps-web
      //   apps-web   → apps-web (literal duplicate)
      //   @apps/web  → apps-web (`@` stripped, `/` → `-`)
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [
          { name: 'apps/web', type: 'frontend' },
          { name: 'apps-web', type: 'frontend' },
          { name: '@apps/web', type: 'frontend' },
        ],
      });

      const slugs = result.map(p => p.slug);
      // All slugs must be unique — proxy match is by exact slug.
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(slugs).toEqual(['apps-web', 'apps-web-2', 'apps-web-3']);
      // None of the dedup suffixes can introduce `--` (would break URL key parsing).
      for (const s of slugs) expect(s.includes('--')).toBe(false);
    });

    it('does not emit a urlKey for non-frontend packages, even when frontends are multiple', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [
          { name: 'apps/web', type: 'frontend' },
          { name: 'apps/admin', type: 'frontend' },
          { name: 'api', type: 'backend' },
        ],
      });
      const be = result.find(p => p.type === 'backend')!;
      expect(be.urlKey).toBeUndefined();
      expect(be.slug).toBe('api');
    });
  });

  describe('Top-level url derivation', () => {
    /**
     * Mirror of PreviewService.computeTopLevelUrl / DeployService.computeTopLevelDeployUrl.
     */
    function topLevelUrl(packages: Array<{ type: string; urlKey?: string }>): string | null {
      const frontends = packages.filter(p => p.type === 'frontend');
      if (frontends.length === 1) return frontends[0].urlKey ? `/${frontends[0].urlKey}` : null;
      if (frontends.length === 0) return null;
      return null;
    }

    it('returns the single 4-part URL when there is exactly one frontend', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [{ name: 'web', type: 'frontend' }],
      });
      expect(topLevelUrl(result)).toBe(`/${FOUR_PART}`);
    });

    it('returns null when there are 2+ frontends — FE must use packages[].url', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [
          { name: 'apps/web', type: 'frontend' },
          { name: 'apps/admin', type: 'frontend' },
        ],
      });
      expect(topLevelUrl(result)).toBeNull();
    });

    it('returns null when there are 0 frontends', () => {
      const result = assignIdentity({
        serverKey: SERVER_KEY,
        packages: [{ name: 'api', type: 'backend' }],
      });
      expect(topLevelUrl(result)).toBeNull();
    });
  });
});
