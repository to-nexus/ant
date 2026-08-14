/**
 * Phase 1 regression — `createPodSpec` topology invariants.
 *
 * Locks the K8s pod spec produced by `KubernetesIDEOrchestrator.createPodSpec`:
 *   - workspace mount keeps the alias `/workspace` mountPath
 *   - container.workingDir === '/workspace' (mirrors Docker's WorkingDir)
 *   - ANT_WORKSPACE env === '/workspace' (alias-consistent)
 *   - feature worktree pod has 3 distinct volumeMounts (alias + mainGitDir + worktreePath)
 *   - defensive `NO_FEATURE_KEY` ('@none') pod has exactly 1 volumeMount (alias)
 *     — routes require a feature, so this path exists only as a parser fallback
 *   - WORKSPACE_BASE_PATH mismatch -> throw at spec creation time
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { KubernetesIDEOrchestrator } from '../../src/infrastructure/ide/KubernetesIDEOrchestrator';
import { NO_FEATURE_KEY } from '../../src/infrastructure/state/redisKeyUtils';
import type { StateStorePort } from '../../src/core/ports/stateStore';

interface PodSpecFixture {
  base: string;
  projectDir: string;
  mainCodebase: string;
  mainGitDir: string;
  featureCodebase: string;
}

function makePodSpecFixture(): PodSpecFixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-podspec-'));
  const projectDir = path.join(base, 'org', 'user', 'proj');
  const mainCodebase = path.join(projectDir, 'codebase');
  const mainGitDir = path.join(mainCodebase, '.git');
  const featureCodebase = path.join(projectDir, 'features', 'feat-x', 'codebase');
  mkdirSync(mainCodebase, { recursive: true });
  mkdirSync(mainGitDir, { recursive: true });
  mkdirSync(path.join(mainGitDir, 'worktrees', 'feat-x'), { recursive: true });
  mkdirSync(featureCodebase, { recursive: true });
  return { base, projectDir, mainCodebase, mainGitDir, featureCodebase };
}

/** Write the worktree `.git` marker so `resolveK8sWorktreeMounts` resolves. */
function writeWorktreeMarker(fx: PodSpecFixture): void {
  const gitFile = path.join(fx.featureCodebase, '.git');
  const gitdirAbs = path.join(fx.mainGitDir, 'worktrees', 'feat-x');
  writeFileSync(gitFile, `gitdir: ${gitdirAbs}\n`, 'utf-8');
}

const stubStateStore = {} as unknown as StateStorePort;

function makeOrch(): KubernetesIDEOrchestrator {
  return new KubernetesIDEOrchestrator({}, stubStateStore);
}

const userContext = { userId: 'user', organizationId: 'org', email: 'u@example.com' } as any;

