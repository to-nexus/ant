/**
 * Account-scoped credential registry (A16) — the ONE client-side owner of
 * "which `${secret:KEY}` names have a value in my encrypted store". Shared by
 * the agent settings MCP editor and the pipeline fetch inspector: a pipeline's
 * inline connection references the same store the agent definitions do.
 * Values are write-only: saving PUTs into the per-user store — the store never
 * echoes a secret back, only key + updatedAt.
 */

import { useCallback, useEffect, useState } from 'react';
import { deleteMcpCredential, fetchMcpCredentials, saveMcpCredential } from '@/infrastructure/http/api/accountAgents';

export interface McpCredentialRegistry {
  /** key → updatedAt ISO string for every key registered in the store. */
  registeredAt: Record<string, string>;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  busyKey: string | null;
  flashKey: string | null;
  /** Registered keys whose masked row was flipped open for replacement. */
  editingKeys: ReadonlySet<string>;
  beginEdit: (key: string) => void;
  cancelEdit: (key: string) => void;
  save: (key: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

/**
 * Account-scoped credential registry state (A16), hoisted out of the panel so
 * the binding rows above can decorate themselves with registration status.
 * Values are write-only: saving PUTs into the encrypted per-user store — the
 * store never echoes a secret back, only key + updatedAt.
 */
export function useMcpCredentialRegistry(): McpCredentialRegistry {
  const [registeredAt, setRegisteredAt] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [editingKeys, setEditingKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchMcpCredentials()
      .then((r) => {
        if (cancelled) return;
        setRegisteredAt(Object.fromEntries(r.credentials.map((c) => [c.key, c.updatedAt])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setDraft = useCallback(
    (key: string, value: string) => setDrafts((prev) => ({ ...prev, [key]: value })),
    [],
  );
  const beginEdit = useCallback(
    (key: string) => setEditingKeys((prev) => new Set(prev).add(key)),
    [],
  );
  const cancelEdit = useCallback((key: string) => {
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setDrafts((prev) => ({ ...prev, [key]: '' }));
  }, []);

  const save = useCallback(
    async (key: string) => {
      const value = (drafts[key] ?? '').trim();
      if (!value || busyKey) return;
      setBusyKey(key);
      try {
        await saveMcpCredential(key, value);
        setRegisteredAt((prev) => ({ ...prev, [key]: new Date().toISOString() }));
        setDrafts((prev) => ({ ...prev, [key]: '' }));
        setEditingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setFlashKey(key);
        setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 2000);
      } catch (e) {
        console.error('[McpCredentials] Save failed:', e);
      } finally {
        setBusyKey(null);
      }
    },
    [drafts, busyKey],
  );

  const remove = useCallback(
    async (key: string) => {
      if (busyKey) return;
      setBusyKey(key);
      try {
        await deleteMcpCredential(key);
        setRegisteredAt((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
      } catch (e) {
        console.error('[McpCredentials] Delete failed:', e);
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey],
  );

  return { registeredAt, drafts, setDraft, busyKey, flashKey, editingKeys, beginEdit, cancelEdit, save, remove };
}
