/**
 * project-world consumer hooks.
 *
 * Thin wrappers over the underlying project/projectConfig slices that expose
 * only the lifecycle primitives sanctioned by the greenfield contract. All
 * UI reads flow through here so the slice shape (notably the AsyncFields
 * envelope for `projectConfig`) is insulated from consumers.
 */

import { useMemo } from 'react';
import { useStore } from '../store';
import type { Feature } from '@/infrastructure/http/api';
import {
  buildProjectKey,
  type ProjectSnapshot,
  type ProjectConfigSnapshot,
} from './selectors';

interface ProjectWorldStoreSurface {
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  projects: string[];
  features: Feature[];
  setSelectedProject: (projectId: string | undefined) => void;
  setSelectedFeature: (feature: string | undefined) => void;
  fetchProjects: () => Promise<void>;
  fetchFeatures: (projectId?: string) => Promise<Feature[]>;
  /**
   * `projectConfig` lives on `projectConfigSlice` as an AsyncFields envelope:
   *   { status: AsyncStatus; data: ProjectConfig | null; error; refreshing }
   * Reads below unwrap that shape explicitly.
   */
  projectConfig?: unknown;
  fetchProjectConfig?: (projectId: string) => Promise<void>;
}

function useProjectStore<T>(selector: (s: ProjectWorldStoreSurface) => T): T {
  return useStore((s: any) => selector(s as ProjectWorldStoreSurface));
}

// ============================================================================
// Primitive reads
// ============================================================================

export function useSelectedProject(): string | undefined {
  return useProjectStore((s) => s.selectedProject);
}

export function useSelectedFeature(): string | undefined {
  return useProjectStore((s) => s.selectedFeature);
}

export function useProjectKey(): string | null {
  const projectId = useSelectedProject();
  const feature = useSelectedFeature();
  return useMemo(() => buildProjectKey(projectId, feature), [projectId, feature]);
}

export function useProjects(): ReadonlyArray<string> {
  return useProjectStore((s) => s.projects);
}

export function useFeatures(): ReadonlyArray<Feature> {
  return useProjectStore((s) => s.features);
}

// ============================================================================
// Project-config reads — unwrap the AsyncFields envelope into primitives and
// re-compose inside `useMemo`. Selectors that return non-primitive objects
// from `useStore` must not allocate inline (Zustand compares by reference);
// reading primitives individually keeps rerender counts stable.
// ============================================================================

function useProjectConfigRaw(): {
  data: { githubRepo?: string | null; name?: string | null; description?: string | null } | null;
  status: string;
} {
  const data = useStore((s: any) => s.projectConfig?.data ?? null);
  const status = useStore((s: any) => s.projectConfig?.status ?? 'idle');
  return { data, status };
}

export function useProjectConfigSnapshot(): ProjectConfigSnapshot | null {
  const githubRepo = useStore((s: any) => s.projectConfig?.data?.githubRepo ?? null);
  const name = useStore((s: any) => s.projectConfig?.data?.name ?? null);
  const description = useStore((s: any) => s.projectConfig?.data?.description ?? null);
  const status = useStore((s: any) => s.projectConfig?.status ?? 'idle');
  const hasEnvelope = useStore((s: any) => s.projectConfig != null);
  return useMemo(() => {
    if (!hasEnvelope) return null;
    return {
      githubRepo,
      name,
      description,
      loaded: status === 'ready',
    };
  }, [githubRepo, name, description, status, hasEnvelope]);
}

/**
 * Returns a snapshot bundled for selector consumption. All fields derive from
 * primitive store reads — safe to pass into pure selectors / tests.
 */
export function useProjectSnapshot(): ProjectSnapshot {
  const selectedProject = useSelectedProject();
  const selectedFeature = useSelectedFeature();
  const projects = useProjects();
  const features = useFeatures();
  const projectConfig = useProjectConfigSnapshot();

  return useMemo(
    () => ({
      selectedProject,
      selectedFeature,
      projects: projects as ReadonlyArray<string>,
      features: features as ReadonlyArray<Feature>,
      projectConfig,
    }),
    [selectedProject, selectedFeature, projects, features, projectConfig],
  );
}

export function useGithubRepo(): string | null {
  // Reads through the same primitive path as `useProjectConfigSnapshot` to
  // avoid constructing an intermediate object just for this one field.
  return useStore((s: any) => s.projectConfig?.data?.githubRepo ?? null);
}

// Silence unused-export warning for the diagnostic helper above.
void useProjectConfigRaw;

// ============================================================================
// Dispatch — sanctioned writers. The underlying slice setters remain the
// mutation entry points; `useProjectLifecycle` orchestrates side-effects on
// `(selectedProject, selectedFeature)` transitions.
// ============================================================================

export function useProjectDispatch() {
  const setSelectedProject = useProjectStore((s) => s.setSelectedProject);
  const setSelectedFeature = useProjectStore((s) => s.setSelectedFeature);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchFeatures = useProjectStore((s) => s.fetchFeatures);
  const fetchProjectConfig = useProjectStore((s) => s.fetchProjectConfig);

  return useMemo(
    () => ({
      setSelectedProject,
      setSelectedFeature,
      fetchProjects,
      fetchFeatures,
      fetchProjectConfig,
    }),
    [setSelectedProject, setSelectedFeature, fetchProjects, fetchFeatures, fetchProjectConfig],
  );
}
