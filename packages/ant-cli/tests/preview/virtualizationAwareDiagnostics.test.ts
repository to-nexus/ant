import { describe, it, expect } from 'vitest';
import { RuntimeDiagnostics } from '../../src/periphery/adapters/http/services/PreviewService/detectors/RuntimeDiagnostics';
import type { ServiceConnection } from '../../src/core/ports/portRegistry';

/**
 * Phase 3 — Service-Virtualization-aware diagnostics.
 *
 * Locks the truth table from plan §6.3:
 *
 *   | input                                     | severity | suggestionPrefix |
 *   |-------------------------------------------|----------|------------------|
 *   | ECONNREFUSED + business + active=false    | warning  | toggleEnvVar=true |
 *   | ECONNREFUSED + business + active=true     | warning  | "false alarm"    |
 *   | ECONNREFUSED + infrastructure (no virt)   | fatal    | (none)           |
 *   | env-missing  + business + active=false    | warning  | toggleEnvVar=true |
 *
 * The downgrade rule is intentionally domain-blind: it inspects ONLY
 * `connection.virtualization` (the SSOT signal that "this connection has
 * a virtualized adapter pair"). Adding a `mock:*` token to the
 * annotation grammar to bypass this rule is forbidden — see plan §0.
 */

function makeBusinessConn(overrides: Partial<ServiceConnection> = {}): ServiceConnection {
  return {
    id: 'stripe-api',
    name: 'Stripe API',
    category: 'business',
    envVar: 'STRIPE_API_KEY',
    value: 'http://localhost:4242',
    resolution: { type: 'url', url: 'http://localhost:4242' },
    virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: false },
    ...overrides,
  };
}

function makeInfraConn(overrides: Partial<ServiceConnection> = {}): ServiceConnection {
  return {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'infrastructure',
    envVar: 'DATABASE_URL',
    value: 'postgres://user:pw@localhost:5432/db',
    resolution: { type: 'docker', service: 'postgres', port: 5432 },
    ...overrides,
  };
}

describe('RuntimeDiagnostics — Service Virtualization awareness', () => {
  const diag = new RuntimeDiagnostics();

  it('case 1: ECONNREFUSED on business connection (active=false) → warning + toggleEnvVar suggestion', () => {
    const logs = 'Error: connect ECONNREFUSED 127.0.0.1:4242';
    const conns = [makeBusinessConn({ value: 'http://localhost:4242' })];
    const { issues } = diag.analyze(logs, conns);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].suggestedFix).toContain('USE_MOCK_STRIPE_API=true');
    expect(issues[0].suggestedFix).toContain('Service Virtualization');
  });

  it('case 2: ECONNREFUSED on business connection (active=true) → warning + false-alarm prefix', () => {
    const logs = 'Error: connect ECONNREFUSED 127.0.0.1:4242';
    const conns = [makeBusinessConn({
      value: 'http://localhost:4242',
      virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: true },
    })];
    const { issues } = diag.analyze(logs, conns);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].suggestedFix).toContain('USE_MOCK_STRIPE_API=true');
    expect(issues[0].suggestedFix).toMatch(/활성|active/i);
  });

  it('case 3: ECONNREFUSED on infrastructure connection (no virtualization) → fatal preserved', () => {
    const logs = 'Error: connect ECONNREFUSED 127.0.0.1:5432';
    const conns = [makeInfraConn({ value: 'postgres://user:pw@localhost:5432/db' })];
    const { issues } = diag.analyze(logs, conns);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('fatal');
    expect(issues[0].suggestedFix).not.toContain('USE_MOCK');
    expect(issues[0].suggestedFix).not.toContain('Service Virtualization');
  });

  it('case 4: env-missing on business connection → warning + toggleEnvVar suggestion', () => {
    const logs = 'Error: environment variable STRIPE_API_KEY is not set';
    const conns = [makeBusinessConn()];
    const { issues } = diag.analyze(logs, conns);

    const envMissing = issues.find(i => i.reasoning === 'env-missing');
    expect(envMissing).toBeDefined();
    expect(envMissing!.severity).toBe('warning');
    expect(envMissing!.suggestedFix).toContain('USE_MOCK_STRIPE_API=true');
  });

  it('case 5: env-missing on infrastructure connection → fatal preserved', () => {
    const logs = 'Error: environment variable DATABASE_URL is not set';
    const conns = [makeInfraConn()];
    const { issues } = diag.analyze(logs, conns);

    const envMissing = issues.find(i => i.reasoning === 'env-missing');
    expect(envMissing).toBeDefined();
    expect(envMissing!.severity).toBe('fatal');
    expect(envMissing!.suggestedFix).not.toContain('USE_MOCK');
  });

  it('case 6: ECONNREFUSED with no matching connection → fatal (downgrade only fires when connection identifiable)', () => {
    const logs = 'Error: connect ECONNREFUSED 127.0.0.1:9999';
    const { issues } = diag.analyze(logs, []);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('fatal');
  });
});
