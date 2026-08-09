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
  renameAccountAgent,
  renameAccountAgentJob,
  uploadDefinitionFiles,
  validateAccountAgentJob,
} from '@/infrastructure/http/api/accountAgents';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { AgentTree } from './AgentTree';
import { DetailHeader, type DetailLevel } from './DetailHeader';
import { PromptsCard, type PromptsScope } from './prompts/PromptsCard';
import { useResizableWidth } from './useResizableWidth';
import { IntentsCard, ToolsCard, type OverviewCtx } from './overview/sections';
import { IntentDetailCard } from './overview/IntentDetailCard';
import { PromptPreviewCard } from './overview/PromptPreviewCard';
import { useDefinitionDocs } from './overview/useDefinitionDocs';

/**
 * Agent Settings — account-scoped standalone screen (profile menu → main
 * panel tab, D-G). Works WITHOUT a selected project: everything reads
 * `/api/account/agents`.
 *
 * Layout: left resizable agent › job › intent tree, right single scroller
 * with a breadcrumb DetailHeader, stacked SectionCards, and one sticky
 * ChangedBar driving save/discard for the job/intent forms. The agent level
 * has no form drafts (identity lives in base/*.md prose; renames live in the
 * tree kebab), so it renders without docs entirely.
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
  const selection = useStore((s) => s.agentSettingsSelection);
  const definitionTree = useStore((s) => s.definitionTree);
  const definitionReadonly = useStore((s) => s.definitionReadonly);
  const builtinToolPreset = useStore((s) => s.builtinToolPreset);
  const mutatingBuiltinTools = useStore((s) => s.mutatingBuiltinTools);
  const loadAccountAgents = useStore((s) => s.loadAccountAgents);
  const loadDefinitionTree = useStore((s) => s.loadDefinitionTree);
  const selectAgentSettingsNode = useStore((s) => s.selectAgentSettingsNode);
  const createJobIntent = useStore((s) => s.createJobIntent);
  const deleteJobIntent = useStore((s) => s.deleteJobIntent);
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

  // Drafts exist only at job/intent level — the agent level has no form
  // fields left, so it skips the agent.yaml fetch entirely.
  const docs = useDefinitionDocs(selection.jobId ? selection.agentId : undefined, selection.jobId);

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

  // ── tree handlers ──────────────────────────────────────────────────────────

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

  const handleCreateIntent = (agentId: string, jobId: string, intentId: string) =>
    wrap(async () => {
      await createJobIntent(agentId, jobId, intentId);
      if (selection.agentId === agentId) await loadDefinitionTree(agentId);
    });

  const handleRenameAgent = (agentId: string, name: string) =>
    wrap(async () => {
      await renameAccountAgent(agentId, name);
      await afterMutation();
    });

  const handleRenameJob = (agentId: string, jobId: string, name: string) =>
    wrap(async () => {
      await renameAccountAgentJob(agentId, jobId, name);
      await afterMutation();
    });

  const handleDeleteAgent = (agentId: string) =>
    wrap(async () => {
      await deleteAccountAgent(agentId);
      await afterMutation();
      if (selection.agentId === agentId) selectAgentSettingsNode(undefined);
    });

  const handleDeleteJob = (agentId: string, jobId: string) =>
    wrap(async () => {
      await deleteAccountAgentJob(agentId, jobId);
      await afterMutation();
      if (selection.agentId === agentId && selection.jobId === jobId) selectAgentSettingsNode(agentId);
    });

  const handleDeleteIntent = (agentId: string, jobId: string, intentId: string) =>
    wrap(async () => {
      await deleteJobIntent(agentId, jobId, intentId);
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

  const handleDangerAction = async () => {
    if (!selection.agentId) return;
    if (!dangerArmed) {
      setDangerArmed(true);
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      if (selection.intentId && selection.jobId) {
        await deleteJobIntent(selection.agentId, selection.jobId, selection.intentId);
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
    if (docs.intentErrors.length > 0) {
      setError(t('overview.fixIntents', 'Fix the intent catalog issues before saving.'));
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

  // ── injection ↔ intent binding maps (Prompts card, job-only model) ─────────
  const jobInjectionFiles = useMemo(
    () => (selection.jobId ? injectionFilesUnder(definitionTree, `jobs/${selection.jobId}/injections/`) : []),
    [definitionTree, selection.jobId],
  );

  const intentBindings = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!selection.jobId) return map;
    for (const entry of docs.draft?.intents ?? []) {
      for (const f of entry.injections ?? []) {
        if (jobInjectionFiles.includes(f)) {
          (map[`jobs/${selection.jobId}/injections/${f}`] ??= []).push(entry.id);
        }
      }
    }
    return map;
  }, [docs.draft?.intents, jobInjectionFiles, selection.jobId]);

  const bindableIntentIds = useCallback(
    (path: string): string[] => {
      if (!docs.draft || !selection.jobId) return [];
      if (!path.startsWith(`jobs/${selection.jobId}/injections/`)) return [];
      const fileName = path.split('/').pop() ?? '';
      return docs.draft.intents
        .filter((e) => e.id.length > 0 && !(e.injections ?? []).includes(fileName))
        .map((e) => e.id);
    },
    [docs.draft, selection.jobId],
  );

  const handleBind = useCallback(
    (intentId: string, path: string) => {
      const fileName = path.split('/').pop() ?? '';
      const entry = docs.draft?.intents.find((e) => e.id === intentId);
      if (!entry) return;
      docs.updateIntent(intentId, { injections: [...(entry.injections ?? []), fileName] });
    },
    [docs],
  );

  const handleUnbind = useCallback(
    (intentId: string, path: string) => {
      const fileName = path.split('/').pop() ?? '';
      const entry = docs.draft?.intents.find((e) => e.id === intentId);
      if (!entry) return;
      docs.updateIntent(intentId, { injections: (entry.injections ?? []).filter((f) => f !== fileName) });
    },
    [docs],
  );

  /** Intent scope: bind an existing (or freshly created) injections file to the selected intent. */
  const bindToSelectedIntent = useCallback(
    (fileName: string) => {
      if (!selection.intentId) return;
      const entry = docs.draft?.intents.find((e) => e.id === selection.intentId);
      if (entry && !(entry.injections ?? []).includes(fileName)) {
        docs.updateIntent(selection.intentId, { injections: [...(entry.injections ?? []), fileName] });
      }
    },
    [docs, selection.intentId],
  );

  // Selective raw-save re-sync: only the selection's own yaml docs reload the
  // drafts (an unrelated .md save no longer clobbers unsaved form edits);
  // intents.yaml additionally refreshes the tree's intent rows.
  const handleRawSaved = useCallback(
    (path: string) => {
      if (!selection.jobId) return;
      const mainPath = `jobs/${selection.jobId}/job.yaml`;
      const intentsPath = `jobs/${selection.jobId}/intents.yaml`;
      if (path === mainPath || path === intentsPath) void docs.reload();
      if (path.endsWith('intents.yaml')) void loadAccountAgents();
    },
    [selection.jobId, docs, loadAccountAgents],
  );

  // Draft-owned yaml paths with pending form edits (raw-save clobber warning).
  const draftDirtyPaths = useMemo(() => {
    if (!selection.jobId) return [];
    const paths: string[] = [];
    if (docs.mainDirty) paths.push(`jobs/${selection.jobId}/job.yaml`);
    if (docs.intentsDirty) paths.push(`jobs/${selection.jobId}/intents.yaml`);
    return paths;
  }, [selection.jobId, docs.mainDirty, docs.intentsDirty]);

  // Job/intent levels only — the agent level renders without form drafts.
  const overviewCtx: OverviewCtx | null =
    selection.agentId && selection.jobId && docs.loaded
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
              docs.draft?.intents.find((e) => e.id === selection.intentId)?.injections ?? [],
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
      desc: t('danger.intentDesc', 'Removes the entry from intents.yaml (renaming = delete + recreate; bindings and @intent: mentions reference the id). Its injection files stay on disk, on-demand only.'),
      button: t('danger.intentButton', 'Delete intent'),
    },
  }[level];

  const detailReady =
    !!selection.agentId && !!promptsScope && (level === 'agent' || overviewCtx != null);

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
          onCreateIntent={handleCreateIntent}
          onRenameAgent={handleRenameAgent}
          onRenameJob={handleRenameJob}
          onDeleteAgent={handleDeleteAgent}
          onDeleteJob={handleDeleteJob}
          onDeleteIntent={handleDeleteIntent}
          onUploadFiles={handleUploadFiles}
          onImportFolder={handleImportFolder}
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
      {detailReady && promptsScope ? (
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

            {!readonly && overviewCtx && (
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

            {level === 'intent' && overviewCtx && selection.intentId && (
              <IntentDetailCard
                ctx={overviewCtx}
                id="c3g-intent"
                intentId={selection.intentId}
                onBackToJob={() => selectAgentSettingsNode(selection.agentId, selection.jobId)}
              />
            )}
            {level === 'job' && overviewCtx && <ToolsCard ctx={overviewCtx} id="c3g-tools" />}
            {level === 'job' && overviewCtx && selection.agentId && selection.jobId && (
              <IntentsCard
                ctx={overviewCtx}
                id="c3g-intents"
                onSelectIntent={(intentId) => selectAgentSettingsNode(selection.agentId, selection.jobId, intentId)}
                onCreateIntent={(intentId) => handleCreateIntent(selection.agentId!, selection.jobId!, intentId)}
              />
            )}
            {level === 'job' && overviewCtx && selection.agentId && selection.jobId && (
              <PromptPreviewCard ctx={overviewCtx} id="c3g-preview" agentId={selection.agentId} jobId={selection.jobId} />
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
              draftDirtyPaths={draftDirtyPaths}
              onRawSaved={handleRawSaved}
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
