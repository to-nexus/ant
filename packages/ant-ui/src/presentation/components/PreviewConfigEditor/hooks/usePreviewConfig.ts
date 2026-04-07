import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getPreviewConfig,
  type PreviewConfig,
  type PreviewStatus,
  type ServiceConnection,
} from '@/infrastructure/http/api';

export interface UsePreviewConfigResult {
  config: PreviewConfig | null;
  setConfig: React.Dispatch<React.SetStateAction<PreviewConfig | null>>;
  isLoading: boolean;
  structureType: string | null;
  projectProfile: { language?: string; framework?: string } | null;
  connections: ServiceConnection[];
  phase: string;
  isReady: boolean;
  issues: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  logs: Array<{ timestamp: string; type: 'stdout' | 'stderr'; message: string }>;
  fatalIssues: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  warningIssues: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
}

export function usePreviewConfig(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  previewStatus: PreviewStatus | undefined,
): UsePreviewConfigResult {
  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const configData = await getPreviewConfig(selectedProject, selectedFeature || 'main');
      setConfig(configData);
    } catch (error) {
      console.error('[PreviewConfig] Failed to load config:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject, selectedFeature]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const structureType = previewStatus?.structureType || config?.structureType || null;

  const projectProfile = useMemo(() => {
    const ps = previewStatus?.projectProfile;
    const cs = config?.projectProfile;
    if (!ps && !cs) return null;
    return { ...(cs || {}), ...(ps || {}) };
  }, [previewStatus?.projectProfile, config?.projectProfile]);

  const connections: ServiceConnection[] = useMemo(() => {
    const base = config?.connections || [];
    const live = previewStatus?.connections;
    if (!live?.length || !previewStatus?.running) return base;
    return base.map(conn => {
      const liveConn = live.find((lc: ServiceConnection) => lc.id === conn.id);
      return liveConn ? { ...conn, status: liveConn.status } : conn;
    });
  }, [config?.connections, previewStatus?.connections, previewStatus?.running]);

  const phase = previewStatus?.phase || 'idle';
  const isReady = previewStatus?.ready || false;
  const issues = previewStatus?.issues || [];
  const logs = previewStatus?.logs || [];

  const fatalIssues = useMemo(
    () => issues.filter((i) => i.severity === 'fatal'),
    [issues],
  );
  const warningIssues = useMemo(
    () => issues.filter((i) => i.severity === 'warning'),
    [issues],
  );

  return {
    config, setConfig, isLoading,
    structureType, projectProfile, connections,
    phase, isReady, issues, logs, fatalIssues, warningIssues,
  };
}
