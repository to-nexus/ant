/**
 * Kubernetes IDE resource identity — one axis, one row per case (M-NEW-002).
 *
 * The resource name was the instance key lower-cased, non-`[a-z0-9-]` replaced with
 * `-`, and truncated to 63 characters. All three steps are lossy, and the name is
 * what `stop()` / `forceReset()` hand to the Kubernetes DELETE endpoint. Two real
 * Google-verified emails differing only in where a `-` and an `@` sit collapse to
 * one name — so one account could tear down another's running IDE, and `start()`
 * could reuse its pod.
 *
 * Two properties are locked here: the name is collision-resistant, and every
 * reuse / status / delete path verifies the raw key on the resource itself rather
 * than trusting the name.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';

// The L-NEW-001 flow reaches the post-create HTTP readiness probe; nothing
// listens on the fake podIP, so stub it out (never reached by the other cases).
vi.mock('../../src/infrastructure/ide/readiness', () => ({
  waitForHttpReady: vi.fn(async () => undefined),
}));
import * as os from 'os';
import * as path from 'path';

import { KubernetesIDEOrchestrator } from '../../src/infrastructure/ide/KubernetesIDEOrchestrator';
import { createIDEKey } from '../../src/infrastructure/state/redisKeyUtils';
import type { StateStorePort } from '../../src/core/ports/stateStore';

const ANNOTATION = 'ant.example.com/instance-key';

function makeOrch() {
  const stateStore = {
    getIDE: vi.fn(async () => null),
    unregisterIDE: vi.fn(async () => undefined),
    registerIDE: vi.fn(async () => undefined),
  } as unknown as StateStorePort;
  const orch = new KubernetesIDEOrchestrator({}, stateStore);
  vi.spyOn(orch as any, 'waitForPodDeletion').mockResolvedValue(undefined);
  return orch;
}

const nameFor = (orch: any, key: string): string => orch.createResourceName(key);

describe('createResourceName — collision resistance', () => {
  const orch = makeOrch();

  it('the reported colliding email pair yields DIFFERENT names', () => {
    // `a@b-c.com` and `a-b@c.com` both sanitized to `...-a-b-c-com-...`.
    const a = nameFor(orch, 'acme:a@b-c.com:shop:main');
    const b = nameFor(orch, 'acme:a-b@c.com:shop:main');
    expect(a).not.toBe(b);
  });

  it('keys agreeing on their first 63 characters yield DIFFERENT names', () => {
    const prefix = 'acme:' + 'x'.repeat(60) + '@example.com:project:';
    expect(nameFor(orch, `${prefix}feature-one`)).not.toBe(nameFor(orch, `${prefix}feature-two`));
  });

  it('is a valid RFC 1123 name within the 63-character limit', () => {
    const name = nameFor(orch, 'acme:Someone.Else+tag@example.com:proj:feat/branch');
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
  });

  it('is stable for the same key (create/read/delete must agree)', () => {
    expect(nameFor(orch, 'acme:a@b.com:p:f')).toBe(nameFor(orch, 'acme:a@b.com:p:f'));
  });
});

describe('ownership is verified on the resource, not inferred from the name', () => {
  const VICTIM = 'acme:victim@example.com:shop:main';
  const ATTACKER = 'acme:attacker@example.com:shop:main';

  /** A cluster holding exactly one pod, under `name`, owned by `ownerKey`. */
  function clusterWithPod(orch: any, name: string, ownerKey: string | undefined, phase = 'Running') {
    return vi.spyOn(orch as any, 'k8sRequest').mockImplementation(async (path: any, method?: any) => {
      const p = String(path);
      if (p.includes(`/pods/${name}`) && (!method || method === 'GET')) {
        return {
          metadata: { name, ...(ownerKey ? { annotations: { [ANNOTATION]: ownerKey } } : {}) },
          status: { phase, podIP: '10.0.0.5' },
        };
      }
      if (p.includes('/pods/') && (!method || method === 'GET')) {
        throw new Error('404 not found');
      }
      if (p.includes('/services/') && (!method || method === 'GET')) {
        throw new Error('404 not found');
      }
      return undefined;
    });
  }

  it('start() refuses to reuse a pod whose annotation names another key', async () => {
    const orch = makeOrch();
    // The attacker's key resolves to some name; plant a foreign pod there.
    const name = nameFor(orch, ATTACKER);
    clusterWithPod(orch, name, VICTIM);

    const result = await orch.start({
      userContext: { organizationId: 'acme', userId: 'attacker@example.com' } as any,
      projectId: 'shop',
      feature: 'main',
      workspacePath: '/workspace',
    } as any);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/collision/i);
  });

  it('start() does not DELETE a pod it does not own', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, ATTACKER);
    const k8s = clusterWithPod(orch, name, VICTIM, 'Failed'); // non-Running → old code deleted

    await orch.start({
      userContext: { organizationId: 'acme', userId: 'attacker@example.com' } as any,
      projectId: 'shop',
      feature: 'main',
      workspacePath: '/workspace',
    } as any);

    const deletes = k8s.mock.calls.filter(([, method]) => method === 'DELETE');
    expect(deletes).toHaveLength(0);
  });

  it('getStatus() reports a foreign pod as absent rather than as the caller\'s', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, ATTACKER);
    clusterWithPod(orch, name, VICTIM);

    const status = await orch.getStatus('acme:attacker@example.com', 'shop', 'main');
    expect(status).toBeNull();
  });

  it('stop() refuses when the pod under the name belongs to another key', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, ATTACKER);
    const k8s = clusterWithPod(orch, name, VICTIM);

    const result = await orch.stop('acme:attacker@example.com', 'shop', 'main');

    expect(result.success).toBe(false);
    expect(k8s.mock.calls.filter(([, m]) => m === 'DELETE')).toHaveLength(0);
  });

  it('forceReset() refuses on the same basis', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, ATTACKER);
    const k8s = clusterWithPod(orch, name, VICTIM);

    const result = await orch.forceReset('acme:attacker@example.com', 'shop', 'main');

    expect(result.success).toBe(false);
    expect(k8s.mock.calls.filter(([, m]) => m === 'DELETE')).toHaveLength(0);
  });

  it('an unannotated (legacy-shaped) pod under the name is also refused', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, ATTACKER);
    clusterWithPod(orch, name, undefined);

    const result = await orch.stop('acme:attacker@example.com', 'shop', 'main');
    expect(result.success).toBe(false);
  });

  it('the owner still stops its own pod', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, VICTIM);
    const k8s = clusterWithPod(orch, name, VICTIM);

    const result = await orch.stop('acme:victim@example.com', 'shop', 'main');

    expect(result.success).toBe(true);
    const deletes = k8s.mock.calls.filter(([p, m]) => m === 'DELETE' && String(p).includes(`/pods/${name}`));
    expect(deletes).toHaveLength(1);
  });

  it('the Service is deleted alongside a verified pod', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, VICTIM);
    const k8s = clusterWithPod(orch, name, VICTIM);

    await orch.stop('acme:victim@example.com', 'shop', 'main');

    const svcDeletes = k8s.mock.calls.filter(([p, m]) => m === 'DELETE' && String(p).includes(`/services/${name}`));
    expect(svcDeletes).toHaveLength(1);
  });

  it('a Service with no verified pod and no matching annotation is left alone', async () => {
    const orch = makeOrch();
    const name = nameFor(orch, VICTIM);
    const k8s = vi.spyOn(orch as any, 'k8sRequest').mockImplementation(async (path: any, method?: any) => {
      const p = String(path);
      if (p.includes('/pods/') && (!method || method === 'GET')) throw new Error('404 not found');
      if (p.includes(`/services/${name}`) && (!method || method === 'GET')) {
        return { metadata: { name, annotations: { [ANNOTATION]: 'someone:else:proj:feat' } } };
      }
      return undefined;
    });

    await orch.stop('acme:victim@example.com', 'shop', 'main');

    const svcDeletes = k8s.mock.calls.filter(([p, m]) => m === 'DELETE' && String(p).includes('/services/'));
    expect(svcDeletes).toHaveLength(0);
  });
});

