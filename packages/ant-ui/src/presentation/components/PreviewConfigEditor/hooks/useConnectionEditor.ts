import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  detectConnections,
  updatePreviewConfig,
  type ServiceConnection,
  type PreviewConfig,
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';

export interface UseConnectionEditorResult {
  localConns: ServiceConnection[];
  hasUnsavedChanges: boolean;
  editingConnId: string | null;
  setEditingConnId: (id: string | null) => void;
  addingNew: boolean;
  setAddingNew: (v: boolean) => void;
  isDetecting: boolean;
  packageGroups: Map<string, ServiceConnection[]>;
  isSinglePackage: boolean;
  handleAutoDetect: () => Promise<void>;
  handleSaveConnections: () => Promise<void>;
  handleUpdateConn: (id: string, updates: Partial<ServiceConnection>) => void;
  handleDeleteConn: (id: string) => void;
  handleAddConn: (conn: ServiceConnection) => void;
}

export function useConnectionEditor(
  setConfig: React.Dispatch<React.SetStateAction<PreviewConfig | null>>,
  connections: ServiceConnection[],
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
): UseConnectionEditorResult {
  const mergePreviewStatus = useStore((s: any) => s.mergePreviewStatus);

  const [localConns, setLocalConns] = useState<ServiceConnection[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [addingNew, setAddingNew] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setLocalConns(connections);
    }
  }, [connections, hasUnsavedChanges]);

  const packageGroups = useMemo(() => {
    const groups = new Map<string, ServiceConnection[]>();
    for (const conn of localConns) {
      const source = conn.source || '*';
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source)!.push(conn);
    }
    for (const conns of groups.values()) {
      conns.sort((a, b) => {
        if (a.category === b.category) return 0;
        return a.category === 'business' ? -1 : 1;
      });
    }
    return groups;
  }, [localConns]);

  const isSinglePackage = packageGroups.size <= 1;

  const handleAutoDetect = useCallback(async () => {
    if (!selectedProject) return;
    setIsDetecting(true);
    try {
      const result = await detectConnections(selectedProject, selectedFeature || 'main');
      if (result.success) {
        setLocalConns(result.connections);
        setConfig(prev => prev
          ? { ...prev, connections: result.connections }
          : { connections: result.connections } as PreviewConfig);
        // Propagate fresh connections into the per-feature preview slice
        // so the Preview Controls section sees live statuses immediately
        // (when the server is running). Missing feature key → skip.
        const key = makeFeatureKey(selectedProject, selectedFeature);
        if (key) {
          const currentStatus = useStore.getState().previewByFeature[key]?.status;
          if (currentStatus?.running && currentStatus?.connections) {
            mergePreviewStatus(key, { connections: result.connections });
          }
        }
        setHasUnsavedChanges(false);
      }
    } catch (err) {
      console.error('[PreviewConfig] Auto-detect failed:', err);
      setLocalConns([]);
      setConfig(prev => prev ? { ...prev, connections: [] } : { connections: [] } as PreviewConfig);
      setHasUnsavedChanges(false);
    } finally {
      setIsDetecting(false);
    }
  }, [selectedProject, selectedFeature, setConfig, mergePreviewStatus]);

  const handleSaveConnections = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const result = await updatePreviewConfig(selectedProject, selectedFeature || 'main', { connections: localConns });
      if (result.success && result.connections) {
        setLocalConns(result.connections);
        setConfig(prev => prev
          ? { ...prev, connections: result.connections }
          : { connections: result.connections } as PreviewConfig);
      }
      setHasUnsavedChanges(false);
      setEditingConnId(null);
    } catch (err) {
      console.error('[PreviewConfig] Save failed:', err);
    }
  }, [selectedProject, selectedFeature, localConns, setConfig]);

  const handleUpdateConn = useCallback((id: string, updates: Partial<ServiceConnection>) => {
    setLocalConns(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    setHasUnsavedChanges(true);
  }, []);

  const handleDeleteConn = useCallback((id: string) => {
    setLocalConns(prev => prev.filter(c => c.id !== id));
    setHasUnsavedChanges(true);
    setEditingConnId(prev => prev === id ? null : prev);
  }, []);

  const handleAddConn = useCallback((conn: ServiceConnection) => {
    setLocalConns(prev => [...prev, conn]);
    setHasUnsavedChanges(true);
    setAddingNew(false);
  }, []);

  return {
    localConns, hasUnsavedChanges,
    editingConnId, setEditingConnId,
    addingNew, setAddingNew,
    isDetecting, packageGroups, isSinglePackage,
    handleAutoDetect, handleSaveConnections,
    handleUpdateConn, handleDeleteConn, handleAddConn,
  };
}
