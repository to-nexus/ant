/**
 * observeMissingDepsForTask — task-type gate coverage.
 *
 * Guards the behavioural contract that activates the `missing-dependency-fix`
 * injection via `hasMissingDependency`. Every code-writing task that can
 * edit `package.json` (or rely on it being installed) must own the install
 * within the same execute cycle — this includes `verification` and `error`,
 * whose plan phase may emit `modify: package.json` entries. The prior
 * exclusion relied on the plan-phase `Session.dependencyStatus()` reaching
 * the execute prompt, but that status lands in the plan template only; the
 * actual `edit_file(package.json)` happens in execute without the install
 * directive. Only `doc` / `explain` remain excluded — they do not install.
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
  const activeTypes: TaskType[] = [
    'setup',
    'feature',
    'design-system',
    'ui',
    'test-code',
    'verification',
    'error',
  ];

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
  const excludedTypes: TaskType[] = ['doc', 'explain'];

  for (const type of excludedTypes) {
    it(`${type}: returns false without touching areDepsInstalled (doc / explain cannot install)`, async () => {
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
