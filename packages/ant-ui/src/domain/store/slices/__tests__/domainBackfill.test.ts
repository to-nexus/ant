/**
 * Phase 2 (D22) — disk SSOT backfill on project entry.
 *
 * When `config.json` lacks an explicit `domain` field (legacy projects,
 * or projects whose creation flow predated the explicit-default policy),
 * the mirror inside `projectConfigSlice.fetchProjectConfig` must:
 *
 *   1. Set the actionMetadata.domain to 'service' (no-op when already
 *      'service' from the store default seed).
 *   2. PUT `domain: 'service'` back to the BE so subsequent fetches see
 *      the explicit field and the mirror's normal branch turns into a
 *      no-op (idempotent).
 *
 * Without (2) the disk SSOT stays empty forever — the system happens to
 * behave because every code path defaults to 'service', but the
 * "WorkspaceConfig.domain is the SSOT" invariant is silently broken.
 *
 * The companion `domainTransition.test.ts > backfills disk SSOT...` test
 * exercises the same contract one layer below (calling
 * `updateActionMetadata` directly). This file verifies the
 * `projectConfigSlice` plumbing wires up to that contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createUISlice, type UISlice } from '../uiSlice';
import { createResetSlice, type ResetSlice } from '../resetSlice';
import { createProjectConfigSlice, type ProjectConfigSlice } from '../projectConfigSlice';
import type { ProjectConfig } from '@/infrastructure/http/api';

const { fetchProjectConfigMock, updateProjectConfigMock, createProjectConfigMock } = vi.hoisted(
  () => ({
    fetchProjectConfigMock: vi.fn(),
    updateProjectConfigMock: vi.fn(),
    createProjectConfigMock: vi.fn(),
  }),
);

vi.mock('@/infrastructure/http/api', () => ({
  fetchProjectConfig: fetchProjectConfigMock,
  updateProjectConfig: updateProjectConfigMock,
  createProjectConfig: createProjectConfigMock,
}));

beforeEach(() => {
  fetchProjectConfigMock.mockReset();
  updateProjectConfigMock.mockReset();
  createProjectConfigMock.mockReset();
  updateProjectConfigMock.mockResolvedValue(undefined);
});

type TestStore = UISlice & ResetSlice & ProjectConfigSlice & {
  selectedProject?: string;
};

function makeStore(selectedProject?: string) {
  return create<TestStore>()((...args) => ({
    ...createUISlice(...args),
    ...createResetSlice(...args),
    ...createProjectConfigSlice(...args),
    selectedProject,
  }));
}

describe('projectConfigSlice — domain backfill on project entry', () => {
  it('PUTs domain:"service" when fetched cfg has no domain field', async () => {
    const cfg: ProjectConfig = {
      repositoryName: 'proj-a',
      repoType: 'local',
      // domain intentionally absent
    };
    fetchProjectConfigMock.mockResolvedValue(cfg);

    const store = makeStore('proj-a');
    await store.getState().fetchProjectConfig('proj-a');

    expect(updateProjectConfigMock).toHaveBeenCalledTimes(1);
    expect(updateProjectConfigMock).toHaveBeenCalledWith('proj-a', {
      repositoryName: 'proj-a',
      repoType: 'local',
      domain: 'service',
    });
    expect(store.getState().actionMetadata.domain).toBe('service');
  });

  it('does NOT echo PUT when fetched cfg.domain is already "service"', async () => {
    const cfg: ProjectConfig = {
      repositoryName: 'proj-a',
      repoType: 'local',
      domain: 'service',
    };
    fetchProjectConfigMock.mockResolvedValue(cfg);

    const store = makeStore('proj-a');
    await store.getState().fetchProjectConfig('proj-a');

    expect(updateProjectConfigMock).not.toHaveBeenCalled();
    expect(store.getState().actionMetadata.domain).toBe('service');
  });

  it('mirrors fetched cfg.domain="game" into actionMetadata without echo PUT', async () => {
    const cfg: ProjectConfig = {
      repositoryName: 'proj-a',
      repoType: 'local',
      domain: 'game',
    };
    fetchProjectConfigMock.mockResolvedValue(cfg);

    const store = makeStore('proj-a');
    await store.getState().fetchProjectConfig('proj-a');

    expect(updateProjectConfigMock).not.toHaveBeenCalled();
    expect(store.getState().actionMetadata.domain).toBe('game');
  });

  it('does not PUT when fetch returns null (project has no config)', async () => {
    fetchProjectConfigMock.mockResolvedValue(null);

    const store = makeStore('proj-a');
    await store.getState().fetchProjectConfig('proj-a');

    expect(updateProjectConfigMock).not.toHaveBeenCalled();
  });
});
