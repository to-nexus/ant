import { useState, useEffect, useMemo } from 'react';
import type {
  ServiceConnection,
  ConnectionResolution,
  ServiceCategory,
} from '@/infrastructure/http/api';

export interface DraftState {
  name: string;
  category: ServiceCategory;
  envVar: string;
  resolution: ConnectionResolution;
  urlInput: string;
  connectionString: string;
}

export interface UseConnectionRowDraftResult {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  draftProjectId: string | null;
  derivedValue: string;
}

/**
 * Edit-mode draft state for a single connection row. Reset whenever the
 * row enters edit mode so cancellation is a no-op (the parent's `conn`
 * never gets mutated until `handleConfirm` calls `onUpdate`).
 */
export function useConnectionRowDraft(
  conn: ServiceConnection,
  isEditing: boolean,
): UseConnectionRowDraftResult {
  const [draft, setDraft] = useState<DraftState>({
    name: conn.name,
    category: conn.category,
    envVar: conn.envVar,
    resolution: conn.resolution,
    urlInput: '',
    connectionString: '',
  });

  useEffect(() => {
    if (isEditing) {
      setDraft({
        name: conn.name,
        category: conn.category,
        envVar: conn.envVar,
        resolution: conn.resolution,
        urlInput: conn.resolution.type === 'url' ? (conn.value || conn.resolution.url || '') : '',
        connectionString: conn.resolution.type === 'docker' ? (conn.value || '') : '',
      });
    }
  }, [isEditing, conn.name, conn.category, conn.envVar, conn.value, conn.resolution]);

  const draftProjectId = draft.resolution.type === 'ant-project' ? draft.resolution.projectId : null;

  const derivedValue = useMemo(() => {
    if (draft.resolution.type === 'url') return draft.urlInput;
    if (draft.resolution.type === 'docker') return draft.connectionString;
    if (draft.resolution.type === 'ant-project') return '(auto)';
    return '';
  }, [draft.resolution.type, draft.urlInput, draft.connectionString]);

  return { draft, setDraft, draftProjectId, derivedValue };
}
