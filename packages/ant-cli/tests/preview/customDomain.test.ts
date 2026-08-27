/**
 * Custom domains (deploy-only): verification helpers, config gate,
 * CustomDomainService register/verify/list/delete, and the DeployService
 * active-only resolution gate + deployProxy custom-domain serving branch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  normalizeHostname,
  parseHostnameInput,
  parentHostCandidates,
  isValidHostname,
  isApexDomain,
  buildDnsInstructions,
  generateVerificationToken,
} from '../../src/infrastructure/deploy/customDomain/verification';
import { DeployService } from '../../src/infrastructure/deploy/DeployService';
import {
  isCustomDomainEnabled,
  getCustomDomainCnameTarget,
  getCustomDomainApexIps,
  getTlsAskSecret,
  assertTlsAskSecretConfigured,
} from '../../src/infrastructure/deploy/customDomain/config';
import { CustomDomainService } from '../../src/infrastructure/deploy/customDomain/CustomDomainService';
import { createDeployProxyMiddleware } from '../../src/periphery/adapters/http/middleware/deployProxy';
import type { CustomDomain } from '@ant/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';

const COORDS = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' };

describe('custom-domain verification helpers', () => {
  it('normalizes hostnames (scheme/path/case/trailing dot stripped)', () => {
    expect(normalizeHostname('HTTPS://App.Example.com/foo')).toBe('app.example.com');
    expect(normalizeHostname('app.example.com.')).toBe('app.example.com');
  });

  it('validates FQDN shape, rejects single-label / IP / spaces', () => {
    expect(isValidHostname('app.example.com')).toBe(true);
    expect(isValidHostname('example.com')).toBe(true);
    expect(isValidHostname('localhost')).toBe(false);
    expect(isValidHostname('1.2.3.4')).toBe(false);
    expect(isValidHostname('has space.com')).toBe(false);
  });

  it('detects apex vs subdomain (2-label heuristic)', () => {
    expect(isApexDomain('example.com')).toBe(true);
    expect(isApexDomain('app.example.com')).toBe(false);
  });

  it('builds CNAME instructions for subdomains, A instructions for apex', () => {
    const sub = buildDnsInstructions('app.example.com', 'tok', { cnameTarget: 'ant-domains.example.net', apexIps: ['1.1.1.1'] });
    expect(sub.apex).toBe(false);
    expect(sub.connection).toEqual({ kind: 'cname', name: 'app.example.com', value: 'ant-domains.example.net' });
    expect(sub.txt).toEqual({ name: '_ant-challenge.app.example.com', value: 'tok' });

    const apex = buildDnsInstructions('example.com', 'tok', { cnameTarget: 'ant-domains.example.net', apexIps: ['1.1.1.1', '2.2.2.2'] });
    expect(apex.apex).toBe(true);
    expect(apex.connection).toEqual({ kind: 'a', name: 'example.com', values: ['1.1.1.1', '2.2.2.2'] });
  });

  it('generates unguessable, unique-ish tokens', () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a).not.toEqual(b);
    expect(a.startsWith('ant-verify-')).toBe(true);
  });

  it('parses a leading `*.` into base + wildcard intent', () => {
    expect(parseHostnameInput('*.example.com')).toEqual({ hostname: 'example.com', wildcard: true });
    expect(parseHostnameInput('HTTPS://*.Example.com/')).toEqual({ hostname: 'example.com', wildcard: true });
    expect(parseHostnameInput('app.example.com')).toEqual({ hostname: 'app.example.com', wildcard: false });
  });

  it('walks up parent candidates most-specific-first, excluding self + public suffix', () => {
    expect(parentHostCandidates('deep.a.example.com')).toEqual(['a.example.com', 'example.com']);
    expect(parentHostCandidates('www.example.com')).toEqual(['example.com']);
    expect(parentHostCandidates('example.com')).toEqual([]); // apex has no >=2-label parent
  });

  it('builds wildcard instructions: `*.base` CNAME + apex A when apex IPs set', () => {
    const w = buildDnsInstructions('example.com', 'tok', { cnameTarget: 'ant-domains.example.net', apexIps: ['1.1.1.1', '2.2.2.2'] }, true);
    expect(w.wildcard).toBe(true);
    expect(w.apex).toBe(false);
    expect(w.connection).toEqual({ kind: 'cname', name: '*.example.com', value: 'ant-domains.example.net' });
    expect(w.txt).toEqual({ name: '_ant-challenge.example.com', value: 'tok' });
    expect(w.apexConnection).toEqual({ kind: 'a', name: 'example.com', values: ['1.1.1.1', '2.2.2.2'] });
  });

  it('omits apex A from wildcard instructions when apex IPs are not provisioned', () => {
    const w = buildDnsInstructions('example.com', 'tok', { cnameTarget: 'ant-domains.example.net', apexIps: [] }, true);
    expect(w.wildcard).toBe(true);
    expect(w.apexConnection).toBeUndefined();
  });
});

describe('custom-domain config gate', () => {
  const prev = process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET;
  const prevIps = process.env.ANT_CUSTOM_DOMAIN_APEX_IPS;
  afterEach(() => {
    if (prev === undefined) delete process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET;
    else process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET = prev;
    if (prevIps === undefined) delete process.env.ANT_CUSTOM_DOMAIN_APEX_IPS;
    else process.env.ANT_CUSTOM_DOMAIN_APEX_IPS = prevIps;
  });

  it('disabled without a CNAME target, enabled with it', () => {
    delete process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET;
    expect(isCustomDomainEnabled()).toBe(false);
    process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET = 'ant-domains.example.net';
    expect(isCustomDomainEnabled()).toBe(true);
    expect(getCustomDomainCnameTarget()).toBe('ant-domains.example.net');
  });

  it('parses comma-separated apex IPs', () => {
    process.env.ANT_CUSTOM_DOMAIN_APEX_IPS = '1.1.1.1, 2.2.2.2 ,';
    expect(getCustomDomainApexIps()).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  /**
   * L-NEW-002. `/internal/tls-ask` answers BEFORE authentication by design
   * (Caddy pauses a TLS handshake to ask it), and answering it calls
   * `ensureRunning()` — it wakes a private deploy. NetworkPolicy was the only
   * boundary, and a NetworkPolicy is a deployment artifact this process cannot
   * verify. The shared secret is one it can, so it is required rather than
   * optional — but only where the sink actually exists.
   */
  describe('tls-ask secret is required exactly where the sink exists', () => {
    const prevSecret = process.env.ANT_TLS_ASK_SECRET;
    afterEach(() => {
      if (prevSecret === undefined) delete process.env.ANT_TLS_ASK_SECRET;
      else process.env.ANT_TLS_ASK_SECRET = prevSecret;
    });

    it('refuses to boot: cloud + custom domains enabled + no secret', () => {
      process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET = 'ant-domains.example.net';
      delete process.env.ANT_TLS_ASK_SECRET;
      expect(() => assertTlsAskSecretConfigured(true)).toThrow(/ANT_TLS_ASK_SECRET/);
    });

    it('boots: cloud + custom domains DISABLED — no sink, so no new variable', () => {
      delete process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET;
      delete process.env.ANT_TLS_ASK_SECRET;
      expect(() => assertTlsAskSecretConfigured(true)).not.toThrow();
    });

    it('boots: local mode is a single-operator trust boundary', () => {
      process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET = 'ant-domains.example.net';
      delete process.env.ANT_TLS_ASK_SECRET;
      expect(() => assertTlsAskSecretConfigured(false)).not.toThrow();
    });

    it('boots once the secret is set', () => {
      process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET = 'ant-domains.example.net';
      process.env.ANT_TLS_ASK_SECRET = 's3cret';
      expect(() => assertTlsAskSecretConfigured(true)).not.toThrow();
      expect(getTlsAskSecret()).toBe('s3cret');
    });

    it('a blank secret is not a secret', () => {
      process.env.ANT_TLS_ASK_SECRET = '   ';
      expect(getTlsAskSecret()).toBeUndefined();
    });

    // ADV-094: `!==` on a secret leaks its prefix through response timing.
    it('the endpoint compares the secret in constant time', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../src/infrastructure/preview/PreviewServer.ts'),
        'utf8',
      );
      expect(src).toContain('timingSafeEqual');
      expect(src).not.toMatch(/x-ant-tls-ask-secret'\]\s*!==/);
    });
  });
});

