import { describe, it, expect } from 'vitest';
import { resolveDeployTarget } from '../../src/periphery/adapters/http/middleware/deployRouting';
import type { DeployState } from '../../src/core/ports/portRegistry';

/**
 * Unit tests for the deploy routing SSOT. The same function is called from
 * both the HTTP middleware (deployProxy.ts) and the WebSocket upgrade handler
 * (PreviewServer.ts), so a regression here breaks both surfaces at once.
 */

function makeState(overrides: Partial<DeployState>): DeployState {
  return {
    tenantId: 'org',
    userId: 'user',
    projectId: 'proj',
    feature: 'feat',
    phase: 'running',
    host: '10.0.0.5',
    podId: 'pod-1',
    workspacePath: '/tmp/deploy',
    packages: [],
    startedAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  };
}

function pkg(slug: string, port: number) {
  return {
    name: slug,
    slug,
    framework: 'nextjs',
    workspacePath: `/tmp/deploy/${slug}`,
    buildOutputDir: `/tmp/deploy/${slug}/.next`,
    basePath: `/deploy/org--user--proj--feat--${slug}`,
    port,
    urlKey: `org--user--proj--feat--${slug}`,
    url: `/deploy/org--user--proj--feat--${slug}`,
    phase: 'running' as const,
  } as any;
}

describe('resolveDeployTarget', () => {
  it('4-part single-package → returns the sole package port', () => {
    const state = makeState({ packages: [pkg('web', 30001)] });
    expect(resolveDeployTarget(state, undefined, 'org--user--proj--feat')).toEqual({
      targetHost: '10.0.0.5',
      targetPort: 30001,
    });
  });

  it('4-part multi-package → null (caller must use 5-part)', () => {
    const state = makeState({ packages: [pkg('web', 30001), pkg('admin', 30002)] });
    expect(resolveDeployTarget(state, undefined, 'org--user--proj--feat')).toBeNull();
  });

  it('5-part slug match → returns matching package port', () => {
    const state = makeState({ packages: [pkg('web', 30001), pkg('admin', 30002)] });
    expect(
      resolveDeployTarget(state, 'admin', 'org--user--proj--feat--admin'),
    ).toEqual({ targetHost: '10.0.0.5', targetPort: 30002 });
  });

  it('5-part slug mismatch → null', () => {
    const state = makeState({ packages: [pkg('web', 30001), pkg('admin', 30002)] });
    expect(
      resolveDeployTarget(state, 'ghost', 'org--user--proj--feat--ghost'),
    ).toBeNull();
  });

  it('5-part serviceName is normalized via packageSlug (matches stored slug)', () => {
    // Slug stored as "apps-web" (from packageSlug("apps/web")). Caller may
    // pass the original name; packageSlug normalization must apply.
    const state = makeState({ packages: [pkg('apps-web', 30001)] });
    expect(
      resolveDeployTarget(state, 'apps/web', 'org--user--proj--feat--apps-web'),
    ).toEqual({ targetHost: '10.0.0.5', targetPort: 30001 });
  });

  it('state.host empty → falls back to localhost', () => {
    const state = makeState({ host: '', packages: [pkg('web', 30001)] });
    expect(resolveDeployTarget(state, undefined, 'org--user--proj--feat')).toEqual({
      targetHost: 'localhost',
      targetPort: 30001,
    });
  });

  it('empty packages → null', () => {
    const state = makeState({ packages: [] });
    expect(resolveDeployTarget(state, undefined, 'org--user--proj--feat')).toBeNull();
  });
});
