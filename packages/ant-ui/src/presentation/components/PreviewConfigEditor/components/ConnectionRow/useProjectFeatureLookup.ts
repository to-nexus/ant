import { useState, useEffect } from 'react';
import { fetchProjects, fetchFeatures, type Feature } from '@/infrastructure/http/api';

export interface UseProjectFeatureLookupResult {
  projects: string[];
  features: Feature[];
  loadingProjects: boolean;
  loadingFeatures: boolean;
}

/**
 * Lazy lookup for the `ant-project` resolution editor: fetches the
 * project list when the resolution type switches to `ant-project`, and
 * fetches the feature list when a non-self project is selected.
 */
export function useProjectFeatureLookup(
  isEditing: boolean,
  resolutionType: string,
  draftProjectId: string | null,
): UseProjectFeatureLookupResult {
  const [projects, setProjects] = useState<string[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  useEffect(() => {
    if (isEditing && resolutionType === 'ant-project') {
      setLoadingProjects(true);
      fetchProjects()
        .then((p) => setProjects(p))
        .catch(() => setProjects([]))
        .finally(() => setLoadingProjects(false));
    }
  }, [isEditing, resolutionType]);

  useEffect(() => {
    if (isEditing && draftProjectId && draftProjectId !== 'self') {
      setLoadingFeatures(true);
      fetchFeatures(draftProjectId)
        .then((f) => setFeatures(f))
        .catch(() => setFeatures([]))
        .finally(() => setLoadingFeatures(false));
    } else {
      setFeatures([]);
    }
  }, [isEditing, draftProjectId]);

  return { projects, features, loadingProjects, loadingFeatures };
}
