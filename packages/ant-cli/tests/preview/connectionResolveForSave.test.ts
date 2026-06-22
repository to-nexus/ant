/**
 * Locks the ant-project resolution that runs before persisting a preview-config
 * Save. Regression guard for the `Cannot read properties of undefined (reading
 * 'replace')` 500: a `self` / service-less ant-project connection must NOT call
 * packageSlug with `undefined` — it resolves to the whole-backend proxy path.
 */

import { describe, it, expect } from 'vitest';
import { resolveConnectionForSave } from '../../src/periphery/adapters/http/services/PreviewService/utils/connectionResolve';
import type { ServiceConnection } from '../../src/core/ports/portRegistry';

const ctx = { projectId: 'shop', feature: 'main', organizationId: 'local', userId: 'local' };

const conn = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  id: 'backend',
  name: 'Backend',
  category: 'business',
  envVar: 'BACKEND_URL',
  value: '',
  resolution: { type: 'url', url: '' },
  source: '*',
  virtualization: { toggleEnvVar: 'USE_MOCK_BACKEND', active: false },
  ...over,
});

describe('resolveConnectionForSave — ant-project', () => {
  it('does not throw and yields a bare urlKey for a self (service-less) connection', () => {
    const c = conn({ resolution: { type: 'ant-project', projectId: 'self', feature: 'self' } });
    const out = resolveConnectionForSave(c, ctx);
    expect(out.resolution).toMatchObject({
      type: 'ant-project',
      serviceName: undefined,
      resolvedUrlKey: 'local--local--shop--main',
    });
    expect(out.value).toBe('/local--local--shop--main');
  });

  it('does not throw for an explicit project+feature without a serviceName', () => {
    const c = conn({ resolution: { type: 'ant-project', projectId: 'api', feature: 'dev' } });
    const out = resolveConnectionForSave(c, ctx);
    expect(out.resolution).toMatchObject({
      serviceName: undefined,
      resolvedUrlKey: 'local--local--api--dev',
    });
    expect(out.value).toBe('/local--local--api--dev');
  });

  it('slugs and appends the service segment when a serviceName is present', () => {
    const c = conn({ resolution: { type: 'ant-project', projectId: 'api', feature: 'dev', serviceName: 'apps/web' } });
    const out = resolveConnectionForSave(c, ctx);
    expect(out.resolution).toMatchObject({
      serviceName: 'apps-web',
      resolvedUrlKey: 'local--local--api--dev--apps-web',
    });
    expect(out.value).toBe('/local--local--api--dev--apps-web');
  });

  it('passes non-ant-project connections through unchanged', () => {
    const c = conn({ resolution: { type: 'url', url: 'http://localhost:4000' }, value: 'http://localhost:4000' });
    expect(resolveConnectionForSave(c, ctx)).toEqual(c);
  });
});
