/**
 * Definition-document state for the Agent Settings cards — one hook per
 * selection, covering `agent.yaml` (agent level) or `jobs/{id}/job.yaml` +
 * `intents.yaml` (job / intent level).
 *
 * The raw YAML text of each document is the ONLY state; the structured drafts
 * the cards render are `useMemo` derivations of it (see `definitionDocs.ts`).
 * A form edit re-serializes the same document (comments preserved), a raw
 * edit re-derives the forms — so the card's 구조화/YAML views are two windows
 * onto one buffer, not two states to reconcile. One ChangedBar saves every
 * dirty document through the single definition write funnel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Document } from 'yaml';
import {
  validateMcpServers,
  type CustomIntentDef,
  type DefinitionValidationResult,
  type McpServerConfig,
} from '@ant/shared';
import { fetchDefinitionFile, saveDefinitionFile } from '@/infrastructure/http/api/accountAgents';
import {
  applyIntentsDraft,
  applyMainDraft,
  applyMcpServers,
  applyName,
  deriveId,
  deriveIntents,
  deriveMainDraft,
  deriveMcpServers,
  deriveName,
  editRaw,
  parseYamlDoc,
  validateIntentsDraft,
  type MainDraft,
} from './definitionDocs';

export type { MainDraft } from './definitionDocs';

/** `agent` = agent.yaml · `main` = job.yaml · `intents` = intents.yaml. */
export type DocKey = 'agent' | 'main' | 'intents';

export interface DefinitionDoc {
  key: DocKey;
  path: string;
  raw: string;
  savedRaw: string;
  dirty: boolean;
  /** YAML syntax error in the current buffer — structured editing is off while set. */
  parseError: string | null;
}

export interface UseDefinitionDocsResult {
  loaded: boolean;
  /** The identity document of the current level (agent.yaml or job.yaml). */
  identityDoc: DefinitionDoc | null;
  intentsDoc: DefinitionDoc | null;
  /** `id` / `name` of the identity document. */
  identity: { id: string; name: string };
  /** `mcp.servers` of the identity document (agent.yaml or job.yaml). */
  mcpServers: Record<string, McpServerConfig>;
  main: MainDraft;
  intents: CustomIntentDef[];
  setRaw: (key: DocKey, text: string) => void;
  setName: (name: string) => void;
  setMcpServers: (servers: Record<string, McpServerConfig>) => void;
  setMain: (patch: Partial<MainDraft>) => void;
  setIntents: (entries: CustomIntentDef[]) => void;
  updateIntent: (intentId: string, patch: Partial<CustomIntentDef>) => void;
  /**
   * Change one intent's id in place. Unlike agent/job ids this is a catalog
   * edit, not a directory move — it lands in the draft and the ChangedBar
   * confirms it, so the id axis stays editable at all three levels.
   */
  renameIntent: (intentId: string, newId: string) => void;
  /** New intents are born with an empty description — the save gate forces authorship. */
  addIntent: (intentId: string) => void;
  removeIntent: (intentId: string) => void;
  /** Dirty document count (ChangedBar). */
  dirtyCount: number;
  intentErrors: string[];
  mcpErrors: string[];
  hasParseError: boolean;
  isSaving: boolean;
  save: () => Promise<{ warnings: string[] } | null>;
  discard: () => void;
  reload: () => Promise<void>;
}

const EMPTY_MAIN: MainDraft = { toolsBuiltin: null, approval: {} };

function toDoc(key: DocKey, path: string, raw: string, savedRaw: string): DefinitionDoc {
  return { key, path, raw, savedRaw, dirty: raw !== savedRaw, parseError: parseYamlDoc(raw).error };
}

