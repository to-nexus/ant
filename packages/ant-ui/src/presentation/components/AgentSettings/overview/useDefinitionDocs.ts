/**
 * Definition-document state for the Agent Settings cards — one hook per
 * selection, covering `agent.yaml` (agent level) or `jobs/{id}/job.yaml` plus
 * every `jobs/{id}/intents/{intentId}/(infer.md|prompt.md|hooks.yaml)` (job /
 * intent level; each intent contributes up to three docs).
 *
 * The raw text of each document is the ONLY state; the structured drafts the
 * cards render are `useMemo` derivations of it (see `definitionDocs.ts`).
 * A form edit re-serializes the same document (comments preserved), a raw
 * edit re-derives the forms — so the card's 구조화/raw views are two windows
 * onto one buffer, not two states to reconcile. One ChangedBar saves every
 * dirty document through the single definition write funnel (multi-file:
 * `planSaves` turns an emptied hooks.yaml/prompt.md into a DELETE; infer.md
 * is required and never deletes).
 *
 * A freshly added intent is a PHANTOM: its docs live only in this buffer
 * (dirty against an empty savedRaw) until the ChangedBar saves them — the
 * criterion requirement (`validateInferDoc`, applied to phantoms even while
 * clean) forces authorship before the directory ever exists on disk.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Document } from 'yaml';
import {
  validateMcpServers,
  validateApiServers,
  type CustomIntentDef,
  type DefinitionValidationResult,
  type McpServerConfig,
  type RestApiServerConfig,
} from '@ant/shared';
import { deleteDefinitionFile, fetchDefinitionFile, saveDefinitionFile } from '@/infrastructure/http/api/accountAgents';
import {
  applyHooks,
  applyInferBody,
  applyInferClarify,
  applyMainDraft,
  applyMcpServers,
  applyApiServers,
  applyName,
  deriveHooks,
  deriveId,
  deriveMainDraft,
  deriveMcpServers,
  deriveApiServers,
  deriveName,
  editRaw,
  parseInferMd,
  parseYamlDoc,
  planSaves,
  validateHooksDoc,
  validateInferDoc,
  type IntentPatch,
  type MainDraft,
} from './definitionDocs';

export type { IntentPatch, MainDraft } from './definitionDocs';

/**
 * `agent` = agent.yaml · `main` = job.yaml · `infer:{id}` / `prompt:{id}` /
 * `hooks:{id}` = that intent's infer.md / prompt.md / hooks.yaml.
 */
export type DocKey = 'agent' | 'main' | `infer:${string}` | `prompt:${string}` | `hooks:${string}`;

export const inferDocKey = (intentId: string): DocKey => `infer:${intentId}`;
export const promptDocKey = (intentId: string): DocKey => `prompt:${intentId}`;
export const hooksDocKey = (intentId: string): DocKey => `hooks:${intentId}`;

export interface DefinitionDoc {
  key: DocKey;
  path: string;
  raw: string;
  savedRaw: string;
  dirty: boolean;
  /** Syntax error in the current buffer (yaml, or infer.md frontmatter) — structured editing is off while set. */
  parseError: string | null;
}

