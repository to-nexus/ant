import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { ChangedBar, DangerZone, StatusPill } from '@/presentation/components/ConfigEditor/aurora';
import {
  createAccountAgent,
  createAccountAgentJob,
  deleteAccountAgent,
  deleteAccountAgentJob,
  importAgentFolder,
  renameAccountAgentId,
  renameAccountAgentJobId,
  uploadDefinitionFiles,
  validateAccountAgentJob,
} from '@/infrastructure/http/api/accountAgents';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { AgentTree } from './AgentTree';
import { DetailHeader, type DetailLevel } from './DetailHeader';
import { PromptsCard, type PromptsScope } from './prompts/PromptsCard';
import { useResizableWidth } from './useResizableWidth';
import { IntentsCard, JobDefinitionCard, type OverviewCtx } from './overview/sections';
import { AgentDefinitionCard } from './overview/AgentDefinitionCard';
import { IntentDetailCard } from './overview/IntentDetailCard';
import { useDefinitionDocs } from './overview/useDefinitionDocs';

/**
 * Agent Settings — account-scoped standalone screen (profile menu → main
 * panel tab, D-G). Works WITHOUT a selected project: everything reads
 * `/api/account/agents`.
 *
 * Layout: left resizable agent › job › intent tree, right single scroller
 * with a breadcrumb DetailHeader, stacked SectionCards, and one sticky
 * ChangedBar driving save/discard.
 *
 * Ownership: every definition yaml belongs to exactly one card, which shows
 * it as a structured form OR as raw YAML over the SAME buffer (see
 * `useDefinitionDocs`) — agent.yaml → AgentDefinitionCard, job.yaml →
 * JobDefinitionCard, intents.yaml → IntentsCard. The tree only creates and
 * navigates; renaming (both the display name and the id) is the card's job and
 * deleting is the Danger Zone, so no file has two writers. The Prompts card is
 * prose (.md) only.
 *
 * The id is editable at ALL THREE levels, on one rule. agentId and jobId are
 * directory names, so each is a structural move done by its own endpoint
 * (definition dir + the container data keyed by it) through the shared
 * `IdRenameField`; an intentId owns no directory, so it is a catalog edit that
 * rides the ChangedBar like every other intents.yaml change.
 *
 * Unlike the other settings shells this screen has NO TocNav rail — its card
 * count is small and the left tree is already the navigation surface, so a
 * second sticky rail only narrowed the cards. `ChangedBar.dirtyCount` carries
 * the dirty signal the rail's per-item dots used to.
 */

function collectFilePaths(nodes: CustomAgentDefinitionFileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path);
    if (n.children) collectFilePaths(n.children, out);
  }
  return out;
}

function injectionFilesUnder(tree: CustomAgentDefinitionFileNode[], prefix: string): string[] {
  return collectFilePaths(tree)
    .filter((p) => p.startsWith(prefix) && p.endsWith('.md') && !p.slice(prefix.length).includes('/'))
    .map((p) => p.slice(prefix.length));
}

