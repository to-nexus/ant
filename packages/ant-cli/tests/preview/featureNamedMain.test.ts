/**
 * A feature literally named `main` is an ordinary feature.
 *
 * Regression: preview and deploy both treated the string `'main'` as a
 * "no feature" sentinel left over from the pre-anchor layout, where a project
 * owned a `{project}/codebase` main worktree. Under the bare-anchor model that
 * directory is gone — every codebase is `features/{slug}/codebase` and branch
 * == feature name — while `CloneOperation` names the auto-created base feature
 * after the remote HEAD branch, i.e. `main` for most repos. The sentinel
 * therefore misfired on the modal path: preview resolved to a nonexistent
 * directory ("No recognized project files found", from the detector's
 * existsSync guard rather than from detection) and every deploy route 400'd.
 *
 * The static half of this invariant — no `'main'` literal, no hand-assembled
 * feature path — lives in `tests/policy/feature-main-sentinel.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { DeployService } from '../../src/infrastructure/deploy/DeployService';

const BASE = '/tmp/ant-test-workspaces';
const CTX = { organizationId: 'org', userId: 'user' };

describe('workspace path resolution for a feature named `main`', () => {
  const resolver = new UnifiedWorkspaceResolver(BASE);

  it('resolves to the feature worktree, not a project-level codebase', () => {
    expect(resolver.getCodebasePath(CTX, 'proj', 'main')).toBe(
      path.join(BASE, 'org', 'user', 'proj', 'features', 'main', 'codebase'),
    );
  });

  it('treats it identically to any other feature name', () => {
    const asMain = resolver.getCodebasePath(CTX, 'proj', 'main');
    const asOther = resolver.getCodebasePath(CTX, 'proj', 'neo-brutalist');
    expect(path.dirname(path.dirname(asMain))).toBe(path.dirname(path.dirname(asOther)));
    expect(asOther).toBe(
      path.join(BASE, 'org', 'user', 'proj', 'features', 'neo-brutalist', 'codebase'),
    );
  });

  it('still slugs a `/` in the name', () => {
    expect(resolver.getCodebasePath(CTX, 'proj', 'release/1.0')).toBe(
      path.join(BASE, 'org', 'user', 'proj', 'features', 'release~1.0', 'codebase'),
    );
  });
});

describe('DeployService.startDeploy on a feature named `main`', () => {
  function makeService() {
    const stateStore: any = {
      listJobsByFeature: vi.fn(async () => []),
      acquireLock: vi.fn(async () => true),
      releaseLock: vi.fn(async () => {}),
      getDeploy: vi.fn(async () => null),
    };
    return new DeployService({ portManager: {} as any, stateStore, workspacesPath: BASE });
  }

  it('is not rejected as featureless', async () => {
    const svc = makeService();
    // A path that does not exist — the deploy fails later, at the workspace
    // snapshot. Reaching that stage is the point: the feature guard let it
    // through instead of short-circuiting on the name.
    const missing = path.join(os.tmpdir(), 'ant-test-absent-codebase');
    fs.rmSync(missing, { recursive: true, force: true });

    const result = await svc.startDeploy('org', 'user', 'proj', 'main', missing);

    expect(result.success).toBe(false);
    expect(result.reason).not.toBe('feature-required');
    expect(result.reason).toBe('workspace-sync-failed');
  });

  it('still rejects a genuinely absent feature', async () => {
    const svc = makeService();
    const result = await svc.startDeploy('org', 'user', 'proj', '', '/tmp/whatever');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('feature-required');
  });
});