export interface UseDefinitionDocsResult {
  loaded: boolean;
  /** The identity document of the current level (agent.yaml or job.yaml). */
  identityDoc: DefinitionDoc | null;
  /** intentId → its infer.md document (phantoms included). */
  inferDocs: Record<string, DefinitionDoc>;
  /** intentId → its prompt.md document (raw '' when the file is absent). */
  promptDocs: Record<string, DefinitionDoc>;
  /** intentId → its hooks.yaml document (raw '' when the file is absent). */
  hooksDocs: Record<string, DefinitionDoc>;
  /** `id` / `name` of the identity document. */
  identity: { id: string; name: string };
  /** `mcp.servers` of the identity document (agent.yaml or job.yaml). */
  mcpServers: Record<string, McpServerConfig>;
  /** `apis` (declared REST API connections) of the identity document. */
  apiServers: Record<string, RestApiServerConfig>;
  main: MainDraft;
  /** Draft catalog assembled across the per-intent docs (entry + hooks merged). */
  intents: CustomIntentDef[];
  setRaw: (key: DocKey, text: string) => void;
  setName: (name: string) => void;
  setMcpServers: (servers: Record<string, McpServerConfig>) => void;
  setApiServers: (servers: Record<string, RestApiServerConfig>) => void;
  setMain: (patch: Partial<MainDraft>) => void;
  /** Surgical per-field intent edit — `hooks` routes to hooks.yaml, infer/clarify to infer.md. */
  updateIntent: (intentId: string, patch: IntentPatch) => void;
  /** Add a PHANTOM intent draft — nothing touches disk until Save. */
  addIntent: (intentId: string) => void;
  /** Drop an unsaved phantom's buffers (saved intents are deleted structurally, not here). */
  dropIntentDraft: (intentId: string) => void;
  /** True while the intent exists only in this buffer (no directory on disk yet). */
  isPhantomIntent: (intentId: string) => boolean;
  /** Dirty document count (ChangedBar). */
  dirtyCount: number;
  intentErrors: string[];
  mcpErrors: string[];
  /** A parse error in a DIRTY doc — clean-but-broken files show per-card banners without freezing saves. */
  hasParseError: boolean;
  isSaving: boolean;
  save: () => Promise<{ warnings: string[] } | null>;
  discard: () => void;
  reload: () => Promise<void>;
}

const EMPTY_MAIN: MainDraft = { toolsBuiltin: null, approval: {} };

function toDoc(key: DocKey, path: string, raw: string, savedRaw: string): DefinitionDoc {
  const parseError = key.startsWith('prompt:')
    ? null // plain prose — nothing to parse
    : key.startsWith('infer:')
      ? parseInferMd(raw).error
      : parseYamlDoc(raw).error;
  return { key, path, raw, savedRaw, dirty: raw !== savedRaw, parseError };
}

const intentIdOfKey = (key: string): string | null =>
  key.startsWith('infer:') ? key.slice('infer:'.length) : null;