/**
 * L-NEW-001 residual — the reuse path used to return BEFORE ever reading the
 * Service, so a legacy pod (no digest label) kept its Service pinned on the
 * lossy `instance` selector forever. Now `needsRecreate` treats the missing
 * digest label as spec drift: the legacy pod is deleted, the fresh create's
 * Service POST answers 409, and `convergeServiceSelector` replaces the lossy
 * selector with the digest.
 */
describe('legacy pod reuse converges the Service selector (L-NEW-001)', () => {
  // Base (featureless) pod — needs no worktree mounts, so the fresh create
  // succeeds against a plain workspace path.
  const KEY = createIDEKey('acme', 'victim@example.com', 'shop');

  it('a running pod without the digest label is recreated and its Service converged', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'ant-l-new-001-'));
    const workspacePath = path.join(base, 'acme', 'victim', 'shop', 'codebase');
    mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
    const originalBase = process.env.ANT_WORKSPACE_BASE_PATH;
    process.env.ANT_WORKSPACE_BASE_PATH = base;
    try {
      const orch = makeOrch();
      vi.spyOn(orch as any, 'waitForPodReady').mockResolvedValue(undefined);
      const name = nameFor(orch, KEY);

      let podDeleted = false;
      let serviceDeleted = false;
      const servicePosts: any[] = [];
      vi.spyOn(orch as any, 'k8sRequest').mockImplementation(
        async (reqPath: any, method?: any, body?: any) => {
          const p = String(reqPath);
          const m = method ?? 'GET';
          if (p.includes(`/pods/${name}`) && m === 'GET') {
            return {
              metadata: {
                name,
                annotations: { [ANNOTATION]: KEY },
                labels: { app: 'ant-ide', instance: 'lossy-legacy' }, // predates the digest label
              },
              status: { phase: 'Running', podIP: '10.0.0.9' },
              spec: {
                containers: [{
                  volumeMounts: [{ name: 'workspace', mountPath: '/w', subPath: 's' }],
                  readinessProbe: { httpGet: { path: '/', port: 3000 } },
                }],
              },
            };
          }
          if (p.includes(`/pods/${name}`) && m === 'DELETE') { podDeleted = true; return undefined; }
          if (p.endsWith('/pods') && m === 'POST') return undefined;
          if (p.endsWith('/services') && m === 'POST') {
            if (!serviceDeleted) throw new Error('409 conflict'); // legacy Service still present
            servicePosts.push(body);
            return undefined;
          }
          if (p.includes(`/services/${name}`) && m === 'GET') {
            return {
              metadata: { name, annotations: { [ANNOTATION]: KEY } },
              spec: { selector: { app: 'ant-ide', instance: 'lossy-legacy' } },
            };
          }
          if (p.includes(`/services/${name}`) && m === 'DELETE') { serviceDeleted = true; return undefined; }
          return undefined;
        },
      );

      const result = await orch.start({
        userContext: { organizationId: 'acme', userId: 'victim@example.com' } as any,
        projectId: 'shop',
        workspacePath,
      } as any);

      expect(result.success).toBe(true);
      expect(podDeleted).toBe(true);
      expect(serviceDeleted).toBe(true);
      expect(servicePosts).toHaveLength(1);
      expect(servicePosts[0].spec.selector['ant-instance-digest']).toBe(name);
      expect(servicePosts[0].spec.selector.instance).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
      if (originalBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
      else process.env.ANT_WORKSPACE_BASE_PATH = originalBase;
    }
  });
});

