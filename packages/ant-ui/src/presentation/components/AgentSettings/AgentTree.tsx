/**
 * Agent tree — the settings screen's left rail. Three levels:
 * agent (Bot) › job (Briefcase, the Jobs concept icon) › intent (Target, the
 * `@intent:` mention icon — composer vocabulary reused so the tree reads the
 * same as the chat surface).
 *
 * Per-level CRUD lives in row KebabMenus (create / rename / upload / delete);
 * inline forms all carry an explicit Cancel button (Escape also works) and a
 * live derived-id preview. Renames patch the display name only — the id IS
 * the directory name and stays immutable. Collapse state is local and
 * unpersisted.
 *
 * Readonly scopes (org / builtin) get no menu at all — KebabMenu renders
 * nothing for an empty item list. They are browseable, never editable; the
 * way to a writable agent is creating your own (same-id shadowing is refused
 * by the BE with 409).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Target,
  Trash2,
  Upload,
} from 'lucide-react';
import type { CustomAgentScope, CustomAgentSummary } from '@ant/shared';
import { CUSTOM_ID_PATTERN } from '@ant/shared';
import { Button, KebabMenu, type KebabMenuItem } from '@/presentation/components/aurora';
import { AuroraInput, StatusPill } from '@/presentation/components/ConfigEditor/aurora';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import type { AgentSettingsSelection } from '@/domain/store/slices/agentSettingsSlice';

const SCOPE_ORDER: CustomAgentScope[] = ['user', 'org', 'builtin'];

/** Shared box for the two toolbar icons so <button> and <label> render identically. */
const TOOLBAR_ICON_CLASS =
  'inline-flex items-center justify-center h-6 w-6 rounded text-[color:var(--text-3)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

