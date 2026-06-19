import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  detectConnections,
  updatePreviewConfig,
  toggleConnectionVirtualization,
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
  handleToggleVirtualization: (id: string, active: boolean) => Promise<void>;
}

/**
 * Overlay locally-edited (`userModified`) connections on top of an incoming set
 * (a server response or re-derived prop). A server response for a single
 * operation (e.g. a virtualization toggle on connection B) reflects only the
 * persisted config and does NOT carry connection A's unsaved panel edit — a
 * naive wholesale replace would silently revert A. This preserves every pending
 * edit except the one being acted on (`exceptId`, which should take the fresh
 * server value). Keyed by `id`.
 */
function preserveLocalEdits(
  incoming: ServiceConnection[],
  prev: ServiceConnection[],
  exceptId?: string,
): ServiceConnection[] {
  const edited = new Map(
    prev.filter(c => c.userModified && c.id !== exceptId).map(c => [c.id, c] as const),
  );
  if (edited.size === 0) return incoming;
  const merged = incoming.map(c => edited.get(c.id) ?? c);
  for (const [id, c] of edited) {
    if (!incoming.some(x => x.id === id)) merged.push(c);
  }
  return merged;
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
      // `connections` is re-derived on every preview status poll. Preserve any
      // locally-edited (userModified) connection still pending code-apply so a
      // poll tick can't revert it; take fresh values for everything else.
      setLocalConns(prev => preserveLocalEdits(connections, prev));
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
      // Surface "restart to apply" immediately when the BE flagged a running
      // preview as stale — env is captured at spawn, so the save needs a restart.
      if (result.restartRequired) {
        const key = makeFeatureKey(selectedProject, selectedFeature);
        if (key) mergePreviewStatus(key, { restartRequired: true });
      }
      setHasUnsavedChanges(false);
      setEditingConnId(null);
    } catch (err) {
      console.error('[PreviewConfig] Save failed:', err);
    }
  }, [selectedProject, selectedFeature, localConns, setConfig, mergePreviewStatus]);

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

  /**
   * Auto-save Service Virtualization toggle: optimistically flips the
   * connection's `virtualization.active`, then writes
   * `USE_MOCK_<NAME>=true|false` to the project `.env` via a dedicated BE
   * endpoint so the runtime observes the new state on next preview start.
   * Reverts the optimistic update on transport failure.
   */
  const handleToggleVirtualization = useCallback(async (id: string, active: boolean) => {
    if (!selectedProject) return;
    const featureName = selectedFeature || 'main';

    setLocalConns(prev => prev.map(c =>
      c.id === id && c.virtualization
        ? { ...c, virtualization: { ...c.virtualization, active } }
        : c,
    ));

    try {
      const result = await toggleConnectionVirtualization(selectedProject, featureName, id, active);
      if (result.success && result.connections) {
        // Preserve unsaved panel edits on OTHER connections — the toggle
        // response only carries persisted config, so a wholesale replace would
        // revert a sibling connection the user edited but hasn't saved yet.
        setLocalConns(prev => preserveLocalEdits(result.connections, prev, id));
        setConfig(prev => prev
          ? { ...prev, connections: result.connections }
          : { connections: result.connections } as PreviewConfig);
      }
      if (result.restartRequired) {
        const key = makeFeatureKey(selectedProject, selectedFeature);
        if (key) mergePreviewStatus(key, { restartRequired: true });
      }
    } catch (err) {
      console.error('[PreviewConfig] Virtualization toggle failed:', err);
      setLocalConns(prev => prev.map(c =>
        c.id === id && c.virtualization
          ? { ...c, virtualization: { ...c.virtualization, active: !active } }
          : c,
      ));
    }
  }, [selectedProject, selectedFeature, setConfig, mergePreviewStatus]);

  return {
    localConns, hasUnsavedChanges,
    editingConnId, setEditingConnId,
    addingNew, setAddingNew,
    isDetecting, packageGroups, isSinglePackage,
    handleAutoDetect, handleSaveConnections,
    handleUpdateConn, handleDeleteConn, handleAddConn,
    handleToggleVirtualization,
  };
}
