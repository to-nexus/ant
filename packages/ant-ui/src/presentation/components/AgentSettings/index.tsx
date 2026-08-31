import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { ChangedBar, DangerZone, PROSE_MEASURE, StatusPill } from '@/presentation/components/ConfigEditor/aurora';
import {
  createAccountAgent,
  createAccountAgentJob,
  createDefinitionDir,
  createDefinitionFile,
  deleteAccountAgent,
  deleteAccountAgentJob,
  deleteDefinitionFile,
  downloadAgentFolder,
  importAgentFolder,
  renameAccountAgentId,
  renameAccountAgentJobId,
  renameDefinitionFile,
  uploadDefinitionFiles,
  validateAccountAgentJob,
} from '@/infrastructure/http/api/accountAgents';
import type { CustomAgentDefinitionFileNode, FileNode } from '@ant/shared';
import { isValidCustomId } from '@ant/shared';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { useUploadConflicts } from '@/application/hooks/ui/useUploadConflicts';
import { fileListToEntries } from '@/shared/utils/upload-utils';
import { UploadConflictModal } from '@/presentation/components/common/UploadConflictModal';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { entriesUnder, findDefinitionNode, hasEntry, pickedFolderName } from './definitionUpload';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { AgentTree } from './AgentTree';
import { OrgAccessCard } from '../shared/org/OrgAccessCard';
import { PromoteZone } from '../shared/org/PromoteZone';
import { updateAgentEditors } from '@/infrastructure/http/api/accountAgents';
import { DetailHeader, type DetailLevel } from './DetailHeader';
import { PromptsCard, type PromptsScope } from './prompts/PromptsCard';
import { useResizableWidth } from './useResizableWidth';
import { IntentsCard, JobDefinitionCard, type OverviewCtx } from './overview/sections';
import { AgentDefinitionCard } from './overview/AgentDefinitionCard';
import { IntentIdentityCard } from './overview/IntentIdentityCard';
import { IntentDetailCard } from './overview/IntentDetailCard';
import { IntentPromptCard } from './overview/IntentPromptCard';
import { IntentHooksCard } from './overview/IntentHooksCard';
import { CARD_OF_KIND, classifyDefinitionPath } from './overview/definitionDocs';
import { useDefinitionDocs } from './overview/useDefinitionDocs';
import { useAgentExtensionServers } from './overview/useAgentExtensionServers';
import type { ExtensionServers } from './overview/actionHook';

/**
 * Agent Settings — account-scoped standalone screen (profile menu → main
 * panel tab, D-G). Works WITHOUT a selected project: everything reads
 * `/api/definitions/agents`.
 *
 * FILE ↔ SECTION ISOMORPHISM (the screen's core philosophy): the left tree
 * and the right sections show the SAME definition content — structured vs
 * raw. Every mapped section owns exactly one file (or directory), and the
 * two surfaces sync both ways: a tree click selects the level and scrolls to
 * the owning card; interacting with a card highlights its file in the tree.
 *
 *   agent.yaml                   → AgentDefinitionCard   (c3g-agent)
 *   base/*.md                    → PromptsCard           (c3g-prompts)
 *   on-demand/**.md|.json        → PromptsCard           (c3g-prompts)
 *   jobs/{j}/                    → JobDefinitionCard     (c3g-tools)
 *   jobs/{j}/job.yaml            → JobDefinitionCard     (c3g-tools)
 *   jobs/{j}/base/*.md           → PromptsCard           (c3g-prompts)
 *   jobs/{j}/on-demand/**        → PromptsCard           (c3g-prompts)
 *   jobs/{j}/intents/            → IntentsCard           (c3g-intents)
 *   intents/{i}/                 → IntentIdentityCard    (c3g-intent)
 *   intents/{i}/infer.md         → IntentDetailCard      (c3g-intent-criteria)
 *   intents/{i}/prompt.md        → IntentPromptCard      (c3g-intent-prompt)
 *   intents/{i}/hooks.yaml       → IntentHooksCard       (c3g-intent-hooks)
 *   (non-file: OrgAccess / Promote / Danger — outside the mapping)
 *
 * A LEVEL's row is its DIRECTORY: clicking `jobs/{j}/` or `intents/{i}/` opens
 * that level, because the directory is what the level IS.
 *
 * Each mapped card shows a structured form OR the raw text over the SAME
 * buffer (see `useDefinitionDocs`). The tree only creates and navigates;
 * renaming (display name and id) is the card's job and deleting is the
 * Danger Zone, so no file has two writers.
 *
 * RENAME POLICY (one rule, all three levels): an id IS a directory name, so
 * renaming lives in the card that owns the level's CONTAINER — never in a card
 * that owns a file inside it. agent.yaml and job.yaml declare their level's
 * identity, so those cards carry display name + id; an intent has no declaring
 * file, so the intent level opens with its own identity card and infer.md's
 * card keeps only what the file says (criteria + clarify). Every rename is a
 * structural move done by its own endpoint through the shared `IdRenameField`;
 * the intent one is a PURE directory rename server-side. A freshly created
 * intent is a PHANTOM draft (no directory yet): the ChangedBar's save
 * materializes it, and until then deleting it just drops the draft.
 *
 * No TocNav rail and no per-card path captions — the left tree IS the
 * location surface; `ChangedBar.dirtyCount` carries the dirty signal.
 */