/** Minimal in-memory state store double for the custom-domain surface. */
function fakeStore() {
  const map = new Map<string, CustomDomain>();
  return {
    _map: map,
    getCustomDomainByHost: vi.fn(async (h: string) => map.get(h.toLowerCase()) ?? null),
    registerCustomDomain: vi.fn(async (d: CustomDomain) => { map.set(d.hostname, d); }),
    updateCustomDomainStatus: vi.fn(async (h: string, patch: any) => {
      const d = map.get(h.toLowerCase()); if (d) Object.assign(d, patch);
    }),
    listCustomDomainsForDeploy: vi.fn(async () => [...map.values()]),
    deleteCustomDomain: vi.fn(async (h: string) => { map.delete(h.toLowerCase()); }),
    publish: vi.fn(async () => {}),
  } as any;
}

describe('CustomDomainService', () => {
  beforeEach(() => { process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET = 'ant-domains.example.net'; });
  afterEach(() => { delete process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET; vi.restoreAllMocks(); });

  it('register stores a pending_dns record + returns DNS instructions', async () => {
    const store = fakeStore();
    const svc = new CustomDomainService(store);
    const r = await svc.register(COORDS, 'App.Example.com', 'frontend', undefined, '2026-01-01T00:00:00Z');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.domain.hostname).toBe('app.example.com');
    expect(r.domain.status).toBe('pending_dns');
    expect(r.dns.connection.kind).toBe('cname');
    expect(store.registerCustomDomain).toHaveBeenCalledOnce();
    expect(store.publish).toHaveBeenCalledOnce();
  });

  it('rejects a hostname already owned by a different deploy', async () => {
    const store = fakeStore();
    const svc = new CustomDomainService(store);
    await svc.register(COORDS, 'app.example.com', 'frontend', undefined, 'now');
    const r = await svc.register({ ...COORDS, projectId: 'other' }, 'app.example.com', 'frontend', undefined, 'now');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('already-taken');
  });

  it('refuses registration when not enabled', async () => {
    delete process.env.ANT_CUSTOM_DOMAIN_CNAME_TARGET;
    const svc = new CustomDomainService(fakeStore());
    const r = await svc.register(COORDS, 'app.example.com', 'frontend', undefined, 'now');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-enabled');
  });

  it('delete only removes a domain owned by the caller', async () => {
    const store = fakeStore();
    const svc = new CustomDomainService(store);
    await svc.register(COORDS, 'app.example.com', 'frontend', undefined, 'now');
    expect(await svc.delete({ ...COORDS, userId: 'intruder' }, 'app.example.com')).toBe(false);
    expect(await svc.delete(COORDS, 'app.example.com')).toBe(true);
    expect(store._map.has('app.example.com')).toBe(false);
  });

  it('register stores the base keyed by wildcard flag (from `*.` input)', async () => {
    const store = fakeStore();
    const svc = new CustomDomainService(store);
    const r = await svc.register(COORDS, '*.example.com', 'frontend', undefined, 'now');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.domain.hostname).toBe('example.com');
    expect(r.domain.wildcard).toBe(true);
    expect(r.dns.connection).toEqual(expect.objectContaining({ kind: 'cname', name: '*.example.com' }));
    expect(store._map.get('example.com')?.wildcard).toBe(true);
  });

  it('register honors an explicit wildcard flag on a base domain', async () => {
    const store = fakeStore();
    const svc = new CustomDomainService(store);
    const r = await svc.register(COORDS, 'example.com', 'frontend', undefined, 'now', true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.domain.wildcard).toBe(true);
  });
});

