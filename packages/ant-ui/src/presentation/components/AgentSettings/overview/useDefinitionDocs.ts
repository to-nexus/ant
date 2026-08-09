/**
 * Unified draft state for the Agent Settings overview forms — job/intent
 * levels only (the agent level has no form fields; identity is base/*.md
 * prose and renames live in the tree kebab, so the shell passes agentId
 * undefined there and no fetch happens).
 *
 * Loads jobs/{id}/job.yaml + jobs/{id}/intents.yaml ONCE per selection,
 * parses them into typed drafts the form cards mutate directly, and saves
 * every dirty file through the single definition write funnel with
 * comment-preserving `yaml` Document patching. One ChangedBar drives
 * save/discard for the whole overview. Intents are job-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseDocument, type Document } from 'yaml';
import type { CustomIntentDef, DefinitionValidationResult } from '@ant/shared';
import { fetchDefinitionFile, saveDefinitionFile } from '@/infrastructure/http/api/accountAgents';

export interface MainDraft {
  /** null = `tools.builtin` absent (full universal preset). */
  toolsBuiltin: string[] | null;
  approval: Record<string, 'always' | 'never'>;
}

export interface DefinitionDrafts {
  main: MainDraft;
  intents: CustomIntentDef[];
}

const INTENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const INTENT_DESCRIPTION_MAX = 200;
const INTENT_CATALOG_CAP = 32;

function toJs(doc: Document, path: string[]): unknown {
  const node = doc.getIn(path);
  return node && typeof (node as { toJSON?: () => unknown }).toJSON === 'function'
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

function parseMainDraft(raw: string): MainDraft {
  const doc = parseDocument(raw);
  const builtin = toJs(doc, ['tools', 'builtin']);
  const approval = toJs(doc, ['tools', 'approval']);
  return {
    toolsBuiltin: Array.isArray(builtin)
      ? builtin.filter((x): x is string => typeof x === 'string')
      : null,
    approval:
      approval && typeof approval === 'object'
        ? Object.fromEntries(
            Object.entries(approval as Record<string, unknown>).filter(
              (e): e is [string, 'always' | 'never'] => e[1] === 'always' || e[1] === 'never',
            ),
          )
        : {},
  };
}

function parseIntentsDraft(raw: string | null): CustomIntentDef[] {
  if (raw == null) return [];
  const doc = parseDocument(raw);
  const listed = toJs(doc, ['intents']);
  return Array.isArray(listed)
    ? listed.filter(
        (e): e is CustomIntentDef => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string',
      )
    : [];
}

/** Drafts are plain JSON — a JSON round-trip is a safe deep clone. */
function cloneDrafts(drafts: DefinitionDrafts): DefinitionDrafts {
  return JSON.parse(JSON.stringify(drafts)) as DefinitionDrafts;
}

function applyMainDraft(doc: Document, draft: MainDraft): void {
  if (draft.toolsBuiltin === null) doc.deleteIn(['tools', 'builtin']);
  else doc.setIn(['tools', 'builtin'], draft.toolsBuiltin);
  if (Object.keys(draft.approval).length === 0) doc.deleteIn(['tools', 'approval']);
  else doc.setIn(['tools', 'approval'], draft.approval);
  const tools = toJs(doc, ['tools']);
  if (tools && typeof tools === 'object' && Object.keys(tools as object).length === 0) doc.delete('tools');
}

export function applyIntentsDraft(doc: Document, entries: CustomIntentDef[]): void {
  doc.set('version', doc.get('version') ?? 1);
  doc.set(
    'intents',
    entries.map((e) => ({
      id: e.id,
      description: e.description,
      ...(e.injections && e.injections.length > 0 ? { injections: e.injections } : {}),
    })),
  );
}

/** Client-side mirror of the BE intents contract (BE stays authoritative). */
export function validateIntentsDraft(entries: CustomIntentDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!INTENT_ID_PATTERN.test(e.id)) errors.push(`intent id "${e.id}" must match [a-z0-9][a-z0-9-]*`);
    if (e.id === 'general') errors.push('"general" is the implicit fallback intent and cannot be declared');
    if (seen.has(e.id)) errors.push(`duplicate intent id "${e.id}"`);
    seen.add(e.id);
    if (!e.description || e.description.trim().length === 0) errors.push(`intent "${e.id}" requires a description`);
    if (e.description && e.description.length > INTENT_DESCRIPTION_MAX)
      errors.push(`intent "${e.id}" description exceeds ${INTENT_DESCRIPTION_MAX} chars`);
  }
  if (entries.length > INTENT_CATALOG_CAP)
    errors.push(`intent catalog exceeds the cap of ${INTENT_CATALOG_CAP}`);
  return errors;
}