export function useDefinitionDocs(
  agentId: string | undefined,
  jobId: string | undefined,
  /** Intent directory names under `jobs/{jobId}/intents/` (from the definition tree). */
  intentIds: readonly string[],
): UseDefinitionDocsResult {
  // Level layout: the agent level owns agent.yaml; job/intent levels own the
  // job.yaml plus ALL THREE files of every intent (the job screen lists the
  // catalog with prompt/hook badges). Any per-intent file may be absent on
  // disk (raw '' until authored).
  const intentIdsKey = intentIds.join(',');
  const layout = useMemo<Array<{ key: DocKey; path: string; optional?: boolean }>>(
    () =>
      jobId
        ? [
            { key: 'main' as DocKey, path: `jobs/${jobId}/job.yaml` },
            ...intentIdsKey
              .split(',')
              .filter(Boolean)
              .flatMap((intentId) => [
                { key: inferDocKey(intentId), path: `jobs/${jobId}/intents/${intentId}/infer.md`, optional: true },
                { key: promptDocKey(intentId), path: `jobs/${jobId}/intents/${intentId}/prompt.md`, optional: true },
                { key: hooksDocKey(intentId), path: `jobs/${jobId}/intents/${intentId}/hooks.yaml`, optional: true },
              ]),
          ]
        : [{ key: 'agent' as DocKey, path: 'agent.yaml' }],
    [jobId, intentIdsKey],
  );

  const [raws, setRaws] = useState<Partial<Record<string, string>> | null>(null);
  const [savedRaws, setSavedRaws] = useState<Partial<Record<string, string>>>({});
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
    const next: Partial<Record<string, string>> = {};
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

  // Phantom intents ride the SAME raws map: an `infer:{id}` key present in
  // the buffer but absent from the tree layout synthesizes its doc entries.
  const docs = useMemo<DefinitionDoc[]>(() => {
    if (!raws) return [];
    const fromLayout = layout.map((e) => toDoc(e.key, e.path, raws[e.key] ?? '', savedRaws[e.key] ?? ''));
    if (!jobId) return fromLayout;
    const known = new Set(layout.map((e) => e.key as string));
    const phantoms = Object.keys(raws)
      .map(intentIdOfKey)
      .filter((id): id is string => id != null && !known.has(inferDocKey(id)))
      .flatMap((id) => [
        toDoc(inferDocKey(id), `jobs/${jobId}/intents/${id}/infer.md`, raws[inferDocKey(id)] ?? '', savedRaws[inferDocKey(id)] ?? ''),
        toDoc(promptDocKey(id), `jobs/${jobId}/intents/${id}/prompt.md`, raws[promptDocKey(id)] ?? '', savedRaws[promptDocKey(id)] ?? ''),
        toDoc(hooksDocKey(id), `jobs/${jobId}/intents/${id}/hooks.yaml`, raws[hooksDocKey(id)] ?? '', savedRaws[hooksDocKey(id)] ?? ''),
      ]);
    return [...fromLayout, ...phantoms];
  }, [raws, savedRaws, layout, jobId]);

  const identityDoc = docs.find((d) => d.key === 'agent' || d.key === 'main') ?? null;

  const { inferDocs, promptDocs, hooksDocs } = useMemo(() => {
    const inferDocs: Record<string, DefinitionDoc> = {};
    const promptDocs: Record<string, DefinitionDoc> = {};
    const hooksDocs: Record<string, DefinitionDoc> = {};
    for (const d of docs) {
      const intentId = intentIdOfKey(d.key);
      if (intentId != null) inferDocs[intentId] = d;
      else if (d.key.startsWith('prompt:')) promptDocs[d.key.slice('prompt:'.length)] = d;
      else if (d.key.startsWith('hooks:')) hooksDocs[d.key.slice('hooks:'.length)] = d;
    }
    return { inferDocs, promptDocs, hooksDocs };
  }, [docs]);

  const identityParsed = useMemo(
    () => (identityDoc ? parseYamlDoc(identityDoc.raw).doc : null),
    [identityDoc?.raw],
  );

  const identity = useMemo(
    () => ({ id: deriveId(identityParsed), name: deriveName(identityParsed) }),
    [identityParsed],
  );
  const mcpServers = useMemo(() => deriveMcpServers(identityParsed), [identityParsed]);
  const apiServers = useMemo(() => deriveApiServers(identityParsed), [identityParsed]);
  const main = useMemo(
    () => (identityDoc?.key === 'main' ? deriveMainDraft(identityParsed) : EMPTY_MAIN),
    [identityDoc?.key, identityParsed],
  );

  /** intentId → parsed docs — feeds both the assembled catalog and validation. */
  const parsedIntents = useMemo(
    () =>
      Object.keys(inferDocs)
        .sort()
        .map((intentId) => {
          const infer = parseInferMd(inferDocs[intentId].raw).value;
          const hooksParsed = hooksDocs[intentId] ? parseYamlDoc(hooksDocs[intentId].raw).doc : null;
          return { intentId, infer, hooksParsed };
        }),
    [inferDocs, hooksDocs],
  );

  const intents = useMemo<CustomIntentDef[]>(
    () =>
      parsedIntents
        // A tree-listed directory whose infer.md is empty still shows up (the
        // detail card offers the raw repair path); id IS the directory name.
        .map(({ intentId, infer, hooksParsed }) => {
          const hooks = deriveHooks(hooksParsed);
          const hasPrompt = (promptDocs[intentId]?.raw.trim() ?? '') !== '';
          return {
            id: intentId,
            infer: infer.body.trim(),
            ...(infer.clarify !== undefined ? { clarify: infer.clarify } : {}),
            ...(hooks ? { hooks } : {}),
            ...(hasPrompt ? { hasPrompt: true } : {}),
          };
        }),
    [parsedIntents, promptDocs],
  );

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

  /** infer.md edits are string→string splices (not yaml Document mutations). */
  const editInfer = useCallback((intentId: string, fn: (raw: string) => string) => {
    const key = inferDocKey(intentId);
    setRaws((prev) => (prev ? { ...prev, [key]: fn(prev[key] ?? '') } : prev));
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

  const setApiServers = useCallback(
    (servers: Record<string, RestApiServerConfig>) =>
      edit(identityKey, (doc) => applyApiServers(doc, servers)),
    [edit, identityKey],
  );

  const setMain = useCallback(
    (patch: Partial<MainDraft>) =>
      edit('main', (doc) => applyMainDraft(doc, { ...deriveMainDraft(doc), ...patch })),
    [edit],
  );

  const updateIntent = useCallback(
    (intentId: string, patch: IntentPatch) => {
      if ('hooks' in patch) {
        const stop = patch.hooks?.stop ?? [];
        if (stop.length === 0) {
          // Emptied contract: blank the buffer so save DELETES the file —
          // an absent hooks.yaml is the canonical "no hooks".
          setRaw(hooksDocKey(intentId), '');
        } else {
          edit(hooksDocKey(intentId), (doc) => applyHooks(doc, stop));
        }
      }
      if ('infer' in patch) {
        const body = patch.infer ?? '';
        editInfer(intentId, (raw) => applyInferBody(raw, body.endsWith('\n') || body === '' ? body : body + '\n'));
      }
      if ('clarify' in patch) {
        editInfer(intentId, (raw) => applyInferClarify(raw, patch.clarify));
      }
    },
    [edit, setRaw, editInfer],
  );

  const addIntent = useCallback(
    (intentId: string) => {
      // Born empty — `validateInferDoc` (applied to phantoms even while
      // clean) keeps Save blocked until a criterion is authored.
      setRaws((prev) => {
        if (!prev || prev[inferDocKey(intentId)] !== undefined) return prev;
        return { ...prev, [inferDocKey(intentId)]: '' };
      });
    },
    [],
  );

  const dropIntentDraft = useCallback((intentId: string) => {
    setRaws((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete next[inferDocKey(intentId)];
      delete next[promptDocKey(intentId)];
      delete next[hooksDocKey(intentId)];
      return next;
    });
  }, []);

  const treeIntentIds = useMemo(() => new Set(intentIdsKey.split(',').filter(Boolean)), [intentIdsKey]);
  const isPhantomIntent = useCallback(
    (intentId: string) => !treeIntentIds.has(intentId) && inferDocs[intentId] != null,
    [treeIntentIds, inferDocs],
  );

  const dirtyDocs = docs.filter((d) => d.dirty);
  // Save-blocking parse errors are DIRTY-doc-only: with a whole catalog of
  // files loaded, one pre-existing broken hooks.yaml must not freeze every
  // unrelated save on this screen (its card still shows the banner).
  const hasParseError = dirtyDocs.some((d) => d.parseError != null);

  // Contract errors are reported only for documents the user has actually
  // touched — a pre-existing invalid file must not block an unrelated save.
  // EXCEPTION: a phantom's infer.md is validated even while clean, so an
  // empty new intent cannot slip past the authorship gate.
  const intentErrors = useMemo(() => {
    const errors: string[] = [];
    for (const { intentId, hooksParsed } of parsedIntents) {
      const inferDoc = inferDocs[intentId];
      if (inferDoc && (inferDoc.dirty || isPhantomIntent(intentId))) {
        errors.push(...validateInferDoc(inferDoc.raw, intentId));
      }
      if (hooksDocs[intentId]?.dirty) {
        errors.push(...validateHooksDoc(hooksParsed, intentId));
      }
    }
    return errors;
  }, [parsedIntents, inferDocs, hooksDocs, isPhantomIntent]);

  const mcpErrors = useMemo(
    () =>
      identityDoc?.dirty ? [...validateMcpServers(mcpServers), ...validateApiServers(apiServers)] : [],
    [identityDoc?.dirty, mcpServers, apiServers],
  );

  const save = useCallback(async (): Promise<{ warnings: string[] } | null> => {
    if (!agentId || !raws) return null;
    setIsSaving(true);
    try {
      const warnings: string[] = [];
      for (const op of planSaves(docs)) {
        if (op.op === 'delete') {
          await deleteDefinitionFile(agentId, op.path);
          continue;
        }
        const { validation } = (await saveDefinitionFile(agentId, op.path, op.content ?? '')) as {
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
    inferDocs,
    promptDocs,
    hooksDocs,
    identity,
    mcpServers,
    apiServers,
    main,
    intents,
    setRaw,
    setName,
    setMcpServers,
    setApiServers,
    setMain,
    updateIntent,
    addIntent,
    dropIntentDraft,
    isPhantomIntent,
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
