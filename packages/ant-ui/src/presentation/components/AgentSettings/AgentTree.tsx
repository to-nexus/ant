/**
 * Agent tree — the settings screen's left rail, with TWO ISOMORPHIC VIEWS
 * over the same definitions (the file ↔ section philosophy):
 *   Structure (human) — agent (Bot) › job (Briefcase) › intent (Target, the
 *   `@intent:` mention icon — composer vocabulary reused so the tree reads
 *   the same as the chat surface).
 *   Files — the same scope groups and agent rows, but under an expanded
 *   agent the children are its definition FILE TREE (lazy-loaded per agent).
 *   Clicking a file navigates to the section that owns it, and the file the
 *   right pane currently expresses is highlighted.
 *
 * The tree CREATES and NAVIGATES; it never edits. Renaming happens in the
 * detail screen's definition card and deleting in its Danger Zone.
 *
 * A row's actions follow ITS VIEW. Structure rows create and upload the SAME
 * unit — the child concept's DIRECTORY (root → agent, agent → job, job →
 * intent), so "upload" can never be read as "upload makes a job?". File rows
 * are directories, so they carry new-file / new-folder / upload scoped to what
 * `getDefinitionDirPolicy` says that directory may legally hold. Agent
 * creation is view-independent (the toolbar). Collapse state is local and
 * unpersisted; the view choice persists (STORAGE_KEYS.AGENT_TREE_VIEW).
 *
 * Row anatomy: the concept icon is the FIRST thing on every row, indented one
 * step per level, so the three icons read as a ladder. The collapse chevron is
 * a trailing control on the right — putting it left of the icon would push
 * agent and job icons one chevron-width further right than intent icons, which
 * have no chevron, and the ladder would invert. Rows without a chevron reserve
 * its width so the trailing column stays plumb.
 *
 * Readonly scopes (org / builtin) get no WRITE items — they are browseable,
 * never editable; the way to a writable agent is creating your own (same-id
 * shadowing is refused by the BE with 409). Their menu still offers the folder
 * export, which is a read of bytes the file endpoints already serve.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bot, Briefcase, ChevronDown, ChevronRight, CircleCheckBig, FilePlus, FolderDown, FolderPlus, FolderTree, FolderUp, ListTree, Plus, Target, Upload } from 'lucide-react';
import {
  getDefinitionDirPolicy,
  toCustomId,
  type CustomAgentDefinitionFileNode,
  type CustomAgentScope,
  type CustomAgentSummary,
} from '@ant/shared';
import { Button, KebabMenu, type KebabMenuItem } from '@/presentation/components/aurora';
import { AuroraInput, StatusPill } from '@/presentation/components/ConfigEditor/aurora';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import { useFilePicker } from '@/application/hooks/ui/useFilePicker';
import { STORAGE_KEYS } from '@/domain/store/storage';
import type { AgentSettingsSelection, DefinitionTreeEntry } from '@/domain/store/slices/agentSettingsSlice';
import { DefinitionFileTree } from './overview/DefinitionFileTree';

type TreeView = 'human' | 'files';

function loadTreeView(): TreeView {
  try {
    return localStorage.getItem(STORAGE_KEYS.AGENT_TREE_VIEW) === 'files' ? 'files' : 'human';
  } catch {
    return 'human';
  }
}

const SCOPE_ORDER: CustomAgentScope[] = ['user', 'org', 'builtin'];

/** Shared box for the two toolbar icons so <button> and <label> render identically. */
const TOOLBAR_ICON_CLASS =
  'inline-flex items-center justify-center h-6 w-6 rounded text-[color:var(--text-3)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

/** Trailing collapse control (and the spacer that keeps chevron-less rows plumb). */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="p-0.5 shrink-0 text-[color:var(--text-4)] hover:text-[color:var(--text-2)]"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
    </button>
  );
}

const COLLAPSE_SPACER = <span className="w-4 shrink-0" />;

type Creating =
  | { kind: 'agent' }
  | { kind: 'job'; agentId: string; dirPath?: string }
  | { kind: 'intent'; agentId: string; jobId: string }
  | { kind: 'file'; agentId: string; dirPath: string };