describe('KubernetesIDEOrchestrator.createPodSpec', () => {
  let fx: PodSpecFixture;
  let originalBase: string | undefined;

  beforeEach(() => {
    fx = makePodSpecFixture();
    originalBase = process.env.ANT_WORKSPACE_BASE_PATH;
    process.env.ANT_WORKSPACE_BASE_PATH = fx.base;
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
    if (originalBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = originalBase;
  });

  it('defensive NO_FEATURE_KEY pod has exactly one alias mount + workingDir/env consistent', () => {
    const orch = makeOrch();
    // `WORKSPACE_BASE_PATH` is captured at module load — invoke private via cast
    // and pass workspacePath under the same module-load base. Tests bind the
    // env BEFORE first orchestrator usage in this file via beforeEach.
    const spec = (orch as any).createPodSpec(
      `org:user:proj:${NO_FEATURE_KEY}`,
      'ide-org-user-proj-none',
      fx.mainCodebase,
      userContext,
      NO_FEATURE_KEY,
    );

    const container = spec.spec.containers[0];
    expect(container.workingDir).toBe('/workspace');
    expect(container.env).toContainEqual({ name: 'ANT_WORKSPACE', value: '/workspace' });
    expect(container.volumeMounts).toHaveLength(1);
    expect(container.volumeMounts[0].mountPath).toBe('/workspace');
  });

  it('feature worktree pod has 3 distinct volumeMounts (alias + mainGitDir + worktreePath)', () => {
    writeWorktreeMarker(fx);

    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      'org:user:proj:feat-x',
      'ide-org-user-proj-feat-x',
      fx.featureCodebase,
      userContext,
      'feat-x',
    );

    const container = spec.spec.containers[0];
    expect(container.workingDir).toBe('/workspace');
    expect(container.volumeMounts).toHaveLength(3);
    const mountPaths = container.volumeMounts.map((m: any) => m.mountPath);
    expect(new Set(mountPaths).size).toBe(3);
    expect(mountPaths).toContain('/workspace');
    expect(mountPaths).toContain(fx.mainGitDir);
    expect(mountPaths).toContain(fx.featureCodebase);
  });

  it('throws when workspacePath is outside ANT_WORKSPACE_BASE_PATH (silent broken pod prevention)', () => {
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'ant-outside-'));
    mkdirSync(path.join(outsideDir, '.git'), { recursive: true });

    const orch = makeOrch();
    expect(() =>
      (orch as any).createPodSpec(
        `org:user:proj:${NO_FEATURE_KEY}`,
        'ide-org-user-proj-none',
        path.join(outsideDir),
        userContext,
        NO_FEATURE_KEY,
      ),
    ).toThrow(/outside ANT_WORKSPACE_BASE_PATH/);

    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('FAIL-FAST: feature pod with no worktree mounts (missing .git marker) throws — silent broken pod prevention', () => {
    // Feature codebase exists but no .git marker → resolveK8sWorktreeMounts
    // returns []. Without the fail-fast, the pod would be created with only
    // the alias mount and the user would see "Initialize Repository" forever.
    const orch = makeOrch();
    expect(() =>
      (orch as any).createPodSpec(
        'org:user:proj:feat-x',
        'ide-org-user-proj-feat-x',
        fx.featureCodebase,
        userContext,
        'feat-x',
      ),
    ).toThrow(/requires worktree mounts but resolveK8sWorktreeMounts returned/);
  });

  it('FAIL-FAST: defensive NO_FEATURE_KEY pod with no worktree mounts is allowed (always 1-mount)', () => {
    // NO_FEATURE_KEY is the defensive parser fallback — `.git` here is a plain
    // directory, no worktree marker. resolveK8sWorktreeMounts returns [] which
    // is correct for this path (routes reject missing features upstream).
    const orch = makeOrch();
    expect(() =>
      (orch as any).createPodSpec(
        `org:user:proj:${NO_FEATURE_KEY}`,
        'ide-org-user-proj-none',
        fx.mainCodebase,
        userContext,
        NO_FEATURE_KEY,
      ),
    ).not.toThrow();
  });

  it('hasMountDrift returns true when existing pod has no readinessProbe (post-rollout migration)', () => {
    const orch = makeOrch();
    // Existing pod with the correct mount count but pre-rollout — no readinessProbe.
    const podWithoutProbe = {
      metadata: { name: 'p', namespace: 'ns', labels: {} },
      spec: {
        containers: [{
          name: 'c',
          image: 'i',
          ports: [{ containerPort: 3000 }],
          volumeMounts: [{ name: 'workspace', mountPath: '/workspace', subPath: 'x' }],
        }],
      },
    } as any;
    const drift = (orch as any).hasMountDrift(podWithoutProbe, fx.mainCodebase, NO_FEATURE_KEY);
    expect(drift).toBe(true);
  });

  it('hasMountDrift returns false when readinessProbe is present and mounts match', () => {
    const orch = makeOrch();
    const podWithProbe = {
      metadata: { name: 'p', namespace: 'ns', labels: {} },
      spec: {
        containers: [{
          name: 'c',
          image: 'i',
          ports: [{ containerPort: 3000 }],
          volumeMounts: [{ name: 'workspace', mountPath: '/workspace', subPath: 'x' }],
          readinessProbe: { httpGet: { path: '/ide/x/', port: 3000 } },
        }],
      },
    } as any;
    const drift = (orch as any).hasMountDrift(podWithProbe, fx.mainCodebase, NO_FEATURE_KEY);
    expect(drift).toBe(false);
  });

  it('pod is hardened: no SA token, non-root pod + container securityContext, caps dropped (O8/O12)', () => {
    writeWorktreeMarker(fx);
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      'org:user:proj:feat-x',
      'ide-org-user-proj-feat-x',
      fx.featureCodebase,
      userContext,
      'feat-x',
    );

    // O12 — SA token never mounted into the IDE container.
    expect(spec.spec.automountServiceAccountToken).toBe(false);

    // O8 — pod-level non-root identity.
    expect(spec.spec.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 1000,
    });

    // O8 — container-level: no privilege escalation, all caps dropped.
    const container = spec.spec.containers[0];
    expect(container.securityContext).toMatchObject({
      runAsNonRoot: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
    });
  });

  it('readinessProbe gates Service Endpoints on openvscode-server HTTP, not just phase=Running', () => {
    writeWorktreeMarker(fx);
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      'org:user:proj:feat-x',
      'ide-org-user-proj-feat-x',
      fx.featureCodebase,
      userContext,
      'feat-x',
    );

    const container = spec.spec.containers[0];
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.httpGet).toBeDefined();
    expect(container.readinessProbe.httpGet.path).toBe('/ide/org:user:proj:feat-x/');
    expect(container.readinessProbe.httpGet.port).toBe(3000);
    // failureThreshold * periodSeconds = ~60s grace for cold pulls
    expect(container.readinessProbe.failureThreshold).toBeGreaterThanOrEqual(30);
  });
});

/**
 * Regression — K8s label values must be RFC-1123-valid even when cloud
 * `userId` is a full email (`probe@to.nexus`). The `@` previously leaked
 * raw into `metadata.labels` and the `listByUser` selector, producing a
 * K8s 422 at pod creation. See `individual-ide-snuggly-naur` plan.
 */
