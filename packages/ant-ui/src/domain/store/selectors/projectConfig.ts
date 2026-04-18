import type { AsyncFields } from '@/domain/async';
import type { ProjectConfig } from '@/infrastructure/http/api';

interface WithProjectConfig {
  projectConfig: AsyncFields<ProjectConfig>;
}

/** `true` iff a 404 confirmed the config is missing. */
export function selectProjectConfigMissing(s: WithProjectConfig): boolean {
  return s.projectConfig.status === 'empty';
}

/**
 * `true` iff the config has been fetched and exists. Replaces the legacy
 * boolean `exists` flag that used to live on the slice.
 */
export function selectProjectConfigExists(s: WithProjectConfig): boolean {
  return s.projectConfig.status === 'ready' && s.projectConfig.data != null;
}

/** Returns the loaded ProjectConfig or null. */
export function selectProjectConfigData(s: WithProjectConfig): ProjectConfig | null {
  return s.projectConfig.data;
}