describe('pre-rename resources are reclaimed only on an exact key match', () => {
  const KEY = 'acme:victim@example.com:shop:main';

  it('deletes a legacy-named pod that carries our exact key', async () => {
    const orch = makeOrch();
    const legacy = (orch as any).legacyResourceName(KEY);
    const current = nameFor(orch, KEY);
    expect(legacy).not.toBe(current);

    const k8s = vi.spyOn(orch as any, 'k8sRequest').mockImplementation(async (path: any, method?: any) => {
      const p = String(path);
      if (p.includes(`/pods/${legacy}`) && (!method || method === 'GET')) {
        return { metadata: { name: legacy, annotations: { [ANNOTATION]: KEY } }, status: { phase: 'Running' } };
      }
      if (p.includes('/pods/') && (!method || method === 'GET')) throw new Error('404 not found');
      if (p.includes('/services/') && (!method || method === 'GET')) throw new Error('404 not found');
      return undefined;
    });

    await orch.stop('acme:victim@example.com', 'shop', 'main');

    const legacyDeletes = k8s.mock.calls.filter(([p, m]) => m === 'DELETE' && String(p).includes(`/pods/${legacy}`));
    expect(legacyDeletes).toHaveLength(1);
  });

  it('leaves a legacy-named pod belonging to a different key alone', async () => {
    const orch = makeOrch();
    const legacy = (orch as any).legacyResourceName(KEY);

    const k8s = vi.spyOn(orch as any, 'k8sRequest').mockImplementation(async (path: any, method?: any) => {
      const p = String(path);
      if (p.includes(`/pods/${legacy}`) && (!method || method === 'GET')) {
        return { metadata: { name: legacy, annotations: { [ANNOTATION]: 'other:key:p:f' } }, status: { phase: 'Running' } };
      }
      if (p.includes('/pods/') && (!method || method === 'GET')) throw new Error('404 not found');
      if (p.includes('/services/') && (!method || method === 'GET')) throw new Error('404 not found');
      return undefined;
    });

    await orch.stop('acme:victim@example.com', 'shop', 'main');

    const legacyDeletes = k8s.mock.calls.filter(([p, m]) => m === 'DELETE' && String(p).includes(`/pods/${legacy}`));
    expect(legacyDeletes).toHaveLength(0);
  });
});
