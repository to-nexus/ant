import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Bot, ChevronRight, Lock, MessageSquare, RefreshCw } from 'lucide-react';
import { useStore } from '@/domain/store';
import { isValidCustomId, type CustomAgentSummary, type CustomJobSummary } from '@ant/shared';
import {
  fetchCustomAgents,
  createCustomAgent,
  createCustomJob,
  fetchCustomJobThreads,
  type CustomJobThread,
} from '@/infrastructure/http/api';
import { SectionShell } from '../layout/Explorer/SectionShell';
import { RowList } from '../layout/Explorer/RowList';

/** `t-YYYYMMDD-xxxx` — matches the `[a-z0-9-]+` thread-id charset. */
function generateThreadId(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `t-${date}-${rand}`;
}

/** Derive a `[a-z0-9-]+` id from a display name. */
function deriveCustomId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SCOPE_BADGE_COLOR: Record<string, string> = {
  project: 'var(--violet-500)',
  user: 'var(--teal-500)',
  org: 'var(--orange-500)',
};

/**
 * Sidebar hub for universal projects — replaces `FeatureSection`.
 *
 * agent list (scope badge / readonly lock) → jobs → threads. Selecting a
 * thread routes the chat identity onto the universal runtime (see
 * `universalSlice.selectThread`).
 */
