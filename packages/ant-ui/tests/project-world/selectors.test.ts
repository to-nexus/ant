/**
 * project-world selector tests.
 *
 * Verifies the sanctioned selectors over `ProjectSnapshot` — callers
 * rely on these helpers to avoid reaching through arbitrary slice keys.
 */

import { describe, it, expect } from 'vitest';
import type { Feature } from '@/infrastructure/http/api';
import {
  buildProjectKey,
  selectProjectIdentity,
  selectGithubRepo,
  selectProjectReady,
  selectFeatureExists,
  selectHasFeatures,
  type ProjectSnapshot,
} from '../../src/domain/project-world/selectors';

function feat(name: string): Feature {
  return { name } as Feature;
}

function snap(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    selectedProject: 'p1',
    selectedFeature: undefined,
    projects: ['p1', 'p2'],
    features: [],
    projectConfig: null,
    ...overrides,
  };
}

describe('buildProjectKey', () => {
  it('returns null when projectId is undefined', () => {
    expect(buildProjectKey(undefined, undefined)).toBeNull();
    expect(buildProjectKey(undefined, 'feat')).toBeNull();
  });

  it('returns projectId when no feature', () => {
    expect(buildProjectKey('p1', undefined)).toBe('p1');
  });

  it('returns composite key when both are present', () => {
    expect(buildProjectKey('p1', 'feature/x')).toBe('p1/feature/x');
  });
});

describe('selectProjectIdentity', () => {
  it('builds the composite key from selection', () => {
    const s = snap({ selectedProject: 'p1', selectedFeature: 'f1' });
    expect(selectProjectIdentity(s)).toEqual({
      projectId: 'p1',
      featureName: 'f1',
      key: 'p1/f1',
    });
  });
});

describe('selectGithubRepo', () => {
  it('returns null when projectConfig is missing', () => {
    expect(selectGithubRepo(snap({ projectConfig: null }))).toBeNull();
  });

  it('returns null when githubRepo is missing', () => {
    expect(
      selectGithubRepo(
        snap({
          projectConfig: { githubRepo: null, name: null, description: null, loaded: true },
        }),
      ),
    ).toBeNull();
  });

  it('returns the declared repo URL', () => {
    expect(
      selectGithubRepo(
        snap({
          projectConfig: {
            githubRepo: 'https://github.com/x/y',
            name: null,
            description: null,
            loaded: true,
          },
        }),
      ),
    ).toBe('https://github.com/x/y');
  });
});

describe('selectProjectReady', () => {
  it('is false when no project is selected', () => {
    expect(selectProjectReady(snap({ selectedProject: undefined }))).toBe(false);
  });

  it('is false when projectConfig has not loaded yet', () => {
    expect(selectProjectReady(snap({ projectConfig: null }))).toBe(false);
  });

  it('is true when project + loaded config are present', () => {
    expect(
      selectProjectReady(
        snap({
          selectedProject: 'p1',
          projectConfig: {
            githubRepo: null,
            name: null,
            description: null,
            loaded: true,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('selectFeatureExists / selectHasFeatures', () => {
  it('finds a feature by name', () => {
    const s = snap({ features: [feat('a'), feat('b')] });
    expect(selectFeatureExists(s, 'a')).toBe(true);
    expect(selectFeatureExists(s, 'c')).toBe(false);
  });

  it('reports presence of any feature', () => {
    expect(selectHasFeatures(snap({ features: [] }))).toBe(false);
    expect(selectHasFeatures(snap({ features: [feat('a')] }))).toBe(true);
  });
});