export function useDefinitionDocs(
  agentId: string | undefined,
  jobId: string | undefined,
): UseDefinitionDocsResult {
  // Level layout: the agent level owns agent.yaml, job/intent levels own the
  // job's pair. `intents.yaml` may be absent on disk (raw '' until authored).
  const layout = useMemo<Array<{ key: DocKey; path: string; optional?: boolean }>>(
    () =>
      jobId
        ? [
            { key: 'main', path: `jobs/${jobId}/job.yaml` },
            { key: 'intents', path: `jobs/${jobId}/intents.yaml`, optional: true },
          ]
        : [{ key: 'agent', path: 'agent.yaml' }],
    [jobId],
  );

  const [raws, setRaws] = useState<Partial<Record<DocKey, string>> | null>(null);
  const [savedRaws, setSavedRaws] = useState<Partial<Record<DocKey, string>>>({});
  const [isSaving, setIsSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!agentId) {
      setRaws(null);
      setSavedRaws({});
      return;
    }
    const contents = await Promise.all(
      layout.map((entry) =>
        fetchDefinitionFile(agentId, entry.path).then(
          (r) => r.content,
          () => null,
        ),
      ),
    );
    const next: Partial<Record<DocKey, string>> = {};
    for (const [i, entry] of layout.entries()) {
      const content = contents[i];
      if (content == null) {
        if (!entry.optional) {
          setRaws(null);
          setSavedRaws({});
          return;
        }
        next[entry.key] = '';
      } else {
        next[entry.key] = content;
      }
    }
    setRaws(next);
    setSavedRaws({ ...next });
  }, [agentId, layout]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const docs = useMemo<DefinitionDoc[]>(
    () =>
      raws ? layout.map((e) => toDoc(e.key, e.path, raws[e.key] ?? '', savedRaws[e.key] ?? '')) : [],
    [raws, savedRaws, layout],
  );

  const identityDoc = docs.find((d) => d.key === 'agent' || d.key === 'main') ?? null;
  const intentsDoc = docs.find((d) => d.key === 'intents') ?? null;

  const identityParsed = useMemo(
    () => (identityDoc ? parseYamlDoc(identityDoc.raw).doc : null),
    [identityDoc?.raw],
  );
  const intentsParsed = useMemo(
    () => (intentsDoc ? parseYamlDoc(intentsDoc.raw).doc : null),
    [intentsDoc?.raw],
  );

  const identity = useMemo(
    () => ({ id: deriveId(identityParsed), name: deriveName(identityParsed) }),
    [identityParsed],
  );
  const mcpServers = useMemo(() => deriveMcpServers(identityParsed), [identityParsed]);
  const main = useMemo(
    () => (identityDoc?.key === 'main' ? deriveMainDraft(identityParsed) : EMPTY_MAIN),
    [identityDoc?.key, identityParsed],
  );
  const intents = useMemo(() => deriveIntents(intentsParsed), [intentsParsed]);

  const setRaw = useCallback((key: DocKey, text: string) => {
    setRaws((prev) => (prev ? { ...prev, [key]: text } : prev));
  }, []);

  /**
   * Structured edits round-trip through the raw buffer — the single state.
   * The mutation reads its "previous value" off the document it is patching,
   * never off a rendered snapshot, so rapid edits cannot lose a write.
   */
  const edit = useCallback((key: DocKey, mutate: (doc: Document) => void) => {
    setRaws((prev) => (prev ? { ...prev, [key]: editRaw(prev[key] ?? '', mutate) } : prev));
  }, []);

  const identityKey: DocKey = jobId ? 'main' : 'agent';

  const setName = useCallback(
    (name: string) => edit(identityKey, (doc) => applyName(doc, name)),
    [edit, identityKey],
  );

  const setMcpServers = useCallback(
    (servers: Record<string, McpServerConfig>) =>
      edit(identityKey, (doc) => applyMcpServers(doc, servers)),
    [edit, identityKey],
  );

  const setMain = useCallback(
    (patch: Partial<MainDraft>) =>
      edit('main', (doc) => applyMainDraft(doc, { ...deriveMainDraft(doc), ...patch })),
    [edit],
  );

  const editIntents = useCallback(
    (transform: (entries: CustomIntentDef[]) => CustomIntentDef[]) =>
      edit('intents', (doc) => applyIntentsDraft(doc, transform(deriveIntents(doc)))),
    [edit],
  );

  const setIntents = useCallback(
    (entries: CustomIntentDef[]) => editIntents(() => entries),
    [editIntents],
  );

  const updateIntent = useCallback(
    (intentId: string, patch: Partial<CustomIntentDef>) =>
      editIntents((entries) => entries.map((e) => (e.id === intentId ? { ...e, ...patch } : e))),
    [editIntents],
  );

  const renameIntent = useCallback(
    (intentId: string, newId: string) =>
      editIntents((entries) =>
        entries.some((e) => e.id === newId)
          ? entries
          : entries.map((e) => (e.id === intentId ? { ...e, id: newId } : e)),
      ),
    [editIntents],
  );

  const addIntent = useCallback(
    (intentId: string) =>
      editIntents((entries) =>
        entries.some((e) => e.id === intentId) ? entries : [...entries, { id: intentId, description: '' }],
      ),
    [editIntents],
  );

  const removeIntent = useCallback(
    (intentId: string) => editIntents((entries) => entries.filter((e) => e.id !== intentId)),
    [editIntents],
  );

  const dirtyDocs = docs.filter((d) => d.dirty);
  const hasParseError = docs.some((d) => d.parseError != null);

  // Contract errors are reported only for documents the user has actually
  // touched — a pre-existing invalid file must not block an unrelated save.
  const intentErrors = useMemo(
    () => (intentsDoc?.dirty ? validateIntentsDraft(intents) : []),
    [intentsDoc?.dirty, intents],
  );

  const mcpErrors = useMemo(
    () => (identityDoc?.dirty ? validateMcpServers(mcpServers) : []),
    [identityDoc?.dirty, mcpServers],
  );

  const save = useCallback(async (): Promise<{ warnings: string[] } | null> => {
    if (!agentId || !raws) return null;
    setIsSaving(true);
    try {
      const warnings: string[] = [];
      for (const doc of docs) {
        if (!doc.dirty) continue;
        const { validation } = (await saveDefinitionFile(agentId, doc.path, doc.raw)) as {
          validation: DefinitionValidationResult;
        };
        warnings.push(...validation.errors);
      }
      await reload();
      return { warnings };
    } finally {
      setIsSaving(false);
    }
  }, [agentId, raws, docs, reload]);

  const discard = useCallback(() => {
    setRaws({ ...savedRaws });
  }, [savedRaws]);

  return {
    loaded: raws != null,
    identityDoc,
    intentsDoc,
    identity,
    mcpServers,
    main,
    intents,
    setRaw,
    setName,
    setMcpServers,
    setMain,
    setIntents,
    updateIntent,
    renameIntent,
    addIntent,
    removeIntent,
    dirtyCount: dirtyDocs.length,
    intentErrors,
    mcpErrors,
    hasParseError,
    isSaving,
    save,
    discard,
    reload,
  };
}