/** Intent directory names under `jobs/{jobId}/intents/` in the definition tree. */
function intentDirsUnder(tree: CustomAgentDefinitionFileNode[], jobId: string | undefined): string[] {
  if (!jobId) return [];
  const jobs = tree.find((n) => n.type === 'directory' && n.name === 'jobs');
  const job = jobs?.children?.find((n) => n.type === 'directory' && n.name === jobId);
  const intents = job?.children?.find((n) => n.type === 'directory' && n.name === 'intents');
  return (intents?.children ?? [])
    .filter((n) => n.type === 'directory')
    .map((n) => n.name)
    .sort();
}

// AccountConfigEditor precedent: the main-panel tab bar owns close — the
// prop is accepted for mount-site compatibility and deliberately unused.
export function AgentSettings({ onClose: _onClose }: { onClose?: () => void }) {
  const { t } = useTranslation('agents');
  const { showError } = useAlertModalContext();
  const agents = useStore((s) => s.accountAgents);
  const accountAgentsError = useStore((s) => s.accountAgentsError);
  const selection = useStore((s) => s.agentSettingsSelection);
  const definitionTree = useStore((s) => s.definitionTree);
  const definitionReadonly = useStore((s) => s.definitionReadonly);
  const builtinToolPreset = useStore((s) => s.builtinToolPreset);
  const mutatingBuiltinTools = useStore((s) => s.mutatingBuiltinTools);
  const loadAccountAgents = useStore((s) => s.loadAccountAgents);
  const loadDefinitionTree = useStore((s) => s.loadDefinitionTree);
  const definitionTrees = useStore((s) => s.definitionTrees);
  const ensureDefinitionTree = useStore((s) => s.ensureDefinitionTree);
  const selectAgentSettingsNode = useStore((s) => s.selectAgentSettingsNode);
  const openDefinitionFileBuffer = useStore((s) => s.openDefinitionFileBuffer);
  const openDefinitionFile = useStore((s) => s.openDefinitionFile);
  const syncComposerAgents = useStore((s) => s.syncComposerAgents);
  const promoteAgent = useStore((s) => s.promoteAgent);
  const openRequest = useStore((s) => s.agentSettingsOpenRequest);
  const clearAgentSettingsOpenRequest = useStore((s) => s.clearAgentSettingsOpenRequest);
  const isTeamActive = useStore(selectIsTeamActive);

  const [error, setError] = useState<string | null>(null);
  // Right→tree sync: the file the user last addressed (tree click or card
  // interaction); cleared whenever the selection changes.
  const [treeFocusPath, setTreeFocusPath] = useState<string | null>(null);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);
  const [jobValid, setJobValid] = useState<boolean | null>(null);
  const [dangerArmed, setDangerArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { width: treeWidth, isResizing, startResize } = useResizableWidth();

  useEffect(() => {
    void loadAccountAgents();
  }, [loadAccountAgents]);

  /**
   * Definition files have no watcher and no SSE channel, and the per-agent
   * trees are lazy-loaded ONCE — so an out-of-band edit (editor, CLI, git
   * pull) would stay invisible. Re-reading every loaded tree is a cheap GET
   * (the loader caches nothing), so the screen re-reads on its own instead of
   * carrying a refresh button. Reads the map through getState() so the
   * callback identity survives every tree refresh.
   */
  const refreshTrees = useCallback(() => {
    for (const agentId of Object.keys(useStore.getState().definitionTrees)) void loadDefinitionTree(agentId);
  }, [loadDefinitionTree]);

  // Window wake = the moment an external edit becomes observable. `focus` can
  // fire in bursts (focus + visibilitychange for one tab switch), so coalesce.
  const lastWakeRef = useRef(0);
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastWakeRef.current < 1000) return;
      lastWakeRef.current = now;
      void loadAccountAgents();
      refreshTrees();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [loadAccountAgents, refreshTrees]);

  useEffect(() => {
    setTreeFocusPath(null);
  }, [selection.agentId, selection.jobId, selection.intentId]);

  const selectedAgent = agents.find((a) => a.id === selection.agentId);
  const selectedJob = selectedAgent?.jobs.find((j) => j.id === selection.jobId);
  const readonly = definitionReadonly || (selectedAgent?.readonly ?? false);
  const level: DetailLevel = selection.intentId ? 'intent' : selection.jobId ? 'job' : 'agent';

  // agent level → agent.yaml · job/intent level → job.yaml + every intent's
  // file pair. The id list is value-memoized (joined string) so tree object
  // refreshes with identical content never reset the doc buffers.
  const intentIdsKey = useMemo(
    () => intentDirsUnder(definitionTree, selection.jobId).join(','),
    [definitionTree, selection.jobId],
  );
  const intentIds = useMemo(() => intentIdsKey.split(',').filter(Boolean), [intentIdsKey]);
  const docs = useDefinitionDocs(selection.agentId, selection.jobId, intentIds);

  // Hook-editor picker vocabulary: every extension channel's server names are
  // job ∪ agent (H8's satisfiability set) — agent.yaml is fetched read-only,
  // never as a buffer.
  const agentServers = useAgentExtensionServers(selection.jobId ? selection.agentId : undefined);
  const extensionServers = useMemo<ExtensionServers>(
    () => ({
      mcp: Array.from(new Set([...Object.keys(docs.mcpServers), ...agentServers.mcp])).sort(),
      api: Array.from(new Set([...Object.keys(docs.apiServers), ...agentServers.api])).sort(),
    }),
    [docs.mcpServers, docs.apiServers, agentServers],
  );

  // Wire the standalone validate endpoint: shows the definition's
  // load-validity for the selected job as a status pill.
  useEffect(() => {
    setJobValid(null);
    setLastWarnings([]);
    setError(null);
    setDangerArmed(false);
    if (!selection.agentId || !selection.jobId) return;
    let cancelled = false;
    validateAccountAgentJob(selection.agentId, selection.jobId)
      .then((v) => !cancelled && setJobValid(v.valid))
      .catch(() => !cancelled && setJobValid(false));
    return () => {
      cancelled = true;
    };
  }, [selection.agentId, selection.jobId]);

  const afterMutation = useCallback(async () => {
    await loadAccountAgents();
    syncComposerAgents();
  }, [loadAccountAgents, syncComposerAgents]);

  const wrap = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  // ── tree handlers (create + upload only) ───────────────────────────────────

  const handleCreateAgent = (id: string, name: string) =>
    wrap(async () => {
      await createAccountAgent({ id, name });
      await afterMutation();
      selectAgentSettingsNode(id);
    });

  const handleCreateJob = (agentId: string, id: string, name: string) =>
    wrap(async () => {
      await createAccountAgentJob(agentId, { id, name });
      await afterMutation();
      selectAgentSettingsNode(agentId, id);
    });

  const reportSkipped = useCallback(
    (skipped: Array<{ path: string; reason: string }>) => {
      if (skipped.length === 0) return;
      setError(
        t('import.skipped', 'Imported with {{count}} skipped file(s): ', { count: skipped.length }) +
          skipped.map((s) => `${s.path} (${s.reason})`).join(', '),
      );
    },
    [t],
  );

  /** Post-upload convergence: tree, agent list, and the job's load-validity pill. */
  const afterDefinitionWrite = useCallback(
    async (agentId: string) => {
      await loadDefinitionTree(agentId);
      await afterMutation();
      if (agentId === selection.agentId && selection.jobId) {
        validateAccountAgentJob(agentId, selection.jobId)
          .then((v) => setJobValid(v.valid))
          .catch(() => setJobValid(false));
      }
    },
    [loadDefinitionTree, afterMutation, selection.agentId, selection.jobId],
  );

  // ── uploads (file view: loose files · structure view: unit folders) ─────────

  const doUploadFiles = useCallback(
    (_dirPath: string, entries: UploadFileEntry[], ctx?: { agentId?: string }) => {
      const agentId = ctx?.agentId;
      if (!agentId) return;
      void wrap(async () => {
        const result = await uploadDefinitionFiles(agentId, entries);
        reportSkipped(result.skipped);
        await afterDefinitionWrite(agentId);
      });
    },
    [wrap, reportSkipped, afterDefinitionWrite],
  );

  // Copies are off here: `infer (1).md` is outside the definition whitelist, so
  // "keep both" would be silently skipped by the server.
  const { requestUpload, modalProps: conflictModalProps } = useUploadConflicts<{
    tree?: FileNode[] | null;
    agentId?: string;
  }>({ upload: doUploadFiles, allowCopy: false });

  const handleUploadFiles = (agentId: string, files: FileList, dirPath: string) =>
    wrap(async () => {
      // Re-read rather than `ensure`: the overwrite prompt is only as honest as
      // the tree it compares against.
      await loadDefinitionTree(agentId);
      const tree = (useStore.getState().definitionTrees[agentId]?.tree ?? []) as unknown as FileNode[];
      requestUpload(
        dirPath,
        Array.from(files).map((f) => ({ file: f, relativePath: dirPath ? `${dirPath}/${f.name}` : f.name })),
        { tree, agentId },
      );
    });

  /** job / intent FOLDER upload — same-id lands on the replace confirm below. */
  const [pendingReplace, setPendingReplace] = useState<{
    agentId: string;
    dest: string;
    entries: UploadFileEntry[];
    label: string;
  } | null>(null);

  const uploadUnitFolder = (agentId: string, dest: string, entries: UploadFileEntry[]) =>
    wrap(async () => {
      const result = await uploadDefinitionFiles(agentId, entries, { replaceDir: dest });
      reportSkipped(result.skipped);
      await afterDefinitionWrite(agentId);
    });

  const handleUploadUnitFolder = async (
    unit: 'job' | 'intent',
    agentId: string,
    jobId: string | undefined,
    files: FileList,
  ) => {
    const picked = pickedFolderName(files);
    if (!picked || !isValidCustomId(picked)) {
      setError(t('import.badFolderName', 'Upload exactly one folder whose name is the id ([a-z0-9-]).'));
      return;
    }
    if (unit === 'intent' && !jobId) return;
    const dest = unit === 'job' ? `jobs/${picked}` : `jobs/${jobId}/intents/${picked}`;
    const entries = entriesUnder(files, dest);
    const required = unit === 'job' ? `${dest}/job.yaml` : `${dest}/infer.md`;
    if (!hasEntry(entries, required)) {
      setError(
        unit === 'job'
          ? t('import.missingJobYaml', 'The job folder must contain job.yaml at its root.')
          : t('import.missingInferMd', 'The intent folder must contain infer.md at its root.'),
      );
      return;
    }
    await loadDefinitionTree(agentId);
    const tree = useStore.getState().definitionTrees[agentId]?.tree ?? [];
    if (findDefinitionNode(tree, dest)) {
      setPendingReplace({ agentId, dest, entries, label: dest });
      return;
    }
    await uploadUnitFolder(agentId, dest, entries);
  };

  /**
   * Promotion is a MOVE into the org. The PromoteZone card owns the confirm
   * dialog; failures land in the detail error strip via `wrap` — a promote
   * that silently no-ops is exactly the bug this screen must not reproduce.
   */
  const handlePromoteAgent = (agentId: string) =>
    wrap(async () => {
      setIsPromoting(true);
      try {
        await promoteAgent(agentId);
      } finally {
        setIsPromoting(false);
      }
    });

  /**
   * Folder export — a read; offered for every scope, readonly agents included.
   * A refusal goes to the global alert, not to `wrap`'s detail-pane strip: the
   * row's ⋯ menu does not select the agent, so that strip may not be mounted.
   */
  const handleDownloadAgent = async (agentId: string) => {
    try {
      await downloadAgentFolder(agentId);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const [pendingImport, setPendingImport] = useState<{ entries: UploadFileEntry[]; agentId: string } | null>(null);

  const importFolder = (entries: UploadFileEntry[], overwrite?: boolean) =>
    wrap(async () => {
      const result = await importAgentFolder(entries, overwrite ? { overwrite: true } : undefined);
      await afterMutation();
      reportSkipped(result.skipped);
      if (result.agentId) {
        selectAgentSettingsNode(result.agentId);
        await loadDefinitionTree(result.agentId);
      }
    });

  const handleImportFolder = async (files: FileList) => {
    const entries = fileListToEntries(files);
    const picked = pickedFolderName(files);
    const existing = picked ? agents.find((a) => a.id === picked) : undefined;
    if (existing && existing.scope !== 'user') {
      setError(
        t('import.conflictReadonly', 'Agent id "{{id}}" is taken by a read-only agent — rename the folder.', {
          id: picked,
        }),
      );
      return;
    }
    if (existing && picked) {
      setPendingImport({ entries, agentId: picked });
      return;
    }
    await importFolder(entries);
  };

  // ── detail handlers ────────────────────────────────────────────────────────

  /**
   * All three levels delete a DIRECTORY (immediate, irreversible) — the
   * intent one removes `intents/{id}/` through the definition-file endpoint.
   * The only draft-side case is an unsaved phantom intent, which just drops
   * its buffers.
   */
  const handleDangerAction = async () => {
    if (!selection.agentId) return;
    if (!dangerArmed) {
      setDangerArmed(true);
      return;
    }
    if (selection.intentId && selection.jobId && docs.isPhantomIntent(selection.intentId)) {
      docs.dropIntentDraft(selection.intentId);
      setDangerArmed(false);
      selectAgentSettingsNode(selection.agentId, selection.jobId);
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      if (selection.intentId && selection.jobId) {
        await deleteDefinitionFile(selection.agentId, `jobs/${selection.jobId}/intents/${selection.intentId}`);
        await loadDefinitionTree(selection.agentId);
        await afterMutation();
        selectAgentSettingsNode(selection.agentId, selection.jobId);
      } else if (selection.jobId) {
        await deleteAccountAgentJob(selection.agentId, selection.jobId);
        await afterMutation();
        selectAgentSettingsNode(selection.agentId);
      } else {
        await deleteAccountAgent(selection.agentId);
        await afterMutation();
        selectAgentSettingsNode(undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsDeleting(false);
      setDangerArmed(false);
    }
  };

  const handleSave = async () => {
    if (docs.hasParseError) {
      setError(t('overview.fixYaml', 'Fix the YAML syntax error before saving.'));
      return;
    }
    if (docs.intentErrors.length > 0) {
      setError(t('overview.fixIntents', 'Fix the intent catalog issues before saving.'));
      return;
    }
    if (docs.mcpErrors.length > 0) {
      setError(t('overview.fixMcp', 'Fix the MCP server issues before saving.'));
      return;
    }
    setError(null);
    try {
      const result = await docs.save();
      setLastWarnings(result?.warnings ?? []);
      await afterMutation();
      // A phantom intent's directory is created by this save — the tree that
      // `intentIds` derives from must follow, or the new intent exists in
      // neither the tree nor the doc buffers. Identical trees are a no-op
      // (intentIdsKey is value-memoized), so this never resets live buffers.
      if (selection.agentId) await loadDefinitionTree(selection.agentId);
      if (selection.agentId && selection.jobId) {
        validateAccountAgentJob(selection.agentId, selection.jobId)
          .then((v) => setJobValid(v.valid))
          .catch(() => setJobValid(false));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Structural move (definition dir + workspace data) — re-selects under the new id. */
  const handleRenameAgentId = (newId: string) =>
    wrap(async () => {
      if (!selection.agentId) return;
      await renameAccountAgentId(selection.agentId, newId);
      await afterMutation();
      selectAgentSettingsNode(newId);
      await loadDefinitionTree(newId);
    });

  /** Same structural move as the agent id, one level down. */
  const handleRenameJobId = (newId: string) =>
    wrap(async () => {
      if (!selection.agentId || !selection.jobId) return;
      await renameAccountAgentJobId(selection.agentId, selection.jobId, newId);
      await afterMutation();
      selectAgentSettingsNode(selection.agentId, newId);
      await loadDefinitionTree(selection.agentId);
    });

  /**
   * Structural move like the agent/job ids: the server renames the
   * `intents/{id}/` directory — a PURE fs move, since no file declares the
   * id (create+delete would trip the structural-file rules and lose data on
   * mid-sequence failure).
   */
  const handleRenameIntentId = (newId: string) =>
    wrap(async () => {
      if (!selection.agentId || !selection.jobId || !selection.intentId) return;
      await renameDefinitionFile(selection.agentId, `jobs/${selection.jobId}/intents/${selection.intentId}`, newId);
      await loadDefinitionTree(selection.agentId);
      await afterMutation();
      selectAgentSettingsNode(selection.agentId, selection.jobId, newId);
    });

  /**
   * New intents are phantom drafts authored on their own screen — Save
   * materializes the files. A tree-initiated create can name a job that is not
   * selected yet, so the draft waits for that job's docs to load.
   */
  const [pendingIntentDraft, setPendingIntentDraft] = useState<{
    agentId: string;
    jobId: string;
    intentId: string;
  } | null>(null);

  const handleCreateIntent = (agentId: string, jobId: string, intentId: string) => {
    setPendingIntentDraft({ agentId, jobId, intentId });
    selectAgentSettingsNode(agentId, jobId, intentId);
  };

  useEffect(() => {
    if (!pendingIntentDraft || !docs.loaded) return;
    if (pendingIntentDraft.agentId !== selection.agentId || pendingIntentDraft.jobId !== selection.jobId) return;
    docs.addIntent(pendingIntentDraft.intentId);
    setPendingIntentDraft(null);
  }, [pendingIntentDraft, docs, selection.agentId, selection.jobId]);

  const handleCreateDefinitionFile = (agentId: string, path: string) =>
    wrap(async () => {
      await createDefinitionFile(agentId, path);
      await afterDefinitionWrite(agentId);
      handleOpenTreeFile(agentId, path);
    });

  const handleCreateDefinitionDir = (agentId: string, path: string) =>
    wrap(async () => {
      await createDefinitionDir(agentId, path);
      await afterDefinitionWrite(agentId);
    });

  /**
   * Scroll to a card once it EXISTS. Two frames were not enough: a click on
   * another agent's file remounts the right pane behind an async doc load, so
   * the card appears several frames later. Polls per frame, bounded — the bound
   * covers the slowest path, an external deep link opening this screen cold
   * (tree fetch → intent doc fetch → cards render); it stops the frame the card
   * appears, so a generous bound costs nothing on the warm paths.
   */
  const scrollToCard = (cardId: string) => {
    let frames = 90;
    const tick = () => {
      const el = document.getElementById(cardId);
      if (el) {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (frames-- > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /**
   * Tree→right navigation (both tree views): every mapped file selects the
   * owning level and scrolls to its card; prose opens in the Prompts editor
   * AFTER the selection settles (selection changes clear the open buffer).
   * Clicking a file of a non-selected agent switches agents too.
   */
  const handleOpenTreeFile = (agentId: string, path: string) => {
    const target = classifyDefinitionPath(path);
    if (target.kind === 'other') return;
    // Selection changes clear treeFocusPath (effect above) — re-arm it after.
    const arm = () => setTreeFocusPath(path);
    if (target.kind === 'agent-yaml') {
      selectAgentSettingsNode(agentId);
    } else if (target.kind === 'job-dir' || target.kind === 'job-yaml' || target.kind === 'intents-dir') {
      selectAgentSettingsNode(agentId, target.jobId);
    } else if (
      target.kind === 'intent-dir' ||
      target.kind === 'intent-infer' ||
      target.kind === 'intent-prompt' ||
      target.kind === 'intent-hooks'
    ) {
      selectAgentSettingsNode(agentId, target.jobId, target.intentId);
    } else if (target.kind === 'prose' || target.kind === 'on-demand') {
      selectAgentSettingsNode(agentId, target.jobId);
      void openDefinitionFileBuffer(agentId, path);
    }
    requestAnimationFrame(arm);
    const card = CARD_OF_KIND[target.kind];
    if (card) scrollToCard(card);
  };

  /**
   * External navigation (the universal actions tab's "open in Agent Settings"
   * links): honored through the same tree→right path so the level selection and
   * the card scroll cannot diverge from a tree click's behaviour. One-shot —
   * cleared immediately, so re-opening the tab does not re-navigate.
   */
  useEffect(() => {
    if (!openRequest) return;
    handleOpenTreeFile(openRequest.agentId, openRequest.path);
    clearAgentSettingsOpenRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  /**
   * The tree row to highlight: the last explicitly addressed file, else the
   * open prose buffer, else the selection level's identity file (intent →
   * infer.md, job → job.yaml, agent → agent.yaml).
   */
  const selectedFilePath =
    treeFocusPath ??
    openDefinitionFile?.path ??
    (level === 'intent'
      ? `jobs/${selection.jobId}/intents/${selection.intentId}`
      : level === 'job'
        ? `jobs/${selection.jobId}/job.yaml`
        : 'agent.yaml');

  /** Card→tree sync: interacting with a mapped card highlights its file. */
  const focusFile = (path: string) => () => setTreeFocusPath(path);

  const overviewCtx: OverviewCtx | null =
    selection.agentId && docs.loaded
      ? {
          level,
          readonly,
          docs,
          builtinToolPreset,
          mutatingBuiltinTools,
          extensionServers,
        }
      : null;

  const headerStatus = readonly ? (
    <StatusPill state="not-configured" label={t('detail.readonly', 'read-only')} />
  ) : selection.jobId && jobValid != null ? (
    <StatusPill
      state={jobValid ? 'configured' : 'error'}
      label={jobValid ? t('detail.valid', 'loads OK') : t('detail.invalid', 'fails to load')}
    />
  ) : undefined;

  // The Prompts card is base/*.md prose — an agent/job surface only. The
  // intent level's prose is its own prompt.md card.
  const promptsScope: PromptsScope | null = !selection.agentId
    ? null
    : level === 'agent'
      ? { level: 'agent' }
      : { level: 'job', jobId: selection.jobId! };

  const dangerCopy = {
    agent: {
      title: t('danger.agentTitle', 'Delete this agent'),
      desc: t('danger.agentDesc', 'Removes the whole agent directory, every job included. This cannot be undone.'),
      button: t('danger.agentButton', 'Delete agent'),
    },
    job: {
      title: t('danger.jobTitle', 'Delete this job'),
      desc: t('danger.jobDesc', 'Removes the job directory (definition files included). The session history of past runs is not touched.'),
      button: t('danger.jobButton', 'Delete job'),
    },
    intent: {
      title: t('danger.intentTitle', 'Delete this intent'),
      desc: t('danger.intentDesc', 'Removes the intent directory (infer.md, prompt.md, hooks.yaml). An unsaved intent just drops its draft.'),
      button: t('danger.intentButton', 'Delete intent'),
    },
  }[level];

  const detailReady = !!selection.agentId && overviewCtx != null;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        background: 'var(--bg-canvas)',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* left — resizable agent › job › intent tree */}
      <div className="relative shrink-0" style={{ width: treeWidth, borderRight: '1px solid var(--border-1)' }}>
        <AgentTree
          agents={agents}
          selection={selection}
          onSelect={selectAgentSettingsNode}
          onCreateAgent={handleCreateAgent}
          onCreateJob={handleCreateJob}
          onUploadFiles={handleUploadFiles}
          onImportFolder={handleImportFolder}
          onUploadUnitFolder={handleUploadUnitFolder}
          onCreateIntent={handleCreateIntent}
          onCreateFile={handleCreateDefinitionFile}
          onCreateDir={handleCreateDefinitionDir}
          onDownloadAgent={handleDownloadAgent}
          isTeamActive={isTeamActive}
          loadError={accountAgentsError}
          onRetryLoad={() => void loadAccountAgents()}
          definitionTrees={definitionTrees}
          onEnsureTree={(agentId) => void ensureDefinitionTree(agentId)}
          onOpenFile={handleOpenTreeFile}
          onRefreshTrees={refreshTrees}
          selectedFilePath={selection.agentId ? selectedFilePath : null}
          selectedFileAgentId={selection.agentId ?? null}
        />
        {/* drag handle: 4px hit area on the border */}
        <div
          className="absolute top-0 right-0 h-full"
          style={{
            width: 4,
            marginRight: -2,
            cursor: 'ew-resize',
            zIndex: 10,
            background: isResizing ? 'var(--violet-400)' : 'transparent',
          }}
          onMouseDown={startResize}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = 'var(--violet-400)';
          }}
          onMouseLeave={(e) => {
            if (!isResizing) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          }}
        />
      </div>

      {/* right — canonical settings scroller */}
      {detailReady && overviewCtx ? (
        <div ref={scrollerRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              padding: '20px 24px 40px',
            }}
          >
            <DetailHeader
              level={level}
              agentName={selectedAgent?.name ?? selection.agentId!}
              jobName={selection.jobId ? (selectedJob?.name ?? selection.jobId) : undefined}
              intentId={selection.intentId}
              onSelectAgent={() => selectAgentSettingsNode(selection.agentId)}
              onSelectJob={() => selectAgentSettingsNode(selection.agentId, selection.jobId)}
              status={headerStatus}
            />

            {!readonly && (
              <ChangedBar
                hasChanges={docs.dirtyCount > 0}
                isSaving={docs.isSaving}
                count={docs.dirtyCount}
                onSave={() => void handleSave()}
                onDiscard={docs.discard}
              />
            )}

            {error && (
              <div
                className="text-xs rounded-md px-3 py-2"
                style={{ background: 'var(--status-error-bg, var(--bg-surface-2))', color: 'var(--status-error-fg, var(--text-2))' }}
              >
                {error}
              </div>
            )}
            {lastWarnings.length > 0 && (
              <div
                className="text-xs rounded-md px-3 py-2 flex flex-col gap-0.5"
                style={{ background: 'var(--bg-surface-2)', color: 'var(--text-3)' }}
              >
                <span>{t('prompts.validationWarnings', 'Saved with warnings — affected jobs will fail to load until fixed:')}</span>
                {lastWarnings.map((w, i) => (
                  <span key={i} className="font-mono">{w}</span>
                ))}
              </div>
            )}

            {level === 'agent' && (
              <div onClickCapture={focusFile('agent.yaml')}>
                <AgentDefinitionCard
                  ctx={overviewCtx}
                  id="c3g-agent"
                  agentId={selection.agentId!}
                  onRenameId={handleRenameAgentId}
                />
              </div>
            )}
            {level === 'agent' && selectedAgent?.org?.canManageEditors && (
              <OrgAccessCard
                id="c3g-org-access"
                resourceId={selection.agentId!}
                org={selectedAgent.org}
                onSaveEditors={(editors) => updateAgentEditors(selection.agentId!, editors)}
                onSaved={afterMutation}
                onError={setError}
              />
            )}
            {level === 'intent' && selection.intentId && (
              <div onClickCapture={focusFile(`jobs/${selection.jobId}/intents/${selection.intentId}`)}>
                <IntentIdentityCard
                  ctx={overviewCtx}
                  id="c3g-intent"
                  jobId={selection.jobId!}
                  intentId={selection.intentId}
                  onRenameId={handleRenameIntentId}
                />
              </div>
            )}
            {level === 'intent' && selection.intentId && (
              <div onClickCapture={focusFile(`jobs/${selection.jobId}/intents/${selection.intentId}/infer.md`)}>
                <IntentDetailCard
                  ctx={overviewCtx}
                  id="c3g-intent-criteria"
                  intentId={selection.intentId}
                  onBackToJob={() => selectAgentSettingsNode(selection.agentId, selection.jobId)}
                />
              </div>
            )}
            {level === 'intent' && selection.intentId && (
              <div onClickCapture={focusFile(`jobs/${selection.jobId}/intents/${selection.intentId}/prompt.md`)}>
                <IntentPromptCard ctx={overviewCtx} id="c3g-intent-prompt" intentId={selection.intentId} />
              </div>
            )}
            {level === 'intent' && selection.intentId && (
              <div onClickCapture={focusFile(`jobs/${selection.jobId}/intents/${selection.intentId}/hooks.yaml`)}>
                <IntentHooksCard ctx={overviewCtx} id="c3g-intent-hooks" intentId={selection.intentId} />
              </div>
            )}
            {level === 'job' && (
              <div onClickCapture={focusFile(`jobs/${selection.jobId}/job.yaml`)}>
                <JobDefinitionCard
                  ctx={overviewCtx}
                  id="c3g-tools"
                  jobId={selection.jobId!}
                  onRenameId={handleRenameJobId}
                />
              </div>
            )}
            {level === 'job' && (
              <div onClickCapture={focusFile(`jobs/${selection.jobId}/intents`)}>
                <IntentsCard
                  ctx={overviewCtx}
                  id="c3g-intents"
                  onSelectIntent={(intentId) => selectAgentSettingsNode(selection.agentId, selection.jobId, intentId)}
                  onCreateIntent={(intentId) =>
                    handleCreateIntent(selection.agentId!, selection.jobId!, intentId)
                  }
                />
              </div>
            )}
            {level !== 'intent' && promptsScope && (
              <PromptsCard
                id="c3g-prompts"
                agentId={selection.agentId!}
                readonly={readonly}
                scope={promptsScope}
              />
            )}
            {level === 'agent' && isTeamActive && selectedAgent?.scope === 'user' && (
              <PromoteZone
                id="c3g-promote"
                resourceName={selectedAgent?.name ?? selection.agentId!}
                isPromoting={isPromoting}
                onPromote={() => void handlePromoteAgent(selection.agentId!)}
              />
            )}
            {!readonly && (
              <div id="c3g-danger">
                <DangerZone
                  title={dangerCopy.title}
                  description={dangerCopy.desc}
                  buttonText={dangerArmed ? t('danger.confirm', 'Click again to confirm') : dangerCopy.button}
                  loadingText={t('danger.deleting', 'Deleting…')}
                  isLoading={isDeleting}
                  onAction={() => void handleDangerAction()}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-1.5 px-6 text-center"
          style={{ color: 'var(--text-4)' }}
        >
          <span className="text-sm">{t('detail.selectAgent', 'Select an agent, job, or intent on the left')}</span>
          <span className="text-xs" style={{ maxWidth: PROSE_MEASURE, lineHeight: 1.6 }}>
            {t('detail.emptyHint', 'Built-in agents are read-only — create an agent of your own with the + button on the left.')}
          </span>
        </div>
      )}

      <UploadConflictModal {...conflictModalProps} />

      <UploadConflictModal
        isOpen={pendingReplace != null}
        conflictingFiles={pendingReplace ? [pendingReplace.label] : []}
        allowCopy={false}
        title={t('import.replaceTitle', 'Already exists')}
        message={t(
          'import.replaceMessage',
          'This directory already exists. Overwriting REPLACES its definition files — anything not in the upload is removed.',
        )}
        onClose={() => setPendingReplace(null)}
        onResolve={(resolution) => {
          const target = pendingReplace;
          setPendingReplace(null);
          if (resolution === 'cancel' || !target) return;
          void uploadUnitFolder(target.agentId, target.dest, target.entries);
        }}
      />

      <UploadConflictModal
        isOpen={pendingImport != null}
        conflictingFiles={pendingImport ? [pendingImport.agentId] : []}
        allowCopy={false}
        title={t('import.replaceAgentTitle', 'Agent already exists')}
        message={t(
          'import.replaceAgentMessage',
          'An agent with this id already exists. Overwriting REPLACES its definition files; past session data is left untouched.',
        )}
        onClose={() => setPendingImport(null)}
        onResolve={(resolution) => {
          const target = pendingImport;
          setPendingImport(null);
          if (resolution === 'cancel' || !target) return;
          void importFolder(target.entries, true);
        }}
      />
    </div>
  );
}