describe('DeployService.resolveCustomDomain wildcard walk-up', () => {
  function svcWith(records: Partial<CustomDomain>[]): DeployService {
    const map = new Map<string, CustomDomain>();
    for (const r of records) map.set(r.hostname!.toLowerCase(), { status: 'active', ...COORDS, ...r } as CustomDomain);
    const stateStore: any = { getCustomDomainByHost: async (h: string) => map.get(h.toLowerCase()) ?? null };
    return new DeployService({ portManager: {} as any, stateStore, workspacesPath: '/tmp' });
  }

  it('resolves any subdomain to an active wildcard registration on the base', async () => {
    const svc = svcWith([{ hostname: 'example.com', wildcard: true, projectId: 'wild' }]);
    expect((await svc.resolveCustomDomain('www.example.com'))?.projectId).toBe('wild');
    expect((await svc.resolveCustomDomain('deep.a.example.com'))?.projectId).toBe('wild');
    // apex matches the same record via exact lookup
    expect((await svc.resolveCustomDomain('example.com'))?.projectId).toBe('wild');
  });

  it('prefers an exactly-registered sibling over the wildcard parent', async () => {
    const svc = svcWith([
      { hostname: 'example.com', wildcard: true, projectId: 'wild' },
      { hostname: 'api.example.com', projectId: 'exact' },
    ]);
    expect((await svc.resolveCustomDomain('api.example.com'))?.projectId).toBe('exact');
    expect((await svc.resolveCustomDomain('www.example.com'))?.projectId).toBe('wild');
  });

  it('does NOT wildcard-serve subdomains from a non-wildcard parent', async () => {
    const svc = svcWith([{ hostname: 'example.com', wildcard: false, projectId: 'apexonly' }]);
    expect(await svc.resolveCustomDomain('www.example.com')).toBeNull();
    expect((await svc.resolveCustomDomain('example.com'))?.projectId).toBe('apexonly');
  });

  it('ignores an inactive wildcard registration', async () => {
    const svc = svcWith([{ hostname: 'example.com', wildcard: true, status: 'pending_dns', projectId: 'wild' }]);
    expect(await svc.resolveCustomDomain('www.example.com')).toBeNull();
  });
});

