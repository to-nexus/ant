import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown, ChevronRight, Copy, Plus, Trash2, Upload, X } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Button, Input } from '@/presentation/components/aurora';
import {
  createAccountAgent,
  createAccountAgentJob,
  deleteAccountAgent,
  deleteAccountAgentJob,
  fetchDefinitionFile,
  importAgentFolder,
} from '@/infrastructure/http/api/accountAgents';
import type { CustomAgentScope, CustomAgentSummary, CustomAgentDefinitionFileNode } from '@ant/shared';
import { FilesTab } from './FilesTab';
import { OVERVIEW_SECTIONS, type OverviewSectionContext } from './overview/sections';

/**
 * Agent Settings — account-scoped standalone screen (profile menu → main
 * panel tab, D-G). Works WITHOUT a selected project: everything reads
 * `/api/account/agents`. Left: scope-grouped agent/job tree. Right:
 * [Overview | Files] detail tabs.
 */

const SCOPE_ORDER: CustomAgentScope[] = ['user', 'org', 'builtin'];

function collectFilePaths(nodes: CustomAgentDefinitionFileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path);
    if (n.children) collectFilePaths(n.children, out);
  }
  return out;
}

export function AgentSettings({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation('agents');
  const agents = useStore((s) => s.accountAgents);
  const selection = useStore((s) => s.agentSettingsSelection);
  const definitionTree = useStore((s) => s.definitionTree);
  const definitionReadonly = useStore((s) => s.definitionReadonly);
  const loadAccountAgents = useStore((s) => s.loadAccountAgents);
  const selectAgentSettingsNode = useStore((s) => s.selectAgentSettingsNode);
  const syncComposerAgents = useStore((s) => s.syncComposerAgents);

  const [detailTab, setDetailTab] = useState<'overview' | 'files'>('overview');
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<null | { kind: 'agent' } | { kind: 'job'; agentId: string }>(null);
  const [createName, setCreateName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [overviewNonce, setOverviewNonce] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  useEffect(() => {
    void loadAccountAgents();
  }, [loadAccountAgents]);

  const selectedAgent = agents.find((a) => a.id === selection.agentId);
  const readonly = definitionReadonly || (selectedAgent?.readonly ?? false);

  const deriveId = (name: string) =>
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  const afterMutation = async () => {
    await loadAccountAgents();
    syncComposerAgents();
  };

  const handleCreate = async () => {
    const name = createName.trim();
    const id = deriveId(name);
    if (!id) return;
    setError(null);
    try {
      if (creating?.kind === 'agent') {
        await createAccountAgent({ id, name });
        await afterMutation();
        selectAgentSettingsNode(id);
      } else if (creating?.kind === 'job') {
        await createAccountAgentJob(creating.agentId, { id, name });
        await afterMutation();
        selectAgentSettingsNode(creating.agentId, id);
      }
      setCreating(null);
      setCreateName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    setError(null);
    try {
      await deleteAccountAgent(agentId);
      await afterMutation();
      if (selection.agentId === agentId) selectAgentSettingsNode(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteJob = async (agentId: string, jobId: string) => {
    setError(null);
    try {
      await deleteAccountAgentJob(agentId, jobId);
      await afterMutation();
      if (selection.jobId === jobId) selectAgentSettingsNode(agentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Readonly scope escape hatch: read every definition file, re-upload into
   * the user scope as a new agent (no new BE surface needed). */
  const handleCopyToAccount = async (agent: CustomAgentSummary) => {
    setError(null);
    try {
      const paths = collectFilePaths(definitionTree);
      const entries = await Promise.all(
        paths.map(async (p) => {
          const { content } = await fetchDefinitionFile(agent.id, p);
          return { file: new File([content], p.split('/').pop() || p), relativePath: `${agent.id}/${p}` };
        }),
      );
      const result = await importAgentFolder(entries);
      await afterMutation();
      if (result.agentId) selectAgentSettingsNode(result.agentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportFolder = async (files: FileList) => {
    setError(null);
    try {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const overviewCtx: OverviewSectionContext | null = selection.agentId
    ? {
        agentId: selection.agentId,
        jobId: selection.jobId,
        readonly,
        onSaved: (validation) => {
          setLastWarnings(validation.errors);
          setOverviewNonce((n) => n + 1);
          void afterMutation();
        },
        onError: (message) => setError(message),
      }
    : null;

  const level: 'agent' | 'job' = selection.jobId ? 'job' : 'agent';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-1)' }}>
        <Bot className="w-4 h-4" style={{ color: 'var(--violet-500)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
          {t('title', '에이전트 설정')}
        </span>
        <div className="flex-1" />
        {onClose && (
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[color:var(--bg-hover)]">
            <X className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-2 text-xs rounded-md px-2 py-1" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)' }}>
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* left tree */}
        <div className="w-64 shrink-0 overflow-y-auto p-3 flex flex-col gap-2" style={{ borderRight: '1px solid var(--border-1)' }}>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setCreating({ kind: 'agent' }); setCreateName(''); }}>
              <Plus className="w-3 h-3" /> {t('tree.newAgent', 'New Agent')}
            </Button>
            <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-[color:var(--bg-hover)]" style={{ color: 'var(--text-3)' }}>
              <Upload className="w-3 h-3" /> {t('tree.upload', 'Upload')}
              <input
                type="file"
                multiple
                className="hidden"
                // @ts-expect-error — non-standard folder-upload attribute
                webkitdirectory=""
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) void handleImportFolder(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {creating?.kind === 'agent' && (
            <form onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}>
              <Input
                autoFocus
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('tree.agentName', 'Agent name')}
                onKeyDown={(e) => e.key === 'Escape' && setCreating(null)}
              />
            </form>
          )}

          {SCOPE_ORDER.map((scope) => {
            const group = agents.filter((a) => a.scope === scope);
            if (group.length === 0) return null;
            return (
              <div key={scope} className="flex flex-col gap-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--text-4)' }}>
                  {t(`tree.scope.${scope}`, scope)}
                  {scope !== 'user' && (
                    <span className="px-1 rounded" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-4)' }}>
                      {t('tree.readonly', 'readonly')}
                    </span>
                  )}
                </div>
                {group.map((agent) => {
                  const collapsed = collapsedAgents.has(agent.id);
                  const isSelected = selection.agentId === agent.id && !selection.jobId;
                  return (
                    <div key={agent.id}>
                      <div
                        className="group flex items-center gap-1 py-0.5 px-1 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
                        style={{ color: isSelected ? 'var(--violet-500)' : 'var(--text-2)' }}
                        onClick={() => selectAgentSettingsNode(agent.id)}
                      >
                        <button
                          type="button"
                          className="p-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsedAgents((prev) => {
                              const next = new Set(prev);
                              if (next.has(agent.id)) next.delete(agent.id);
                              else next.add(agent.id);
                              return next;
                            });
                          }}
                        >
                          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <Bot className="w-3 h-3 shrink-0" />
                        <span className="truncate flex-1">{agent.name}</span>
                        {!agent.readonly && (
                          <>
                            <button
                              type="button"
                              className="opacity-0 group-hover:opacity-100 p-0.5"
                              title={t('tree.newJob', 'New job')}
                              onClick={(e) => { e.stopPropagation(); setCreating({ kind: 'job', agentId: agent.id }); setCreateName(''); }}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              className="opacity-0 group-hover:opacity-100 p-0.5"
                              title={t('tree.deleteAgent', 'Delete agent')}
                              onClick={(e) => { e.stopPropagation(); void handleDeleteAgent(agent.id); }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                      {creating?.kind === 'job' && creating.agentId === agent.id && (
                        <form className="pl-6" onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}>
                          <Input
                            autoFocus
                            value={createName}
                            onChange={(e) => setCreateName(e.target.value)}
                            placeholder={t('tree.jobName', 'Job name')}
                            onKeyDown={(e) => e.key === 'Escape' && setCreating(null)}
                          />
                        </form>
                      )}
                      {!collapsed &&
                        agent.jobs.map((job) => {
                          const jobSelected = selection.agentId === agent.id && selection.jobId === job.id;
                          return (
                            <div
                              key={job.id}
                              className="group flex items-center gap-1 py-0.5 pl-7 pr-1 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
                              style={{ color: jobSelected ? 'var(--violet-500)' : 'var(--text-3)' }}
                              onClick={() => selectAgentSettingsNode(agent.id, job.id)}
                            >
                              <span className="truncate flex-1">{job.name}</span>
                              {!agent.readonly && (
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 p-0.5"
                                  title={t('tree.deleteJob', 'Delete job')}
                                  onClick={(e) => { e.stopPropagation(); void handleDeleteJob(agent.id, job.id); }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
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

        {/* right detail */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selection.agentId && overviewCtx ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border-1)' }}>
                {(['overview', 'files'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      color: detailTab === tab ? 'var(--violet-500)' : 'var(--text-3)',
                      background: detailTab === tab ? 'var(--bg-surface-2)' : 'transparent',
                    }}
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab === 'overview' ? t('detail.overview', 'Overview') : t('detail.files', 'Files')}
                  </button>
                ))}
                <div className="flex-1" />
                {readonly && selectedAgent && (
                  <Button size="sm" variant="ghost" onClick={() => void handleCopyToAccount(selectedAgent)}>
                    <Copy className="w-3 h-3" /> {t('detail.copyToAccount', '내 계정으로 복사')}
                  </Button>
                )}
              </div>
              {lastWarnings.length > 0 && (
                <div className="mx-4 mt-2 text-xs rounded-md px-2 py-1 flex flex-col gap-0.5" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-3)' }}>
                  {lastWarnings.map((w, i) => (
                    <span key={i} className="font-mono">{w}</span>
                  ))}
                </div>
              )}
              {detailTab === 'overview' ? (
                <div key={`${selection.agentId}/${selection.jobId ?? ''}#${overviewNonce}`} className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
                  {OVERVIEW_SECTIONS.filter((s) => s.appliesTo === 'both' || s.appliesTo === level).map((s) => (
                    <s.Component key={s.id} ctx={overviewCtx} />
                  ))}
                </div>
              ) : (
                <div className="flex-1 min-h-0">
                  <FilesTab agentId={selection.agentId} readonly={readonly} />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-4)' }}>
              {t('detail.selectAgent', 'Select an agent or job on the left')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