// AccountConfigEditor precedent: the main-panel tab bar owns close — the
// prop is accepted for mount-site compatibility and deliberately unused.
export function AgentSettings({ onClose: _onClose }: { onClose?: () => void }) {
  const { t } = useTranslation('agents');
  const agents = useStore((s) => s.accountAgents);
  const accountAgentsError = useStore((s) => s.accountAgentsError);
  const selection = useStore((s) => s.agentSettingsSelection);
  const definitionTree = useStore((s) => s.definitionTree);
  const definitionReadonly = useStore((s) => s.definitionReadonly);
  const builtinToolPreset = useStore((s) => s.builtinToolPreset);
  const mutatingBuiltinTools = useStore((s) => s.mutatingBuiltinTools);
  const loadAccountAgents = useStore((s) => s.loadAccountAgents);
  const loadDefinitionTree = useStore((s) => s.loadDefinitionTree);
  const selectAgentSettingsNode = useStore((s) => s.selectAgentSettingsNode);
  const syncComposerAgents = useStore((s) => s.syncComposerAgents);

  const [error, setError] = useState<string | null>(null);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);
  const [jobValid, setJobValid] = useState<boolean | null>(null);
  const [dangerArmed, setDangerArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { width: treeWidth, isResizing, startResize } = useResizableWidth();

  useEffect(() => {
    void loadAccountAgents();
  }, [loadAccountAgents]);

  const selectedAgent = agents.find((a) => a.id === selection.agentId);
  const selectedJob = selectedAgent?.jobs.find((j) => j.id === selection.jobId);
  const readonly = definitionReadonly || (selectedAgent?.readonly ?? false);
  const level: DetailLevel = selection.intentId ? 'intent' : selection.jobId ? 'job' : 'agent';

  // agent level → agent.yaml · job/intent level → the job's yaml pair.
  const docs = useDefinitionDocs(selection.agentId, selection.jobId);

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

  const handleUploadFiles = (agentId: string, files: FileList, pathPrefix: string) =>
    wrap(async () => {
      const result = await uploadDefinitionFiles(
        agentId,
        Array.from(files).map((f) => ({ file: f, relativePath: `${pathPrefix}${f.name}` })),
      );
      if (result.skipped.length > 0) {
        setError(
          t('import.skipped', 'Imported with {{count}} skipped file(s): ', { count: result.skipped.length }) +
            result.skipped.map((s) => s.path).join(', '),
        );
      }
      if (selection.agentId === agentId) await loadDefinitionTree(agentId);
    });

  const handleImportFolder = (files: FileList) =>
    wrap(async () => {
      const entries = Array.from(files).map((f) => ({
        file: f,
        relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      }));
      const result = await importAgentFolder(entries);
      await afterMutation();
      if (result.skipped.length > 0) {
        setError(
          t('import.skipped', 'Imported with {{count}} skipped file(s): ', { count: result.skipped.length }) +
            result.skipped.map((s) => s.path).join(', '),
        );
      }
      if (result.agentId) selectAgentSettingsNode(result.agentId);
    });

  // ── detail handlers ────────────────────────────────────────────────────────

  /**
   * Agent/job deletion removes a directory (immediate, irreversible); intent
   * deletion is a catalog edit, so it lands in the document and the ChangedBar
   * confirms it — same funnel as every other intents.yaml change.
   */
  const handleDangerAction = async () => {
    if (!selection.agentId) return;
    if (!dangerArmed) {
      setDangerArmed(true);
      return;
    }
    if (selection.intentId && selection.jobId) {
      docs.removeIntent(selection.intentId);
      setDangerArmed(false);
      selectAgentSettingsNode(selection.agentId, selection.jobId);
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      if (selection.jobId) {
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

  /** Catalog edit (not a move) — the ChangedBar confirms it into intents.yaml. */
  const handleRenameIntentId = (newId: string) => {
    if (!selection.intentId) return;
    docs.renameIntent(selection.intentId, newId);
    selectAgentSettingsNode(selection.agentId, selection.jobId, newId);
  };

  /** New intents are authored on their own screen — the criteria start empty. */
  const handleCreateIntent = (intentId: string) => {
    docs.addIntent(intentId);
    selectAgentSettingsNode(selection.agentId, selection.jobId, intentId);
  };

  // ── injection ↔ intent binding maps (Prompts card, job-only model) ─────────
  const jobInjectionFiles = useMemo(
    () => (selection.jobId ? injectionFilesUnder(definitionTree, `jobs/${selection.jobId}/injections/`) : []),
    [definitionTree, selection.jobId],
  );

  const intentBindings = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!selection.jobId) return map;
    for (const entry of docs.intents) {
      for (const f of entry.injections ?? []) {
        if (jobInjectionFiles.includes(f)) {
          (map[`jobs/${selection.jobId}/injections/${f}`] ??= []).push(entry.id);
        }
      }
    }
    return map;
  }, [docs.intents, jobInjectionFiles, selection.jobId]);

  const bindableIntentIds = useCallback(
    (path: string): string[] => {
      if (!selection.jobId) return [];
      if (!path.startsWith(`jobs/${selection.jobId}/injections/`)) return [];
      const fileName = path.split('/').pop() ?? '';
      return docs.intents
        .filter((e) => e.id.length > 0 && !(e.injections ?? []).includes(fileName))
        .map((e) => e.id);
    },
    [docs.intents, selection.jobId],
  );

  const handleBind = useCallback(
    (intentId: string, path: string) => {
      const fileName = path.split('/').pop() ?? '';
      const entry = docs.intents.find((e) => e.id === intentId);
      if (!entry) return;
      docs.updateIntent(intentId, { injections: [...(entry.injections ?? []), fileName] });
    },
    [docs],
  );

  const handleUnbind = useCallback(
    (intentId: string, path: string) => {
      const fileName = path.split('/').pop() ?? '';
      const entry = docs.intents.find((e) => e.id === intentId);
      if (!entry) return;
      docs.updateIntent(intentId, { injections: (entry.injections ?? []).filter((f) => f !== fileName) });
    },
    [docs],
  );

  /** Intent scope: bind an existing (or freshly created) injections file to the selected intent. */
  const bindToSelectedIntent = useCallback(
    (fileName: string) => {
      if (!selection.intentId) return;
      const entry = docs.intents.find((e) => e.id === selection.intentId);
      if (entry && !(entry.injections ?? []).includes(fileName)) {
        docs.updateIntent(selection.intentId, { injections: [...(entry.injections ?? []), fileName] });
      }
    },
    [docs, selection.intentId],
  );

  const overviewCtx: OverviewCtx | null =
    selection.agentId && docs.loaded
      ? {
          level,
          readonly,
          docs,
          builtinToolPreset,
          mutatingBuiltinTools,
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

  const promptsScope: PromptsScope | null = !selection.agentId
    ? null
    : level === 'agent'
      ? { level: 'agent' }
      : level === 'job'
        ? { level: 'job', jobId: selection.jobId! }
        : {
            level: 'intent',
            jobId: selection.jobId!,
            intentInjections:
              docs.intents.find((e) => e.id === selection.intentId)?.injections ?? [],
          };

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
      desc: t('danger.intentDesc', 'Drops the entry from the intents.yaml buffer — confirm it with Save above. Its injection files stay on disk, on-demand only.'),
      button: t('danger.intentButton', 'Delete intent'),
    },
  }[level];

  const detailReady = !!selection.agentId && !!promptsScope && overviewCtx != null;

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
          loadError={accountAgentsError}
          onRetryLoad={() => void loadAccountAgents()}
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
      {detailReady && promptsScope && overviewCtx ? (
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
              <AgentDefinitionCard
                ctx={overviewCtx}
                id="c3g-agent"
                agentId={selection.agentId!}
                onRenameId={handleRenameAgentId}
              />
            )}
            {level === 'intent' && selection.intentId && (
              <IntentDetailCard
                ctx={overviewCtx}
                id="c3g-intent"
                intentId={selection.intentId}
                onBackToJob={() => selectAgentSettingsNode(selection.agentId, selection.jobId)}
                onRenameId={handleRenameIntentId}
              />
            )}
            {level === 'job' && (
              <JobDefinitionCard
                ctx={overviewCtx}
                id="c3g-tools"
                jobId={selection.jobId!}
                onRenameId={handleRenameJobId}
              />
            )}
            {level === 'job' && (
              <IntentsCard
                ctx={overviewCtx}
                id="c3g-intents"
                onSelectIntent={(intentId) => selectAgentSettingsNode(selection.agentId, selection.jobId, intentId)}
                onCreateIntent={handleCreateIntent}
              />
            )}
            <PromptsCard
              id="c3g-prompts"
              agentId={selection.agentId!}
              readonly={readonly}
              scope={promptsScope}
              intentBindings={intentBindings}
              bindableIntentIds={bindableIntentIds}
              onBind={handleBind}
              onUnbind={handleUnbind}
              onCreatedInjection={bindToSelectedIntent}
              onAddExisting={bindToSelectedIntent}
              jobInjectionFiles={jobInjectionFiles}
            />
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
          <span className="text-xs" style={{ maxWidth: 380, lineHeight: 1.6 }}>
            {t('detail.emptyHint', 'Built-in agents are read-only — create an agent of your own with the + button on the left.')}
          </span>
        </div>
      )}
    </div>
  );
}
