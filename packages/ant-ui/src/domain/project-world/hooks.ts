/**
 * project-world consumer hooks.
 *
 * Thin wrappers over the existing project slice that expose only the
 * lifecycle primitives sanctioned by the greenfield contract. All UI reads
 * flow through here so that later cutover moves from projectSlice /
 * projectConfigSlice to a dedicated slice without touching consumers.
 */

import { useMemo } from 'react';
import { useStore } from '../store';
import type { Feature } from '@/infrastructure/http/api';
import {
  buildProjectKey,
  selectGithubRepo,
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
  projectConfig?: unknown;
  projectConfigLoaded?: boolean;
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
// Project-config reads (sanctioned subset — github repo + loaded flag)
// ============================================================================

/**
 * Returns a snapshot bundled for selector consumption. Useful to forward
 * into pure selectors in pages / tests without replicating access paths.
 */
export function useProjectSnapshot(): ProjectSnapshot {
  const selectedProject = useSelectedProject();
  const selectedFeature = useSelectedFeature();
  const projects = useProjects();
  const features = useFeatures();

  // projectConfig lives on projectConfigSlice today — we read it shallowly
  // and normalize into `ProjectConfigSnapshot` so callers don't need to
  // understand the legacy shape.
  const cfg = useStore((s: any): ProjectConfigSnapshot | null => {
    const raw = s.projectConfig;
    if (!raw) return null;
    return {
      githubRepo: raw.githubRepo ?? null,
      name: raw.name ?? null,
      description: raw.description ?? null,
      loaded: Boolean(s.projectConfigLoaded ?? raw),
    };
  });

  return useMemo(
    () => ({
      selectedProject,
      selectedFeature,
      projects: projects as ReadonlyArray<string>,
      features: features as ReadonlyArray<Feature>,
      projectConfig: cfg,
    }),
    [selectedProject, selectedFeature, projects, features, cfg],
  );
}

export function useGithubRepo(): string | null {
  const snapshot = useProjectSnapshot();
  return useMemo(() => selectGithubRepo(snapshot), [snapshot]);
}

// ============================================================================
// Dispatch (pure setters during migration — will be the canonical writers
// after cutover when lifecycle orchestration moves into `useProjectLifecycle`)
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