export function CustomAgentSection({ explorerWidth: _explorerWidth }: { explorerWidth: number }) {
  const { t } = useTranslation(['explorer', 'common']);
  const selectedProject = useStore((state) => state.selectedProject);
  const customAgents = useStore((state) => state.customAgents);
  const setCustomAgents = useStore((state) => state.setCustomAgents);
  const selectedCustomAgentId = useStore((state) => state.selectedCustomAgentId);
  const selectedCustomJobId = useStore((state) => state.selectedCustomJobId);
  const selectedThreadId = useStore((state) => state.selectedThreadId);
  const selectCustomJob = useStore((state) => state.selectCustomJob);
  const selectThread = useStore((state) => state.selectThread);
  const isRunning = useStore((state) => state.isRunning);

  const [expandedAgents, setExpandedAgents] = useState<ReadonlySet<string>>(new Set());
  const [threads, setThreads] = useState<CustomJobThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Inline create forms ──
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [agentScope, setAgentScope] = useState<'project' | 'user'>('project');
  const [jobFormAgentId, setJobFormAgentId] = useState<string | null>(null);
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAgents = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const { agents } = await fetchCustomAgents(selectedProject);
      setCustomAgents(agents);
      setError(null);
    } catch (err) {
      console.error('[CustomAgentSection] Failed to load custom agents:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProject, setCustomAgents]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const loadThreads = useCallback(async (agentId: string, jobId: string) => {
    if (!selectedProject) return;
    setThreadsLoading(true);
    try {
      const { threads: rows } = await fetchCustomJobThreads(selectedProject, agentId, jobId);
      setThreads(rows);
    } catch (err) {
      console.error('[CustomAgentSection] Failed to load threads:', err);
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, [selectedProject]);

  // Refresh the thread list when a job run finishes (lastActiveAt moved).
  useEffect(() => {
    if (isRunning) return;
    if (selectedCustomAgentId && selectedCustomJobId) {
      void loadThreads(selectedCustomAgentId, selectedCustomJobId);
    }
  }, [isRunning, selectedCustomAgentId, selectedCustomJobId, loadThreads]);

  const toggleAgent = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const handleJobClick = (agent: CustomAgentSummary, job: CustomJobSummary) => {
    selectCustomJob(agent.id, job.id);
    void loadThreads(agent.id, job.id);
  };

  const handleNewThread = () => {
    if (!selectedCustomAgentId || !selectedCustomJobId) return;
    const threadId = generateThreadId();
    selectThread(threadId);
  };

  const handleCreateAgent = async () => {
    if (!selectedProject || saving) return;
    const name = agentName.trim();
    const id = deriveCustomId(name);
    if (!name || !isValidCustomId(id)) return;
    setSaving(true);
    try {
      await createCustomAgent(selectedProject, {
        id,
        name,
        description: agentDescription.trim() || undefined,
        scope: agentScope,
      });
      setAgentName('');
      setAgentDescription('');
      setShowAgentForm(false);
      await loadAgents();
      setExpandedAgents((prev) => new Set(prev).add(id));
    } catch (err) {
      console.error('[CustomAgentSection] Failed to create agent:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateJob = async (agentId: string) => {
    if (!selectedProject || saving) return;
    const name = jobName.trim();
    const id = deriveCustomId(name);
    if (!name || !isValidCustomId(id)) return;
    setSaving(true);
    try {
      await createCustomJob(selectedProject, agentId, {
        id,
        name,
        description: jobDescription.trim() || undefined,
      });
      setJobName('');
      setJobDescription('');
      setJobFormAgentId(null);
      await loadAgents();
    } catch (err) {
      console.error('[CustomAgentSection] Failed to create job:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!selectedProject) return null;

  const headerButtonStyle: React.CSSProperties = {
    height: 22,
    width: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    color: 'var(--text-3)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all var(--dur-fast)',
  };

  return (
    <div>
      <SectionShell
        eyebrow={t('explorer:customAgent.title', { defaultValue: 'Agents' })}
        accent="pink"
        action={
          <>
            <button
              type="button"
              onClick={() => void loadAgents()}
              title={t('explorer:customAgent.refresh', { defaultValue: 'Refresh agents' })}
              aria-label={t('explorer:customAgent.refresh', { defaultValue: 'Refresh agents' })}
              style={headerButtonStyle}
            >
              <RefreshCw size={12} />
            </button>
            <button
              type="button"
              onClick={() => setShowAgentForm((v) => !v)}
              title={t('explorer:customAgent.create', { defaultValue: 'Register agent' })}
              aria-label={t('explorer:customAgent.create', { defaultValue: 'Register agent' })}
              style={headerButtonStyle}
            >
              <Plus size={12} />
            </button>
          </>
        }
      >
        {error && (
          <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--status-error-fg)' }}>
            {error}
          </div>
        )}

        {showAgentForm && (
          <InlineForm
            namePlaceholder={t('explorer:customAgent.namePlaceholder', { defaultValue: 'Agent name' })}
            descPlaceholder={t('explorer:customAgent.descPlaceholder', { defaultValue: 'Description (optional)' })}
            name={agentName}
            onNameChange={setAgentName}
            description={agentDescription}
            onDescriptionChange={setAgentDescription}
            idPreview={deriveCustomId(agentName.trim())}
            extra={
              <div style={{ display: 'flex', gap: 4 }}>
                {(['project', 'user'] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setAgentScope(scope)}
                    style={{
                      height: 20,
                      padding: '0 8px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      color: agentScope === scope ? 'var(--text-on-brand, white)' : 'var(--text-3)',
                      background: agentScope === scope ? SCOPE_BADGE_COLOR[scope] : 'transparent',
                      border: `1px solid ${agentScope === scope ? 'transparent' : 'var(--border-1)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            }
            canSubmit={!!agentName.trim() && isValidCustomId(deriveCustomId(agentName.trim())) && !saving}
            onSubmit={() => void handleCreateAgent()}
            onCancel={() => {
              setShowAgentForm(false);
              setAgentName('');
              setAgentDescription('');
            }}
          />
        )}

        {customAgents.length === 0 && !showAgentForm ? (
          <div
            style={{
              padding: '14px 8px',
              fontSize: 11,
              fontStyle: 'italic',
              color: 'var(--text-3)',
              textAlign: 'center',
            }}
          >
            {t('explorer:customAgent.placeholder', { defaultValue: 'No agents yet — register one with +' })}
          </div>
        ) : (
          <RowList ariaLabel={t('explorer:customAgent.title', { defaultValue: 'Agents' })} maxHeight={420}>
            {customAgents.map((agent) => {
              const expanded = expandedAgents.has(agent.id) || agent.id === selectedCustomAgentId;
              return (
                <div key={`${agent.scope}:${agent.id}`} role="listitem" style={{ minWidth: 0 }}>
                  {/* Agent row */}
                  <div
                    onClick={() => toggleAgent(agent.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleAgent(agent.id);
                      }
                    }}
                    tabIndex={0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      minWidth: 0,
                    }}
                  >
                    <ChevronRight
                      size={10}
                      style={{
                        transform: expanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform 200ms',
                        flexShrink: 0,
                        color: 'var(--text-3)',
                      }}
                    />
                    <Bot size={12} style={{ flexShrink: 0, color: 'var(--pink-600)' }} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--text-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={agent.description || agent.name}
                    >
                      {agent.name}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: SCOPE_BADGE_COLOR[agent.scope] ?? 'var(--text-3)',
                        background: `color-mix(in srgb, ${SCOPE_BADGE_COLOR[agent.scope] ?? 'var(--text-3)'} 14%, transparent)`,
                        padding: '1px 6px',
                        borderRadius: 999,
                        flexShrink: 0,
                      }}
                    >
                      {agent.scope}
                    </span>
                    {agent.readonly && (
                      <Lock size={10} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
                    )}
                    {!agent.readonly && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setJobFormAgentId((prev) => (prev === agent.id ? null : agent.id));
                          setExpandedAgents((prev) => new Set(prev).add(agent.id));
                        }}
                        title={t('explorer:customAgent.addJob', { defaultValue: 'Add job' })}
                        aria-label={t('explorer:customAgent.addJob', { defaultValue: 'Add job' })}
                        style={{ ...headerButtonStyle, height: 18, width: 18 }}
                      >
                        <Plus size={10} />
                      </button>
                    )}
                  </div>

                  {/* Job rows */}
                  {expanded && (
                    <div style={{ paddingLeft: 18 }}>
                      {jobFormAgentId === agent.id && (
                        <InlineForm
                          namePlaceholder={t('explorer:customAgent.jobNamePlaceholder', { defaultValue: 'Job name' })}
                          descPlaceholder={t('explorer:customAgent.descPlaceholder', { defaultValue: 'Description (optional)' })}
                          name={jobName}
                          onNameChange={setJobName}
                          description={jobDescription}
                          onDescriptionChange={setJobDescription}
                          idPreview={deriveCustomId(jobName.trim())}
                          canSubmit={!!jobName.trim() && isValidCustomId(deriveCustomId(jobName.trim())) && !saving}
                          onSubmit={() => void handleCreateJob(agent.id)}
                          onCancel={() => {
                            setJobFormAgentId(null);
                            setJobName('');
                            setJobDescription('');
                          }}
                        />
                      )}
                      {agent.jobs.length === 0 && jobFormAgentId !== agent.id && (
                        <div style={{ padding: '4px 10px', fontSize: 11, fontStyle: 'italic', color: 'var(--text-3)' }}>
                          {t('explorer:customAgent.noJobs', { defaultValue: 'No jobs yet' })}
                        </div>
                      )}
                      {agent.jobs.map((job) => {
                        const isSelectedJob =
                          agent.id === selectedCustomAgentId && job.id === selectedCustomJobId;
                        return (
                          <div key={job.id} style={{ minWidth: 0 }}>
                            <div
                              onClick={() => handleJobClick(agent, job)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleJobClick(agent, job);
                                }
                              }}
                              tabIndex={0}
                              title={job.description || job.name}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '5px 10px',
                                borderRadius: 6,
                                cursor: 'pointer',
                                background: isSelectedJob ? 'var(--select-fill-pink, var(--bg-hover))' : 'transparent',
                                minWidth: 0,
                              }}
                            >
                              <span
                                className="font-mono"
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  fontSize: 12,
                                  color: isSelectedJob ? 'var(--text-1)' : 'var(--text-2)',
                                  fontWeight: isSelectedJob ? 600 : 400,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {job.name}
                              </span>
                            </div>

                            {/* Threads of the selected job */}
                            {isSelectedJob && (
                              <div style={{ paddingLeft: 12 }}>
                                <button
                                  type="button"
                                  onClick={handleNewThread}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    width: '100%',
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: 'var(--pink-600)',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  <Plus size={11} />
                                  {t('explorer:customAgent.newThread', { defaultValue: 'New conversation' })}
                                </button>
                                {threadsLoading ? (
                                  <div style={{ padding: '2px 10px', fontSize: 11, color: 'var(--text-3)' }}>
                                    …
                                  </div>
                                ) : (
                                  threads.map((thread) => {
                                    const isActiveThread = thread.threadId === selectedThreadId;
                                    return (
                                      <div
                                        key={thread.threadId}
                                        onClick={() => selectThread(thread.threadId)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            selectThread(thread.threadId);
                                          }
                                        }}
                                        tabIndex={0}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          padding: '4px 10px',
                                          borderRadius: 6,
                                          cursor: 'pointer',
                                          background: isActiveThread ? 'var(--select-fill-pink, var(--bg-hover))' : 'transparent',
                                          minWidth: 0,
                                        }}
                                      >
                                        <MessageSquare
                                          size={10}
                                          style={{
                                            flexShrink: 0,
                                            color: isActiveThread ? 'var(--pink-600)' : 'var(--text-3)',
                                          }}
                                        />
                                        <span
                                          className="font-mono"
                                          style={{
                                            flex: 1,
                                            minWidth: 0,
                                            fontSize: 11,
                                            color: isActiveThread ? 'var(--text-1)' : 'var(--text-2)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {thread.threadId}
                                        </span>
                                        <span
                                          style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}
                                          title={thread.lastActiveAt}
                                        >
                                          {formatLastActive(thread.lastActiveAt)}
                                        </span>
                                      </div>
                                    );
                                  })
                                )}
                                {/* A freshly minted thread is not on the server yet — show it optimistically. */}
                                {!threadsLoading &&
                                  selectedThreadId &&
                                  !threads.some((th) => th.threadId === selectedThreadId) && (
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '4px 10px',
                                        borderRadius: 6,
                                        background: 'var(--select-fill-pink, var(--bg-hover))',
                                        minWidth: 0,
                                      }}
                                    >
                                      <MessageSquare size={10} style={{ flexShrink: 0, color: 'var(--pink-600)' }} />
                                      <span
                                        className="font-mono"
                                        style={{
                                          flex: 1,
                                          minWidth: 0,
                                          fontSize: 11,
                                          color: 'var(--text-1)',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {selectedThreadId}
                                      </span>
                                      <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
                                        {t('explorer:customAgent.newThreadBadge', { defaultValue: 'new' })}
                                      </span>
                                    </div>
                                  )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </RowList>
        )}
      </SectionShell>
    </div>
  );
}

function formatLastActive(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (diffMs < oneDay && new Date(now).getDate() === date.getDate()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Inline create form (agent / job) ────────────────────────────────

interface InlineFormProps {
  namePlaceholder: string;
  descPlaceholder: string;
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  idPreview: string;
  extra?: React.ReactNode;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

function InlineForm({
  namePlaceholder, descPlaceholder,
  name, onNameChange, description, onDescriptionChange,
  idPreview, extra, canSubmit, onSubmit, onCancel,
}: InlineFormProps) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 26,
    padding: '0 8px',
    borderRadius: 6,
    fontSize: 12,
    color: 'var(--text-1)',
    background: 'var(--surface-1)',
    border: '1px solid var(--border-1)',
    outline: 'none',
  };
  return (
    <div
      style={{
        margin: '4px 6px',
        padding: 8,
        borderRadius: 8,
        border: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={namePlaceholder}
        style={inputStyle}
      />
      <input
        type="text"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={descPlaceholder}
        style={inputStyle}
      />
      {extra}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {idPreview && (
          <span className="font-mono" style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            id: {idPreview}
          </span>
        )}
        <span style={{ flex: idPreview ? undefined : 1 }} />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-on-brand, white)',
            background: 'var(--gradient-aurora)',
            border: 'none',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          ✓
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-3)',
            background: 'transparent',
            border: '1px solid var(--border-1)',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