export function deriveId(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

type Creating =
  | { kind: 'agent' }
  | { kind: 'job'; agentId: string }
  | { kind: 'intent'; agentId: string; jobId: string }
  | { kind: 'renameAgent'; agentId: string; current: string }
  | { kind: 'renameJob'; agentId: string; jobId: string; current: string };

export interface AgentTreeProps {
  agents: CustomAgentSummary[];
  selection: AgentSettingsSelection;
  onSelect: (agentId?: string, jobId?: string, intentId?: string) => void;
  onCreateAgent: (id: string, name: string) => Promise<void>;
  onCreateJob: (agentId: string, id: string, name: string) => Promise<void>;
  onCreateIntent: (agentId: string, jobId: string, intentId: string) => Promise<void>;
  /** Display-name renames — the id is immutable (it IS the directory name). */
  onRenameAgent: (agentId: string, name: string) => Promise<void>;
  onRenameJob: (agentId: string, jobId: string, name: string) => Promise<void>;
  onDeleteAgent: (agentId: string) => Promise<void>;
  onDeleteJob: (agentId: string, jobId: string) => Promise<void>;
  onDeleteIntent: (agentId: string, jobId: string, intentId: string) => Promise<void>;
  /** Upload loose files into the agent (job scope prefixes jobs/{jobId}/). */
  onUploadFiles: (agentId: string, files: FileList, pathPrefix: string) => Promise<void>;
  onImportFolder: (files: FileList) => Promise<void>;
}

function InlineCreateForm({
  placeholder,
  isIntentId,
  initialValue,
  submitLabel,
  onSubmit,
  onCancel,
  indent,
}: {
  placeholder: string;
  /** Intent forms take the id directly (mono, pattern-checked) instead of a display name. */
  isIntentId?: boolean;
  /** Rename mode: prefill and no derived-id preview (the id never changes). */
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  indent: number;
}) {
  const { t } = useTranslation('agents');
  const [value, setValue] = useState(initialValue ?? '');
  const isRename = initialValue !== undefined;
  const derived = isIntentId ? value : deriveId(value);
  const valid = isIntentId
    ? CUSTOM_ID_PATTERN.test(value) && value !== 'general'
    : isRename
      ? value.trim().length > 0
      : derived.length > 0;
  return (
    <form
      className="py-1 flex flex-col gap-1"
      style={{ paddingLeft: indent }}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(isIntentId ? value : value.trim());
      }}
    >
      <AuroraInput
        value={value}
        mono={isIntentId}
        hasError={value.length > 0 && !valid}
        onChange={setValue}
        placeholder={placeholder}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" type="submit" disabled={!valid}>
          {submitLabel ?? t('tree.create', 'Create')}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          {t('tree.cancel', 'Cancel')}
        </Button>
        {!isIntentId && !isRename && derived.length > 0 && (
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
  onCreateIntent,
  onRenameAgent,
  onRenameJob,
  onDeleteAgent,
  onDeleteJob,
  onDeleteIntent,
  onUploadFiles,
  onImportFolder,
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

  const confirmDelete = {
    confirm: true as const,
    confirmLabel: t('tree.menu.confirmDelete', 'Click again to delete'),
    variant: 'danger' as const,
  };

  // Everything writable is scope-gated here (readonly scopes get no menu at
  // all), so the row markup never asks about readonly again.
  const agentMenu = (agent: CustomAgentSummary): KebabMenuItem[] =>
    agent.readonly
      ? []
      : [
          { icon: Plus, label: t('tree.menu.newJob', 'New job'), onClick: () => setCreating({ kind: 'job', agentId: agent.id }) },
          {
            icon: Pencil,
            label: t('tree.menu.renameAgent', 'Rename'),
            onClick: () => setCreating({ kind: 'renameAgent', agentId: agent.id, current: agent.name }),
          },
          {
            icon: Upload,
            label: t('tree.menu.upload', 'Upload files…'),
            onClick: () => openFilePicker((files) => void onUploadFiles(agent.id, files, '')),
          },
          'separator',
          { icon: Trash2, label: t('tree.menu.deleteAgent', 'Delete agent'), onClick: () => void onDeleteAgent(agent.id), ...confirmDelete },
        ];

  const jobMenu = (agent: CustomAgentSummary, jobId: string, jobName: string): KebabMenuItem[] =>
    agent.readonly
      ? []
      : [
          { icon: Plus, label: t('tree.menu.newIntent', 'New intent'), onClick: () => setCreating({ kind: 'intent', agentId: agent.id, jobId }) },
          {
            icon: Pencil,
            label: t('tree.menu.renameJob', 'Rename'),
            onClick: () => setCreating({ kind: 'renameJob', agentId: agent.id, jobId, current: jobName }),
          },
          {
            icon: Upload,
            label: t('tree.menu.upload', 'Upload files…'),
            onClick: () => openFilePicker((files) => void onUploadFiles(agent.id, files, `jobs/${jobId}/`)),
          },
          'separator',
          { icon: Trash2, label: t('tree.menu.deleteJob', 'Delete job'), onClick: () => void onDeleteJob(agent.id, jobId), ...confirmDelete },
        ];

  const intentMenu = (agent: CustomAgentSummary, jobId: string, intentId: string): KebabMenuItem[] =>
    agent.readonly
      ? []
      : [
          { icon: Trash2, label: t('tree.menu.deleteIntent', 'Delete intent'), onClick: () => void onDeleteIntent(agent.id, jobId, intentId), ...confirmDelete },
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

      {/* Fresh install: builtin is the only agent and every write is refused.
          Name the way out rather than letting the tree read as broken. */}
      {!creating && !agents.some((a) => a.scope === 'user') && (
        <p className="px-1 m-0" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-4)' }}>
          {t('tree.noUserAgents', 'No agents of your own yet — create one with the + button above.')}
        </p>
      )}

      {creating?.kind === 'agent' && (
        <InlineCreateForm
          placeholder={t('tree.agentName', 'Agent name')}
          indent={0}
          onCancel={() => setCreating(null)}
          onSubmit={(name) => {
            setCreating(null);
            void onCreateAgent(deriveId(name), name);
          }}
        />
      )}

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
              {scope !== 'user' && <StatusPill state="not-configured" label={t('tree.readonly', 'readonly')} />}
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
                    <button
                      type="button"
                      className="p-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(setCollapsedAgents, agent.id);
                      }}
                    >
                      {agentCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <Bot size={14} className="shrink-0" />
                    <span className="truncate flex-1">{agent.name}</span>
                    <span className="opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                      <KebabMenu items={agentMenu(agent)} ariaLabel={t('tree.menu.agentActions', 'Agent actions')} />
                    </span>
                  </div>

                  {creating?.kind === 'job' && creating.agentId === agent.id && (
                    <InlineCreateForm
                      placeholder={t('tree.jobName', 'Job name')}
                      indent={24}
                      onCancel={() => setCreating(null)}
                      onSubmit={(name) => {
                        setCreating(null);
                        void onCreateJob(agent.id, deriveId(name), name);
                      }}
                    />
                  )}

                  {creating?.kind === 'renameAgent' && creating.agentId === agent.id && (
                    <InlineCreateForm
                      placeholder={t('tree.agentName', 'Agent name')}
                      initialValue={creating.current}
                      submitLabel={t('tree.save', 'Save')}
                      indent={24}
                      onCancel={() => setCreating(null)}
                      onSubmit={(name) => {
                        setCreating(null);
                        void onRenameAgent(agent.id, name);
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
                            {intents.length > 0 ? (
                              <button
                                type="button"
                                className="p-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(setCollapsedJobs, jobKey);
                                }}
                              >
                                {jobCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            ) : (
                              <span className="w-4" />
                            )}
                            <Briefcase size={14} className="shrink-0" />
                            <span className="truncate flex-1">{job.name}</span>
                            <span className="opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                              <KebabMenu items={jobMenu(agent, job.id, job.name)} ariaLabel={t('tree.menu.jobActions', 'Job actions')} />
                            </span>
                          </div>

                          {creating?.kind === 'intent' && creating.agentId === agent.id && creating.jobId === job.id && (
                            <InlineCreateForm
                              placeholder={t('tree.intentId', 'intent-id')}
                              isIntentId
                              indent={40}
                              onCancel={() => setCreating(null)}
                              onSubmit={(intentId) => {
                                setCreating(null);
                                void onCreateIntent(agent.id, job.id, intentId);
                              }}
                            />
                          )}

                          {creating?.kind === 'renameJob' && creating.agentId === agent.id && creating.jobId === job.id && (
                            <InlineCreateForm
                              placeholder={t('tree.jobName', 'Job name')}
                              initialValue={creating.current}
                              submitLabel={t('tree.save', 'Save')}
                              indent={40}
                              onCancel={() => setCreating(null)}
                              onSubmit={(name) => {
                                setCreating(null);
                                void onRenameJob(agent.id, job.id, name);
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
                                  title={intent.description}
                                  className="group flex items-center gap-1 py-1 pl-10 pr-1 rounded cursor-pointer hover:bg-[color:var(--bg-hover)]"
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
                                  <span className="opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                                    <KebabMenu
                                      items={intentMenu(agent, job.id, intent.id)}
                                      ariaLabel={t('tree.menu.intentActions', 'Intent actions')}
                                    />
                                  </span>
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