export interface AgentTreeProps {
  agents: CustomAgentSummary[];
  selection: AgentSettingsSelection;
  onSelect: (agentId?: string, jobId?: string, intentId?: string) => void;
  onCreateAgent: (id: string, name: string) => Promise<void>;
  onCreateJob: (agentId: string, id: string, name: string) => Promise<void>;
  /** Upload loose files into one definition directory (file view). */
  onUploadFiles: (agentId: string, files: FileList, dirPath: string) => Promise<void>;
  /** Upload a whole agent folder (both views, toolbar). */
  onImportFolder: (files: FileList) => Promise<void>;
  /** Upload a job / intent FOLDER — the picked folder name is the id. */
  onUploadUnitFolder: (unit: 'job' | 'intent', agentId: string, jobId: string | undefined, files: FileList) => Promise<void>;
  onCreateIntent: (agentId: string, jobId: string, intentId: string) => void;
  onCreateFile: (agentId: string, path: string) => Promise<void>;
  onCreateDir: (agentId: string, path: string) => Promise<void>;
  /** Whole-agent folder export (ZIP) — offered in every scope, readonly included. */
  onDownloadAgent: (agentId: string) => Promise<void>;
  /** Empty-state copy for the org group depends on whether a team is active. */
  isTeamActive: boolean;
  /** Why the agent list is empty, when it is empty because loading failed. */
  loadError?: { kind: 'endpoint-missing' | 'unknown'; message: string } | null;
  onRetryLoad?: () => void;
  /** Per-agent definition trees (file view data), lazy-loaded via onEnsureTree. */
  definitionTrees: Record<string, DefinitionTreeEntry>;
  onEnsureTree: (agentId: string) => void;
  /** File-view click → the shell's section navigation bridge. */
  onOpenFile: (agentId: string, path: string) => void;
  /**
   * Re-fetch every loaded tree. Called on file-view ENTRY — there is no manual
   * refresh button: the trees are lazy-loaded once and would otherwise stay
   * stale forever (the shell also re-reads them when the window wakes).
   */
  onRefreshTrees: () => void;
  /** File the right pane currently expresses — highlighted in the file view. */
  selectedFilePath: string | null;
  /** The agent that highlight belongs to. */
  selectedFileAgentId: string | null;
}

/**
 * Load-failure banner. Without it an empty tree is indistinguishable from "this
 * account has no agents", which is what made a 404 on `/api/definitions/agents`
 * present itself as missing builtin agents.
 */
function LoadErrorNotice({
  error,
  onRetry,
}: {
  error: { kind: 'endpoint-missing' | 'unknown'; message: string };
  onRetry?: () => void;
}) {
  const { t } = useTranslation('agents');
  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded px-2 py-2"
      style={{ border: '1px solid var(--border-1)', background: 'var(--bg-hover)' }}
    >
      <div className="flex items-center gap-1.5" style={{ color: 'var(--text-2)', fontSize: 11 }}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold">{t('tree.loadFailed', 'Could not load agents')}</span>
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: 10, lineHeight: 1.45 }}>
        {error.kind === 'endpoint-missing'
          ? t(
              'tree.loadFailedEndpointMissing',
              'The server does not provide this endpoint. It is likely running an older build than this UI.',
            )
          : t('tree.loadFailedUnknown', 'The request failed. This is not the same as having no agents.')}
      </p>
      <span className="truncate" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>
        {error.message}
      </span>
      {onRetry && (
        <div>
          <Button size="sm" variant="ghost" type="button" onClick={onRetry}>
            {t('tree.retry', 'Retry')}
          </Button>
        </div>
      )}
    </div>
  );
}

function InlineCreateForm({
  placeholder,
  onSubmit,
  onCancel,
  indent,
  rawName,
}: {
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  indent: number;
  /** File names are not ids — skip the id derivation and its preview. */
  rawName?: boolean;
}) {
  const { t } = useTranslation('agents');
  const [value, setValue] = useState('');
  const derived = rawName ? value.trim() : toCustomId(value);
  return (
    <form
      className="py-1 flex flex-col gap-1"
      style={{ paddingLeft: indent }}
      onSubmit={(e) => {
        e.preventDefault();
        if (derived.length > 0) onSubmit(value.trim());
      }}
    >
      <AuroraInput
        value={value}
        hasError={value.length > 0 && derived.length === 0}
        onChange={setValue}
        placeholder={placeholder}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" type="submit" disabled={derived.length === 0}>
          {t('tree.create', 'Create')}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          {t('tree.cancel', 'Cancel')}
        </Button>
        {derived.length > 0 && (
          <span className="truncate" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>
            {t('tree.idPreview', 'id: {{id}}', { id: derived })}
          </span>
        )}
      </div>
    </form>
  );
}