describe('deployProxy custom-domain branch', () => {
  const prevBase = process.env.ANT_DEPLOY_BASE_DOMAIN;
  const prevPrev = process.env.ANT_PREVIEW_BASE_DOMAIN;
  let fetchSpy: any;

  beforeEach(() => {
    process.env.ANT_PREVIEW_BASE_DOMAIN = 'ant-preview.test';
    process.env.ANT_DEPLOY_BASE_DOMAIN = 'ant-deploy.test';
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      status: 200, headers: new Headers(), body: null,
    } as any);
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.ANT_DEPLOY_BASE_DOMAIN; else process.env.ANT_DEPLOY_BASE_DOMAIN = prevBase;
    if (prevPrev === undefined) delete process.env.ANT_PREVIEW_BASE_DOMAIN; else process.env.ANT_PREVIEW_BASE_DOMAIN = prevPrev;
    vi.restoreAllMocks();
  });

  function mkReq(url: string, host: string, xfHost?: string): Request {
    return { url, method: 'GET', path: url, headers: { host, ...(xfHost ? { 'x-forwarded-host': xfHost } : {}) } } as any;
  }
  function mkRes(): Response & { _c: any } {
    const res: any = {
      _c: {}, status(c: number) { this._c.status = c; return this; },
      setHeader() { return this; }, removeHeader() {}, end() {}, json(o: any) { this._c.body = o; return this; },
    };
    return res;
  }
  const next = (): NextFunction & { called: boolean } => {
    const fn: any = () => { fn.called = true; }; fn.called = false; return fn;
  };

  const deployState = {
    ...COORDS, host: '127.0.0.1', packages: [{ slug: 'web', port: 4000, kind: 'static', urlKey: 'org--user--proj--feat' }],
  };

  it('serves a request whose Host is a registered active custom domain (verbatim root)', async () => {
    const mw = createDeployProxyMiddleware({
      ensureRunning: vi.fn(async () => deployState as any),
      touchDeploy: vi.fn(async () => {}),
      updateDeploy: vi.fn(async () => {}),
      broadcastStatus: vi.fn(async () => {}),
      resolveLabel: vi.fn(async () => null),
      resolveCustomDomain: vi.fn(async (host: string) =>
        host.startsWith('app.example.com') ? { ...COORDS } : null),
    });
    const req = mkReq('/dashboard', 'ant-preview-internal:8080', 'app.example.com');
    const res = mkRes();
    const nx = next();
    await mw(req, res, nx);
    expect(nx.called).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:4000/dashboard'); // verbatim, no basePath
  });

  it('defers (next) when Host is neither a base-domain label nor a known custom domain', async () => {
    const mw = createDeployProxyMiddleware({
      ensureRunning: vi.fn(async () => deployState as any),
      touchDeploy: vi.fn(async () => {}),
      updateDeploy: vi.fn(async () => {}),
      broadcastStatus: vi.fn(async () => {}),
      resolveLabel: vi.fn(async () => null),
      resolveCustomDomain: vi.fn(async () => null),
    });
    const req = mkReq('/', 'unknown.example.org');
    const res = mkRes();
    const nx = next();
    await mw(req, res, nx);
    expect(nx.called).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
