/**
 * project-world selectors — pure derivations over the project slice.
 *
 * The project-world contract stores the primitive lifecycle state
 * (`selectedProject`, `selectedFeature`, `projects`, `features`,
 * `projectConfig`). Selectors expose the subset actually used by the UI
 * so consumers never reach through arbitrary slice keys.
 *
 * Post-cutover the underlying state moves to a dedicated slice and
 * selectors stay unchanged — callers are insulated from the migration.
 */

import type { Feature } from '@/infrastructure/http/api';

export interface ProjectSnapshot {
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  projects: ReadonlyArray<string>;
  features: ReadonlyArray<Feature>;
  projectConfig: ProjectConfigSnapshot | null;
}

export interface ProjectConfigSnapshot {
  githubRepo: string | null;
  name: string | null;
  description: string | null;
  /** Present iff the project config fetch has resolved at least once. */
  loaded: boolean;
}

export type ProjectLifecyclePhase =
  | { kind: 'idle' }
  | { kind: 'restoring'; expectedFeature: string | undefined }
  | { kind: 'ready' };

// ============================================================================
// Project identity selectors
// ============================================================================

export function selectProjectIdentity(snapshot: ProjectSnapshot) {
  return {
    projectId: snapshot.selectedProject,
    featureName: snapshot.selectedFeature,
    // Composite key used for cache and SSE subscription deduping.
    key: buildProjectKey(snapshot.selectedProject, snapshot.selectedFeature),
  };
}

export function buildProjectKey(
  projectId: string | undefined,
  featureName: string | undefined,
): string | null {
  if (!projectId) return null;
  return featureName ? `${projectId}/${featureName}` : projectId;
}

// ============================================================================
// Project-config selectors (used by git-world, GitPanel, and AccountConfig)
// ============================================================================

export function selectGithubRepo(snapshot: ProjectSnapshot): string | null {
  return snapshot.projectConfig?.githubRepo ?? null;
}

export function selectProjectReady(snapshot: ProjectSnapshot): boolean {
  return Boolean(snapshot.selectedProject && snapshot.projectConfig?.loaded);
}

// ============================================================================
// Features selectors
// ============================================================================

export function selectFeatureExists(
  snapshot: ProjectSnapshot,
  featureName: string,
): boolean {
  return snapshot.features.some((f) => f.name === featureName);
}

export function selectHasFeatures(snapshot: ProjectSnapshot): boolean {
  return snapshot.features.length > 0;
}
