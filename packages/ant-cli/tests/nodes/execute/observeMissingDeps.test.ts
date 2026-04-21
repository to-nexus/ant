/**
 * observeMissingDepsForTask — task-type gate coverage.
 *
 * Guards the behavioural contract that activates the `missing-dependency-fix`
 * injection via `hasMissingDependency`. A task that declares or relies on
 * deps owns the install within the same cycle. Verification / error own the
 * signal through `Session.dependencyStatus()` and must not double-inject;
 * doc / explain do not install.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/agents/common/tool/handlers/invalidationScope', () => ({
  areDepsInstalled: vi.fn(),
}));

import { observeMissingDepsForTask } from '../../../src/agents/architect/graph/code/nodes/execute/buildMessages';
import { areDepsInstalled } from '../../../src/agents/common/tool/handlers/invalidationScope';
import type { TaskType } from '@ant/shared';

function buildState(taskType: TaskType | undefined, installed: boolean | null): any {
  (areDepsInstalled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(installed);
  return {
    currentTask: taskType ? { type: taskType } : undefined,
    deps: {
      fileSystem: {
        getRootPath: () => '/tmp/fake-feature-root',
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('observeMissingDepsForTask — active task types (missing deps ⇒ true)', () => {
  const activeTypes: TaskType[] = ['setup', 'feature', 'design-system', 'ui', 'test-code'];

  for (const type of activeTypes) {
    it(`${type}: returns true when deps are not installed`, async () => {
      const state = buildState(type, false);
      expect(await observeMissingDepsForTask(state)).toBe(true);
      expect(areDepsInstalled).toHaveBeenCalledOnce();
    });

    it(`${type}: returns false when deps are installed`, async () => {
      const state = buildState(type, true);
      expect(await observeMissingDepsForTask(state)).toBe(false);
    });

    it(`${type}: returns false when observation is null (non-JS project)`, async () => {
      const state = buildState(type, null);
      expect(await observeMissingDepsForTask(state)).toBe(false);
    });
  }
});

describe('observeMissingDepsForTask — excluded task types (never observe)', () => {
  const excludedTypes: TaskType[] = ['verification', 'error', 'doc', 'explain'];

  for (const type of excludedTypes) {
    it(`${type}: returns false without touching areDepsInstalled (SSOT/scope protection)`, async () => {
      (areDepsInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const state: any = {
        currentTask: { type },
        deps: { fileSystem: { getRootPath: () => '/tmp/fake' } },
      };
      expect(await observeMissingDepsForTask(state)).toBe(false);
      expect(areDepsInstalled).not.toHaveBeenCalled();
    });
  }
});

describe('observeMissingDepsForTask — edge cases', () => {
  it('returns false when currentTask is missing', async () => {
    (areDepsInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const state: any = { deps: { fileSystem: { getRootPath: () => '/tmp/fake' } } };
    expect(await observeMissingDepsForTask(state)).toBe(false);
    expect(areDepsInstalled).not.toHaveBeenCalled();
  });

  it('returns false when fileSystem root is unavailable', async () => {
    (areDepsInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const state: any = { currentTask: { type: 'setup' }, deps: {} };
    expect(await observeMissingDepsForTask(state)).toBe(false);
    expect(areDepsInstalled).not.toHaveBeenCalled();
  });

  it('returns false when areDepsInstalled throws (observation failed)', async () => {
    (areDepsInstalled as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fs error'));
    const state: any = {
      currentTask: { type: 'setup' },
      deps: { fileSystem: { getRootPath: () => '/tmp/fake' } },
    };
    expect(await observeMissingDepsForTask(state)).toBe(false);
  });
});