describe('KubernetesIDEOrchestrator — label value sanitization (email userId)', () => {
  const K8S_LABEL_RE = /^[a-z0-9]([-a-z0-9_.]*[a-z0-9])?$/;

  let fx: PodSpecFixture;
  let originalBase: string | undefined;

  beforeEach(() => {
    fx = makePodSpecFixture();
    originalBase = process.env.ANT_WORKSPACE_BASE_PATH;
    process.env.ANT_WORKSPACE_BASE_PATH = fx.base;
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
    if (originalBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = originalBase;
  });

  const emailUser = { userId: 'probe@to.nexus', organizationId: 'individual', email: 'probe@to.nexus' } as any;
  const emailInstanceKey = 'individual:probe@to.nexus:classboard:feat-x';

  it('pod labels (user, instance) are K8s-valid and <=63 chars with an email userId', () => {
    writeWorktreeMarker(fx);
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      emailInstanceKey,
      'ide-individual-probe-to-nexus-classboard-feat-x',
      fx.featureCodebase,
      emailUser,
      'feat-x',
    );

    const labels = spec.metadata.labels;
    for (const key of ['user', 'instance'] as const) {
      expect(labels[key], `label ${key}`).toMatch(K8S_LABEL_RE);
      expect(labels[key].length, `label ${key} length`).toBeLessThanOrEqual(63);
      expect(labels[key]).not.toContain('@');
    }
    expect(labels.user).toBe('probe-to.nexus');
  });

  it('service selector matches the pod instance label exactly (routing consistency)', () => {
    writeWorktreeMarker(fx);
    const orch = makeOrch();
    const podSpec = (orch as any).createPodSpec(
      emailInstanceKey,
      'ide-individual-probe-to-nexus-classboard-feat-x',
      fx.featureCodebase,
      emailUser,
      'feat-x',
    );
    const serviceSpec = (orch as any).createServiceSpec
      ? (orch as any).createServiceSpec(emailInstanceKey, 'ide-individual-probe-to-nexus-classboard-feat-x')
      : null;

    // `instance` value goes through the same sanitizer in both pod label and
    // service selector — assert against the sanitizer output directly.
    const sanitized = (orch as any).sanitizeLabelValue(emailInstanceKey);
    expect(podSpec.metadata.labels.instance).toBe(sanitized);
    expect(sanitized).toMatch(K8S_LABEL_RE);
    if (serviceSpec) {
      expect(serviceSpec.spec.selector.instance).toBe(sanitized);
      expect(serviceSpec.metadata.labels.instance).toBe(sanitized);
    }
  });

  it('listByUser selector encodes the sanitized user value (matches the pod user label)', () => {
    writeWorktreeMarker(fx);
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      emailInstanceKey,
      'ide-individual-probe-to-nexus-classboard-feat-x',
      fx.featureCodebase,
      emailUser,
      'feat-x',
    );
    // The selector built in `listByUser` uses sanitizeLabelValue(userId); it
    // must equal the pod's `user` label or the lookup silently returns nothing.
    const selectorUserValue = (orch as any).sanitizeLabelValue(emailUser.userId);
    expect(spec.metadata.labels.user).toBe(selectorUserValue);
  });
});

/**
 * M-016 — the `user=` label selector is lossy (`sanitizeLabelValue` maps
 * `a@b-c.com` and `a-b@c.com` onto one value), so it can only narrow the
 * candidate set. Ownership is decided on the parsed instance key.
 */
describe('KubernetesIDEOrchestrator.listByUser authorization', () => {
  const caller = { userId: 'alice@corp.com', organizationId: 'acme' } as any;

  const pod = (name: string, instanceKey: string | null) => ({
    metadata: {
      name,
      annotations: instanceKey ? { 'ant.example.com/instance-key': instanceKey } : {},
    },
    status: { phase: 'Running', podIP: '10.0.0.9' },
  });

  const listWith = async (items: unknown[]) => {
    const orch = makeOrch();
    (orch as any).k8sRequest = async () => ({ items });
    return orch.listByUser(caller);
  };

  it('the sanitizer really does collide two distinct valid emails', () => {
    const orch = makeOrch();
    expect((orch as any).sanitizeLabelValue('alice@corp.com')).toBe(
      (orch as any).sanitizeLabelValue('alice-corp.com'),
    );
  });

  it('returns the caller own instance', async () => {
    const found = await listWith([pod('p1', 'acme:alice@corp.com:proj:feat-x')]);
    expect(found).toHaveLength(1);
    expect(found[0].tenantId).toBe('acme');
    expect(found[0].userId).toBe('alice@corp.com');
  });

  it('drops a colliding pod owned by another user', async () => {
    const found = await listWith([
      pod('p1', 'acme:alice@corp.com:proj:feat-x'),
      pod('p2', 'acme:alice-corp.com:victim-proj:feat-y'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].instanceId).toBe('p1');
  });

  it('drops a pod of the same user name in another organization', async () => {
    const found = await listWith([pod('p2', 'other-org:alice@corp.com:proj:feat-x')]);
    expect(found).toEqual([]);
  });

  it('skips a malformed key instead of claiming it for the caller', async () => {
    // The old fallback published this pod's host/port/workspacePath stamped
    // with the requester identity.
    const found = await listWith([pod('p3', null), pod('p4', 'not:enough')]);
    expect(found).toEqual([]);
  });
});
