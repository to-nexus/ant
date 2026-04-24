/**
 * project-world public API.
 *
 * Re-exports the sanctioned set of project lifecycle primitives. Consumers
 * inside `presentation/**` MUST route through this file — direct imports
 * from `domain/store/slices/projectSlice` or `projectConfigSlice` are
 * forbidden (see ESLint rules and `.claude/skills/update-git-world/SKILL.md`).
 */

export type {
  ProjectSnapshot,
  ProjectConfigSnapshot,
  ProjectLifecyclePhase,
} from './selectors';

export {
  buildProjectKey,
  selectProjectIdentity,
  selectGithubRepo,
  selectProjectReady,
  selectFeatureExists,
  selectHasFeatures,
} from './selectors';

export {
  useSelectedProject,
  useSelectedFeature,
  useProjectKey,
  useProjects,
  useFeatures,
  useProjectSnapshot,
  useProjectConfigSnapshot,
  useGithubRepo,
  useProjectDispatch,
} from './hooks';

export { useProjectLifecycle } from './lifecycle';
