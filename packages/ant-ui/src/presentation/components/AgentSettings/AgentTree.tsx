/**
 * Agent tree — the settings screen's left rail. Three levels:
 * agent (Bot) › job (Briefcase, the Jobs concept icon) › intent (Target, the
 * `@intent:` mention icon — composer vocabulary reused so the tree reads the
 * same as the chat surface).
 *
 * The tree CREATES and NAVIGATES; it never edits. Renaming happens in the
 * detail screen's definition card (name and id are both fields there) and
 * deleting in its Danger Zone, so a row's kebab carries only "new child" and
 * "upload files". Intent rows have no menu at all — the intent catalog is
 * owned by the job screen's Intents card. Collapse state is local and
 * unpersisted.
 *
 * Row anatomy: the concept icon is the FIRST thing on every row, indented one
 * step per level, so the three icons read as a ladder. The collapse chevron is
 * a trailing control on the right — putting it left of the icon would push
 * agent and job icons one chevron-width further right than intent icons, which
 * have no chevron, and the ladder would invert. Rows without a chevron reserve
 * its width so the trailing column stays plumb.
 *
 * Readonly scopes (org / builtin) get no menu at all — KebabMenu renders
 * nothing for an empty item list. They are browseable, never editable; the
 * way to a writable agent is creating your own (same-id shadowing is refused
 * by the BE with 409).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bot, Briefcase, ChevronDown, ChevronRight, Plus, Target, Upload } from 'lucide-react';
import { toCustomId, type CustomAgentScope, type CustomAgentSummary } from '@ant/shared';
import { Button, KebabMenu, type KebabMenuItem } from '@/presentation/components/aurora';
import { AuroraInput, StatusPill } from '@/presentation/components/ConfigEditor/aurora';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import type { AgentSettingsSelection } from '@/domain/store/slices/agentSettingsSlice';

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

type Creating = { kind: 'agent' } | { kind: 'job'; agentId: string };

export interface AgentTreeProps {
  agents: CustomAgentSummary[];
  selection: AgentSettingsSelection;
  onSelect: (agentId?: string, jobId?: string, intentId?: string) => void;
  onCreateAgent: (id: string, name: string) => Promise<void>;
  onCreateJob: (agentId: string, id: string, name: string) => Promise<void>;
  /** Upload loose files into the agent (job scope prefixes jobs/{jobId}/). */
  onUploadFiles: (agentId: string, files: FileList, pathPrefix: string) => Promise<void>;
  onImportFolder: (files: FileList) => Promise<void>;
  /** Why the agent list is empty, when it is empty because loading failed. */
  loadError?: { kind: 'endpoint-missing' | 'unknown'; message: string } | null;
  onRetryLoad?: () => void;
}

/**
 * Load-failure banner. Without it an empty tree is indistinguishable from "this
 * account has no agents", which is what made a 404 on `/api/account/agents`
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
}: {
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  indent: number;
}) {
  const { t } = useTranslation('agents');
  const [value, setValue] = useState('');
  const derived = toCustomId(value);
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

/** Hidden multi-file input wrapped by an imperative opener. */
function useFilePicker(): [React.ReactNode, (onFiles: (files: FileList) => void) => void] {
  const [inputKey, setInputKey] = useState(0);
  const [handler, setHandler] = useState<((files: FileList) => void) | null>(null);
  const open = (onFiles: (files: FileList) => void) => {
    setHandler(() => onFiles);
    // The input is remounted per pick so re-selecting the same file re-fires.
    setInputKey((k) => k + 1);
    requestAnimationFrame(() => document.getElementById('agent-tree-file-picker')?.click());
  };
  const node = (
    <input
      key={inputKey}
      id="agent-tree-file-picker"
      type="file"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files && e.target.files.length > 0) handler?.(e.target.files);
      }}
    />
  );
  return [node, open];
}

export function AgentTree({
  agents,
  selection,
  onSelect,
  onCreateAgent,
  onCreateJob,
  onUploadFiles,
  onImportFolder,
  loadError,
  onRetryLoad,
}: AgentTreeProps) {
  const { t } = useTranslation('agents');
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<Creating | null>(null);
  const [filePicker, openFilePicker] = useFilePicker();

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
  const agentMenu = (agent: CustomAgentSummary): KebabMenuItem[] =>
    agent.readonly
      ? []
      : [
          { icon: Plus, label: t('tree.menu.newJob', 'New job'), onClick: () => setCreating({ kind: 'job', agentId: agent.id }) },
          {
            icon: Upload,
            label: t('tree.menu.upload', 'Upload files…'),
            onClick: () => openFilePicker((files) => void onUploadFiles(agent.id, files, '')),
          },
        ];

  const jobMenu = (agent: CustomAgentSummary, jobId: string): KebabMenuItem[] =>
    agent.readonly
      ? []
      : [
          {
            icon: Upload,
            label: t('tree.menu.upload', 'Upload files…'),
            onClick: () => openFilePicker((files) => void onUploadFiles(agent.id, files, `jobs/${jobId}/`)),
          },
        ];

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
          title={t('tree.upload', 'Upload')}
          aria-label={t('tree.upload', 'Upload')}
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

      {SCOPE_ORDER.map((scope) => {
        const group = agents.filter((a) => a.scope === scope);
        if (group.length === 0) return null;
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
              {group.every((a) => a.readonly) && (
                <StatusPill state="not-configured" label={t('tree.readonly', 'readonly')} />
              )}
            </div>
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

                  {creating?.kind === 'job' && creating.agentId === agent.id && (
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

                  {!agentCollapsed &&
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
                            <span className="opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => e.stopPropagation()}>
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

                          {!jobCollapsed &&
                            intents.map((intent) => {
                              const intentSelected =
                                selection.agentId === agent.id &&
                                selection.jobId === job.id &&
                                selection.intentId === intent.id;
                              return (
                                <div
                                  key={intent.id}
                                  title={intent.description}
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