export interface UseDefinitionDocsResult {
  loaded: boolean;
  draft: DefinitionDrafts | null;
  setMain: (patch: Partial<MainDraft>) => void;
  setIntents: (entries: CustomIntentDef[]) => void;
  /** Single mutation path for one intent — shared by the summary list and the detail card. */
  updateIntent: (intentId: string, patch: Partial<CustomIntentDef>) => void;
  /** Field-level change count across every editable file (ChangedBar count). */
  dirtyCount: number;
  mainDirty: boolean;
  intentsDirty: boolean;
  intentErrors: string[];
  isSaving: boolean;
  save: () => Promise<{ warnings: string[] } | null>;
  discard: () => void;
  reload: () => Promise<void>;
}

export function useDefinitionDocs(
  agentId: string | undefined,
  jobId: string | undefined,
): UseDefinitionDocsResult {
  const mainPath = `jobs/${jobId}/job.yaml`;
  const intentsPath = jobId ? `jobs/${jobId}/intents.yaml` : null;

  const [raw, setRaw] = useState<{ main: string; intents: string | null } | null>(null);
  const [saved, setSaved] = useState<DefinitionDrafts | null>(null);
  const [draft, setDraft] = useState<DefinitionDrafts | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!agentId || !jobId) {
      setRaw(null);
      setSaved(null);
      setDraft(null);
      return;
    }
    const read = (path: string) =>
      fetchDefinitionFile(agentId, path).then(
        (r) => r.content,
        () => null,
      );
    const [main, intents] = await Promise.all([
      read(mainPath),
      intentsPath ? read(intentsPath) : Promise.resolve(null),
    ]);
    if (main == null) {
      setRaw(null);
      setSaved(null);
      setDraft(null);
      return;
    }
    setRaw({ main, intents });
    const drafts: DefinitionDrafts = { main: parseMainDraft(main), intents: parseIntentsDraft(intents) };
    setSaved(drafts);
    setDraft(cloneDrafts(drafts));
  }, [agentId, jobId, mainPath, intentsPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setMain = useCallback((patch: Partial<MainDraft>) => {
    setDraft((prev) => (prev ? { ...prev, main: { ...prev.main, ...patch } } : prev));
  }, []);

  const setIntents = useCallback((entries: CustomIntentDef[]) => {
    setDraft((prev) => (prev ? { ...prev, intents: entries } : prev));
  }, []);

  const updateIntent = useCallback((intentId: string, patch: Partial<CustomIntentDef>) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            intents: prev.intents.map((e) => (e.id === intentId ? { ...e, ...patch } : e)),
          }
        : prev,
    );
  }, []);

  const { dirtyCount, mainDirty, intentsDirty } = useMemo(() => {
    if (!draft || !saved) return { dirtyCount: 0, mainDirty: false, intentsDirty: false };
    const mainKeys = Object.keys(draft.main) as Array<keyof MainDraft>;
    const changed = mainKeys.filter((k) => JSON.stringify(draft.main[k]) !== JSON.stringify(saved.main[k]));
    const intentsChanged = JSON.stringify(draft.intents) !== JSON.stringify(saved.intents);
    return {
      dirtyCount: changed.length + (intentsChanged ? 1 : 0),
      mainDirty: changed.length > 0,
      intentsDirty: intentsChanged,
    };
  }, [draft, saved]);

  const intentErrors = useMemo(() => {
    if (!draft || !intentsDirty) return [];
    return validateIntentsDraft(draft.intents);
  }, [draft, intentsDirty]);

  const save = useCallback(async (): Promise<{ warnings: string[] } | null> => {
    if (!agentId || !draft || !raw) return null;
    setIsSaving(true);
    try {
      const warnings: string[] = [];
      const putFile = async (path: string, content: string) => {
        const { validation } = (await saveDefinitionFile(agentId, path, content)) as {
          validation: DefinitionValidationResult;
        };
        warnings.push(...validation.errors);
      };
      if (mainDirty) {
        const doc = parseDocument(raw.main);
        applyMainDraft(doc, draft.main);
        await putFile(mainPath, doc.toString());
      }
      if (intentsDirty && intentsPath) {
        const doc = parseDocument(raw.intents ?? '');
        applyIntentsDraft(doc, draft.intents);
        await putFile(intentsPath, doc.toString());
      }
      await reload();
      return { warnings };
    } finally {
      setIsSaving(false);
    }
  }, [agentId, jobId, draft, raw, mainDirty, intentsDirty, mainPath, intentsPath, reload]);

  const discard = useCallback(() => {
    setDraft(saved ? cloneDrafts(saved) : null);
  }, [saved]);

  return {
    loaded: draft != null,
    draft,
    setMain,
    setIntents,
    updateIntent,
    dirtyCount,
    mainDirty,
    intentsDirty,
    intentErrors,
    isSaving,
    save,
    discard,
    reload,
  };
}
