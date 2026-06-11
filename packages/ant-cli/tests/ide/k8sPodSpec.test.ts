/**
 * Phase 1 regression — `createPodSpec` topology invariants.
 *
 * Locks the K8s pod spec produced by `KubernetesIDEOrchestrator.createPodSpec`:
 *   - workspace mount keeps the alias `/workspace` mountPath
 *   - container.workingDir === '/workspace' (mirrors Docker's WorkingDir)
 *   - ANT_WORKSPACE env === '/workspace' (alias-consistent)
 *   - feature worktree pod has 3 distinct volumeMounts (alias + mainGitDir + worktreePath)
 *   - base branch pod has exactly 1 volumeMount (alias)
 *   - WORKSPACE_BASE_PATH mismatch -> throw at spec creation time
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { KubernetesIDEOrchestrator } from '../../src/infrastructure/ide/KubernetesIDEOrchestrator';
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

  it('base branch pod has exactly one alias mount + workingDir/env consistent', () => {
    const orch = makeOrch();
    // `WORKSPACE_BASE_PATH` is captured at module load — invoke private via cast
    // and pass workspacePath under the same module-load base. Tests bind the
    // env BEFORE first orchestrator usage in this file via beforeEach.
    const spec = (orch as any).createPodSpec(
      'org:user:proj:_base',
      'ide-org-user-proj-base',
      fx.mainCodebase,
      userContext,
      '_base',
    );

    const container = spec.spec.containers[0];
    expect(container.workingDir).toBe('/workspace');
    expect(container.env).toContainEqual({ name: 'ANT_WORKSPACE', value: '/workspace' });
    expect(container.volumeMounts).toHaveLength(1);
    expect(container.volumeMounts[0].mountPath).toBe('/workspace');
  });

  it('feature worktree pod has 3 distinct volumeMounts (alias + mainGitDir + worktreePath)', () => {
    const gitFile = path.join(fx.featureCodebase, '.git');
    const gitdirAbs = path.join(fx.mainGitDir, 'worktrees', 'feat-x');
    writeFileSync(gitFile, `gitdir: ${gitdirAbs}\n`, 'utf-8');

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
        'org:user:proj:_base',
        'ide-org-user-proj-base',
        path.join(outsideDir),
        userContext,
        '_base',
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

  it('FAIL-FAST: base pod with no worktree mounts is allowed (always 1-mount)', () => {
    // _base feature is special — main repo `.git` is a directory, no worktree
    // marker. resolveK8sWorktreeMounts returns [] which is correct here.
    const orch = makeOrch();
    expect(() =>
      (orch as any).createPodSpec(
        'org:user:proj:_base',
        'ide-org-user-proj-base',
        fx.mainCodebase,
        userContext,
        '_base',
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
    const drift = (orch as any).hasMountDrift(podWithoutProbe, fx.mainCodebase, '_base');
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
    const drift = (orch as any).hasMountDrift(podWithProbe, fx.mainCodebase, '_base');
    expect(drift).toBe(false);
  });

  it('readinessProbe gates Service Endpoints on openvscode-server HTTP, not just phase=Running', () => {
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      'org:user:proj:_base',
      'ide-org-user-proj-base',
      fx.mainCodebase,
      userContext,
      '_base',
    );

    const container = spec.spec.containers[0];
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.httpGet).toBeDefined();
    expect(container.readinessProbe.httpGet.path).toBe('/ide/org:user:proj:_base/');
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
  const emailInstanceKey = 'individual:probe@to.nexus:classboard:_base';

  it('pod labels (user, instance) are K8s-valid and <=63 chars with an email userId', () => {
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      emailInstanceKey,
      'ide-individual-probe-to-nexus-classboard-base',
      fx.mainCodebase,
      emailUser,
      '_base',
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
    const orch = makeOrch();
    const podSpec = (orch as any).createPodSpec(
      emailInstanceKey,
      'ide-individual-probe-to-nexus-classboard-base',
      fx.mainCodebase,
      emailUser,
      '_base',
    );
    const serviceSpec = (orch as any).createServiceSpec
      ? (orch as any).createServiceSpec(emailInstanceKey, 'ide-individual-probe-to-nexus-classboard-base')
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
    const orch = makeOrch();
    const spec = (orch as any).createPodSpec(
      emailInstanceKey,
      'ide-individual-probe-to-nexus-classboard-base',
      fx.mainCodebase,
      emailUser,
      '_base',
    );
    // The selector built in `listByUser` uses sanitizeLabelValue(userId); it
    // must equal the pod's `user` label or the lookup silently returns nothing.
    const selectorUserValue = (orch as any).sanitizeLabelValue(emailUser.userId);
    expect(spec.metadata.labels.user).toBe(selectorUserValue);
  });
});