export function AgentTree({
  agents,
  selection,
  onSelect,
  onCreateAgent,
  onCreateJob,
  onUploadFiles,
  onImportFolder,
  onUploadUnitFolder,
  onCreateIntent,
  onCreateFile,
  onCreateDir,
  onDownloadAgent,
  isTeamActive,
  loadError,
  onRetryLoad,
  definitionTrees,
  onEnsureTree,
  onOpenFile,
  onRefreshTrees,
  selectedFilePath,
  selectedFileAgentId,
}: AgentTreeProps) {
  const { t } = useTranslation('agents');
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<Creating | null>(null);
  const [filePicker, openFilePicker] = useFilePicker();
  const [view, setView] = useState<TreeView>(loadTreeView);

  const changeView = (next: TreeView) => {
    setView(next);
    if (next === 'files') onRefreshTrees();
    try {
      localStorage.setItem(STORAGE_KEYS.AGENT_TREE_VIEW, next);
    } catch {
      /* persistence is best-effort */
    }
  };

  // File view lazily loads every EXPANDED agent's tree (dedupe in the slice).
  useEffect(() => {
    if (view !== 'files') return;
    for (const agent of agents) {
      if (!collapsedAgents.has(agent.id)) onEnsureTree(agent.id);
    }
  }, [view, agents, collapsedAgents, onEnsureTree]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Write items are gated by the PER-AGENT effective readonly (org agents can
  // be editable for their owner/editors). Promotion lives in the detail
  // pane's PromoteZone, not here — the tree only creates and navigates.
  const agentMenu = (agent: CustomAgentSummary): KebabMenuItem[] => {
    // Export is a READ, so every agent carries it — readonly scopes included;
    // it sits below the write items, separated, so it is never a mis-click.
    const download: KebabMenuItem = {
      icon: FolderDown,
      label: t('tree.menu.downloadFolder', 'Download folder'),
      onClick: () => void onDownloadAgent(agent.id),
    };
    if (agent.readonly) return [download];
    const writes =
      view === 'files'
        ? dirMenu(agent.id, '', definitionTrees[agent.id]?.tree ?? [])
        : [
            { icon: Plus, label: t('tree.menu.newJob', 'New job'), onClick: () => setCreating({ kind: 'job', agentId: agent.id }) },
            {
              icon: Upload,
              label: t('tree.menu.uploadJobFolder', 'Upload job folder…'),
              onClick: () => openFilePicker((files) => void onUploadUnitFolder('job', agent.id, undefined, files), { directory: true }),
            },
          ];
    return writes.length > 0 ? [...writes, 'separator', download] : [download];
  };

  const jobMenu = (agent: CustomAgentSummary, jobId: string): KebabMenuItem[] =>
    agent.readonly
      ? []
      : [
          {
            icon: Plus,
            label: t('tree.menu.newIntent', 'New intent'),
            onClick: () => setCreating({ kind: 'intent', agentId: agent.id, jobId }),
          },
          {
            icon: Upload,
            label: t('tree.menu.uploadIntentFolder', 'Upload intent folder…'),
            onClick: () => openFilePicker((files) => void onUploadUnitFolder('intent', agent.id, jobId, files), { directory: true }),
          },
        ];

  /**
   * File-view directory menu — every directory offers create + upload, but only
   * the children `getDefinitionDirPolicy` admits there; anything else would be
   * refused by the write whitelist after the fact.
   */
  const dirMenu = (agentId: string, dirPath: string, children: CustomAgentDefinitionFileNode[]): KebabMenuItem[] => {
    const policy = getDefinitionDirPolicy(dirPath);
    if (policy.kind === 'unknown') return [];
    const present = new Set(children.map((c) => c.name));
    const join = (name: string) => (dirPath ? `${dirPath}/${name}` : name);
    const items: KebabMenuItem[] = [];

    for (const name of policy.fixedFiles.filter((n) => !present.has(n))) {
      items.push({
        icon: FilePlus,
        label: t('tree.menu.newNamed', 'New {{name}}', { name }),
        onClick: () => void onCreateFile(agentId, join(name)),
      });
    }
    if (policy.acceptedExtensions) {
      items.push({
        icon: FilePlus,
        label: t('artifacts:actions.createFile', 'Create file'),
        onClick: () => setCreating({ kind: 'file', agentId, dirPath }),
      });
    }
    for (const name of policy.fixedDirs.filter((n) => !present.has(n))) {
      items.push({
        icon: FolderPlus,
        label: t('tree.menu.newNamedDir', 'New {{name}}/', { name }),
        onClick: () => void onCreateDir(agentId, join(name)),
      });
    }
    if (policy.customIdChild === 'job') {
      items.push({
        icon: Plus,
        label: t('tree.menu.newJob', 'New job'),
        onClick: () => setCreating({ kind: 'job', agentId, dirPath }),
      });
    }
    if (policy.customIdChild === 'intent') {
      const jobId = dirPath.split('/')[1];
      items.push({
        icon: Plus,
        label: t('tree.menu.newIntent', 'New intent'),
        onClick: () => setCreating({ kind: 'intent', agentId, jobId }),
      });
    }
    items.push({
      icon: Upload,
      label: t('artifacts:actions.upload', 'Upload files'),
      onClick: () => openFilePicker((files) => void onUploadFiles(agentId, files, dirPath)),
    });
    items.push({
      icon: FolderUp,
      label: t('artifacts:actions.uploadFolder', 'Upload folder'),
      onClick: () =>
        openFilePicker((files) => void onUploadFiles(agentId, files, dirPath), { directory: true }),
    });
    if (policy.customIdChild) {
      items.push({
        icon: Upload,
        label:
          policy.customIdChild === 'job'
            ? t('tree.menu.uploadJobFolder', 'Upload job folder…')
            : t('tree.menu.uploadIntentFolder', 'Upload intent folder…'),
        onClick: () =>
          openFilePicker(
            (files) => void onUploadUnitFolder(policy.customIdChild!, agentId, dirPath.split('/')[1], files),
            { directory: true },
          ),
      });
    }
    return items;
  };

  /** Inline create form for the file view, rendered under the directory it targets. */
  const renderCreateForm = (agentId: string, dirPath: string): React.ReactNode => {
    if (!creating || creating.kind === 'agent' || creating.agentId !== agentId) return null;
    const indent = 30;
    if (creating.kind === 'file' && creating.dirPath === dirPath) {
      return (
        <InlineCreateForm
          placeholder="filename.md"
          indent={indent}
          rawName
          onCancel={() => setCreating(null)}
          onSubmit={(name) => {
            setCreating(null);
            const exts = getDefinitionDirPolicy(dirPath).acceptedExtensions ?? ['.md'];
            const file = exts.some((e) => name.endsWith(e)) ? name : `${name}${exts[0]}`;
            void onCreateFile(agentId, dirPath ? `${dirPath}/${file}` : file);
          }}
        />
      );
    }
    if (creating.kind === 'job' && creating.dirPath === dirPath) {
      return (
        <InlineCreateForm
          placeholder={t('tree.jobName', 'Job name')}
          indent={indent}
          onCancel={() => setCreating(null)}
          onSubmit={(name) => {
            setCreating(null);
            void onCreateJob(agentId, toCustomId(name), name);
          }}
        />
      );
    }
    if (creating.kind === 'intent' && dirPath === `jobs/${creating.jobId}/intents`) {
      const jobId = creating.jobId;
      return (
        <InlineCreateForm
          placeholder={t('tree.intentId', 'intent-id')}
          indent={indent}
          onCancel={() => setCreating(null)}
          onSubmit={(name) => {
            setCreating(null);
            onCreateIntent(agentId, jobId, toCustomId(name));
          }}
        />
      );
    }
    return null;
  };

  const toggleLabel =
    view === 'files'
      ? t('tree.toggleToHuman', 'File view — switch to Structure')
      : t('tree.toggleToFiles', 'Structure view — switch to Files');

  return (
    <div className="h-full overflow-y-auto p-3 flex flex-col gap-3">
      {filePicker}
      {/* Icon-only toolbar — the labels survive as the accessible names so the
          reclaimed width goes to the tree rows. Upload stays a <label> (it
          wraps the folder input) but matches the button box exactly. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          title={t('tree.newAgent', 'New Agent')}
          aria-label={t('tree.newAgent', 'New Agent')}
          className={TOOLBAR_ICON_CLASS}
          onClick={() => setCreating({ kind: 'agent' })}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <label
          title={t('tree.uploadAgentFolder', 'Upload agent folder… (must contain agent.yaml)')}
          aria-label={t('tree.uploadAgentFolder', 'Upload agent folder… (must contain agent.yaml)')}
          className={`${TOOLBAR_ICON_CLASS} cursor-pointer`}
        >
          <Upload className="w-3.5 h-3.5" />
          <input
            type="file"
            multiple
            className="hidden"
            // @ts-expect-error — non-standard folder-upload attribute
            webkitdirectory=""
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void onImportFolder(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <span className="flex-1" />
        {/* Structure ⇄ Files — ONE icon switch: the icon is the current view,
            the tooltip names both the state and the destination. A segmented
            pair spent rail width restating a binary the icon already carries. */}
        <button
          type="button"
          title={toggleLabel}
          aria-label={toggleLabel}
          className={TOOLBAR_ICON_CLASS}
          onClick={() => changeView(view === 'files' ? 'human' : 'files')}
        >
          {view === 'files' ? <FolderTree className="w-3.5 h-3.5" /> : <ListTree className="w-3.5 h-3.5" />}
        </button>
      </div>

      {creating?.kind === 'agent' && (
        <InlineCreateForm
          placeholder={t('tree.agentName', 'Agent name')}
          indent={0}
          onCancel={() => setCreating(null)}
          onSubmit={(name) => {
            setCreating(null);
            void onCreateAgent(toCustomId(name), name);
          }}
        />
      )}

      {loadError && <LoadErrorNotice error={loadError} onRetry={onRetryLoad} />}

      {/* All three scope headers stay rendered even at zero rows — an absent
          group is indistinguishable from a group that does not exist. */}
      {SCOPE_ORDER.map((scope) => {
        const group = agents.filter((a) => a.scope === scope);
        return (
          <div key={scope} className="flex flex-col gap-0.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 px-1"
              style={{ color: 'var(--text-4)' }}
            >
              {t(`tree.scope.${scope}`, scope)}
              {/* readonly is PER AGENT now (org agents can be editable for
                  their owner/editors) — only a uniformly-readonly group gets
                  the header pill; mixed groups mark individual rows below. */}
              {group.length > 0 && group.every((a) => a.readonly) && (
                <StatusPill state="not-configured" label={t('tree.readonly', 'readonly')} />
              )}
            </div>
            {group.length === 0 && (
              <div className="py-1 pl-2 pr-1" style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-4)' }}>
                {scope === 'user'
                  ? t('tree.scope.emptyUser', 'No agents of your own yet — create one with + above.')
                  : scope === 'org'
                    ? isTeamActive
                      ? t('tree.scope.emptyOrg', 'Nothing shared in this organization yet.')
                      : t('tree.scope.emptyOrgNoTeam', 'Join a team to share agents with an organization.')
                    : t('tree.scope.emptyBuiltin', 'No built-in agents were loaded.')}
              </div>
            )}
            {group.map((agent) => {
              const agentCollapsed = collapsedAgents.has(agent.id);
              const agentSelected = selection.agentId === agent.id && !selection.jobId;
              return (
                <div key={agent.id}>
                  {/* agent row */}
                  <div
                    className="group flex items-center gap-1 py-1 pl-2 pr-1 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
                    style={{ ...selectedRowStyle('violet', agentSelected), ...selectedRowLabel(agentSelected, 'var(--text-2)') }}
                    onClick={() => onSelect(agent.id)}
                  >
                    <Bot size={14} className="shrink-0" />
                    <span className="truncate flex-1">{agent.name}</span>
                    {agent.readonly && !group.every((a) => a.readonly) && (
                      <StatusPill state="not-configured" label={t('tree.readonly', 'readonly')} />
                    )}
                    {/* Agent actions stay visible — the agent row is where a job
                        is born, and a hover-only affordance hid that entry point. */}
                    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <KebabMenu items={agentMenu(agent)} ariaLabel={t('tree.menu.agentActions', 'Agent actions')} />
                    </span>
                    <CollapseToggle collapsed={agentCollapsed} onToggle={() => toggle(setCollapsedAgents, agent.id)} />
                  </div>

                  {creating?.kind === 'job' && creating.agentId === agent.id && view === 'human' && (
                    <InlineCreateForm
                      placeholder={t('tree.jobName', 'Job name')}
                      indent={24}
                      onCancel={() => setCreating(null)}
                      onSubmit={(name) => {
                        setCreating(null);
                        void onCreateJob(agent.id, toCustomId(name), name);
                      }}
                    />
                  )}


                  {!agentCollapsed && view === 'files' && (
                    definitionTrees[agent.id] ? (
                      definitionTrees[agent.id].tree.length > 0 ? (
                        <DefinitionFileTree
                          key={agent.id}
                          tree={definitionTrees[agent.id].tree}
                          onOpenFile={(path) => onOpenFile(agent.id, path)}
                          selectedPath={selectedFileAgentId === agent.id ? selectedFilePath : null}
                          dense
                          baseIndent={18}
                          dirActions={
                            agent.readonly ? undefined : (node) => dirMenu(agent.id, node.path, node.children ?? [])
                          }
                          renderBelow={(path) => renderCreateForm(agent.id, path)}
                        />
                      ) : (
                        <div className="py-1 pl-8 text-[11px]" style={{ color: 'var(--text-4)' }}>
                          {t('tree.filesEmpty', 'No files yet.')}
                        </div>
                      )
                    ) : (
                      <div className="py-1 pl-8 text-[11px]" style={{ color: 'var(--text-4)' }}>
                        {t('tree.filesLoading', 'Loading files…')}
                      </div>
                    )
                  )}

                  {!agentCollapsed && view === 'human' &&
                    agent.jobs.map((job) => {
                      const jobKey = `${agent.id}/${job.id}`;
                      const jobCollapsed = collapsedJobs.has(jobKey);
                      const jobSelected =
                        selection.agentId === agent.id && selection.jobId === job.id && !selection.intentId;
                      const intents = job.intents ?? [];
                      return (
                        <div key={job.id}>
                          {/* job row */}
                          <div
                            className="group flex items-center gap-1 py-1 pl-6 pr-1 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
                            style={{ ...selectedRowStyle('violet', jobSelected), ...selectedRowLabel(jobSelected, 'var(--text-3)') }}
                            onClick={() => onSelect(agent.id, job.id)}
                          >
                            <Briefcase size={14} className="shrink-0" />
                            <span className="truncate flex-1">{job.name}</span>
                            {/* Visible like the agent row's: the job row is where an
                                intent is born, and hover-only hid that entry point. */}
                            <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                              <KebabMenu items={jobMenu(agent, job.id)} ariaLabel={t('tree.menu.jobActions', 'Job actions')} />
                            </span>
                            {intents.length > 0 ? (
                              <CollapseToggle
                                collapsed={jobCollapsed}
                                onToggle={() => toggle(setCollapsedJobs, jobKey)}
                              />
                            ) : (
                              COLLAPSE_SPACER
                            )}
                          </div>

                          {creating?.kind === 'intent' &&
                            creating.agentId === agent.id &&
                            creating.jobId === job.id &&
                            view === 'human' && (
                              <InlineCreateForm
                                placeholder={t('tree.intentId', 'intent-id')}
                                indent={40}
                                onCancel={() => setCreating(null)}
                                onSubmit={(name) => {
                                  setCreating(null);
                                  onCreateIntent(agent.id, job.id, toCustomId(name));
                                }}
                              />
                            )}

                          {!jobCollapsed &&
                            intents.map((intent) => {
                              const intentSelected =
                                selection.agentId === agent.id &&
                                selection.jobId === job.id &&
                                selection.intentId === intent.id;
                              return (
                                <div
                                  key={intent.id}
                                  title={intent.infer}
                                  className="flex items-center gap-1 py-1 pl-10 pr-1 rounded cursor-pointer hover:bg-[color:var(--bg-hover)]"
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'var(--font-mono)',
                                    ...selectedRowStyle('violet', intentSelected),
                                    ...selectedRowLabel(intentSelected, 'var(--text-3)'),
                                  }}
                                  onClick={() => onSelect(agent.id, job.id, intent.id)}
                                >
                                  <Target size={12} className="shrink-0" />
                                  <span className="truncate flex-1">{intent.id}</span>
                                  {(intent.hooks?.stop?.length ?? 0) > 0 && (
                                    <span
                                      className="shrink-0 inline-flex"
                                      title={t('tree.intentHasHooks', 'Declares hooks')}
                                      style={{ color: 'var(--text-4)' }}
                                    >
                                      <CircleCheckBig size={10} />
                                    </span>
                                  )}
                                  {COLLAPSE_SPACER}
                                </div>
                              );
                            })}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
