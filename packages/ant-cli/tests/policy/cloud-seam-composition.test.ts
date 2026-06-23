/**
 * OSS / Cloud seam — P0.9 guard #4: composition-layer wiring stays clean.
 *
 * The route + adapter composition layer must reach the cloud overlay ONLY via
 * the dynamic seam (`getCloudModule()` / `registerRoutes()`), never via a static
 * import of a cloud adapter or a cloud route bundle. This is the layer that
 * decides what the OSS build links; if it regains a static cloud import the
 * public build breaks.
 *
 * P2 physically moved the billing/cloud-auth adapters to `@ant/cloud`. The
 * final `describe` below now enforces their ABSENCE from OSS `src` (whole-tree
 * scan) — the inverted ratchet. The job-runner orchestrator obtains the credit
 * ledger through the `loadCloudModule()` seam.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
// Line-based stripper: drops whole comment lines (`//`, JSDoc `*`, `/* … */`).
// A regex block-comment stripper would mis-fire on `/*` sequences inside string
// literals (e.g. the `'/billing/*'` log message), wiping real code.
const stripComments = (s: string) =>
  s
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

const MOVE_TARGET_ADAPTERS = [
  'RedisCreditLedger',
  'MockPaymentProvider',
  'RedisOrganizationRepository',
];

describe('RouteConfigurator — cloud routes only via the seam', () => {
  const code = stripComments(
    read('periphery/adapters/http/express/config/RouteConfigurator.ts'),
  );

  it('mounts the cloud overlay through getCloudModule().registerRoutes()', () => {
    expect(code).toMatch(/setupCloudOverlayRoutes\s*\(/);
    expect(code).toMatch(/getCloudModule\s*\(\s*\)/);
    expect(code).toMatch(/cloud\.registerRoutes\s*\(/);
  });

  it('does not statically import or mount cloud route bundles', () => {
    // The retired direct billing-route wiring must not reappear.
    expect(code).not.toMatch(/createBillingRoutes/);
    expect(code).not.toMatch(/setupBillingRoutes/);
    for (const adapter of MOVE_TARGET_ADAPTERS) {
      expect(code.includes(adapter)).toBe(false);
    }
  });
});

describe('InfrastructureFactory — Noop adapters only, cloud via dynamic getter', () => {
  const code = stripComments(read('infrastructure/adapters/InfrastructureFactory.ts'));

  it('imports the Noop adapters, never the cloud move-target adapters', () => {
    for (const adapter of MOVE_TARGET_ADAPTERS) {
      expect(code).not.toMatch(new RegExp(`\\bimport\\b[^;]*\\b${adapter}\\b`));
    }
    expect(code).toMatch(/NoopCreditLedger/);
    expect(code).toMatch(/NoopPaymentProvider/);
    expect(code).toMatch(/NoopOrganizationRepository/);
  });

  it('warm-loads the overlay via the cloudPlugin seam and throws when absent in cloud mode', () => {
    expect(code).toMatch(/loadCloudModule\s*\(/);
    expect(code).toMatch(/async\s+initCloud\s*\(/);
    expect(code).toMatch(/throw new Error\([^)]*@ant\/cloud/s);
  });
});

describe('composition roots — await initCloud() before wiring routes', () => {
  for (const root of [
    'composition/server.ts',
    'infrastructure/realtime/start-realtime-server.ts',
    'infrastructure/worker/start-job-worker.ts',
  ]) {
    it(`${root} awaits initCloud()`, () => {
      expect(stripComments(read(root))).toMatch(/await\s+[^;]*initCloud\s*\(\s*\)/);
    });
  }
});

describe('P2 — moved cloud adapters are absent from OSS src', () => {
  // Billing + cloud-auth adapters now live in @ant/cloud. No OSS src file may
  // statically import them. JwtService is intentionally EXCLUDED — it stayed
  // OSS as a neutral HS256 primitive (see handoff: shared by preview / WS /
  // jwtAuth middleware).
  const MOVED = [...MOVE_TARGET_ADAPTERS, 'AuthService', 'GoogleOIDCService'];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith('.ts')) out.push(p);
    }
    return out;
  };

  it('no OSS src file statically imports a moved cloud adapter', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const sym of MOVED) {
        if (new RegExp(`\\bimport\\b[^;]*\\b${sym}\\b[^;]*\\bfrom\\b`).test(code)) {
          offenders.push(`${file.slice(SRC.length + 1)} → ${sym}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('orchestrator obtains the credit ledger via the loadCloudModule seam', () => {
    const orchestrator = stripComments(read('composition/orchestrator.ts'));
    expect(orchestrator).not.toMatch(/\bimport\b[^;]*\bRedisCreditLedger\b/);
    expect(orchestrator).toMatch(/loadCloudModule\s*\(/);
    expect(orchestrator).toMatch(/createCreditLedger\s*\(/);
  });
});
