import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Lock, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { isValidCustomId, type CustomAgentScope, type CustomAgentSummary } from '@ant/shared';
import { useStore } from '@/domain/store';
import {
  createCustomAgent,
  createCustomJob,
  deleteCustomAgent,
  deleteCustomJob,
  fetchCustomAgents,
  updateCustomAgent,
  updateCustomJob,
  validateCustomJob,
} from '@/infrastructure/http/api/customAgents';
import { SectionCard } from '../aurora';

/**
 * Settings → Agents — management surface for custom agent/job definitions.
 *
 * Definitions are account/org-owned (never project-owned): mutations target
 * only the `user` scope (`workspaces/{org}/{user}/.ant/agents`, shared across
 * the account's projects); `org`/`builtin` rows are read-only. The chat
 * composer's agent/job chips read the same list via universalSlice, so every
 * mutation here re-syncs `loadCustomAgents`.
 */

const SCOPE_BADGE_COLOR: Record<CustomAgentScope, string> = {
  user: 'var(--teal-500, oklch(70% 0.12 190))',
  org: 'var(--orange-500)',
  builtin: 'var(--blue-500, oklch(65% 0.15 250))',
};

function deriveCustomId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

interface InlineFormState {
  /** 'agent' = create agent; agentId = create/edit under that agent. */
  kind: 'create-agent' | 'create-job' | 'edit-agent' | 'edit-job';
  agentId?: string;
  jobId?: string;
  name: string;
  description: string;
}

export function CustomAgentsSection() {
  const { t } = useTranslation('config');
  const selectedProject = useStore((state) => state.selectedProject);
  const loadCustomAgents = useStore((state) => state.loadCustomAgents);

  const [agents, setAgents] = useState<CustomAgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<InlineFormState | null>(null);
  const [validation, setValidation] = useState<Record<string, { valid: boolean; error?: string }>>({});

  const refresh = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const { agents: list } = await fetchCustomAgents(selectedProject);
      setAgents(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const afterMutation = async () => {
    setForm(null);
    await refresh();
    if (selectedProject) void loadCustomAgents(selectedProject);
  };

  const submitForm = async () => {
    if (!selectedProject || !form) return;
    const name = form.name.trim();
    if (!name) return;
    try {
      if (form.kind === 'create-agent') {
        const id = deriveCustomId(name);
        if (!isValidCustomId(id)) throw new Error(t('agents.invalidName', { defaultValue: 'Name must contain letters or digits' }));
        await createCustomAgent(selectedProject, { id, name, description: form.description.trim() });
      } else if (form.kind === 'create-job' && form.agentId) {
        const id = deriveCustomId(name);
        if (!isValidCustomId(id)) throw new Error(t('agents.invalidName', { defaultValue: 'Name must contain letters or digits' }));
        await createCustomJob(selectedProject, form.agentId, { id, name, description: form.description.trim() });
      } else if (form.kind === 'edit-agent' && form.agentId) {
        await updateCustomAgent(selectedProject, form.agentId, { name, description: form.description.trim() });
      } else if (form.kind === 'edit-job' && form.agentId && form.jobId) {
        await updateCustomJob(selectedProject, form.agentId, form.jobId, { name, description: form.description.trim() });
      }
      setError(null);
      await afterMutation();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!selectedProject) return;
    if (!window.confirm(t('agents.deleteAgentConfirm', { defaultValue: 'Delete this agent and all its jobs?' }))) return;
    try {
      await deleteCustomAgent(selectedProject, agentId);
      setError(null);
      await afterMutation();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeJob = async (agentId: string, jobId: string) => {
    if (!selectedProject) return;
    if (!window.confirm(t('agents.deleteJobConfirm', { defaultValue: 'Delete this job?' }))) return;
    try {
      await deleteCustomJob(selectedProject, agentId, jobId);
      setError(null);
      await afterMutation();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runValidate = async (agentId: string, jobId: string) => {
    if (!selectedProject) return;
    const key = `${agentId}/${jobId}`;
    try {
      const result = await validateCustomJob(selectedProject, agentId, jobId);
      setValidation((prev) => ({ ...prev, [key]: { valid: result.valid !== false, error: result.error } }));
    } catch (e: any) {
      setValidation((prev) => ({
        ...prev,
        [key]: { valid: false, error: e?.data?.error ?? (e instanceof Error ? e.message : String(e)) },
      }));
    }
  };

  const smallButton: React.CSSProperties = {
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
  };

  const renderInlineForm = () =>
    form && (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0' }}>
        <input
          type="text"
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitForm();
            if (e.key === 'Escape') setForm(null);
          }}
          placeholder={t('agents.namePlaceholder', { defaultValue: 'Name' })}
          style={{
            width: 160,
            height: 26,
            padding: '0 8px',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text-1)',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-1)',
            outline: 'none',
          }}
        />
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitForm();
            if (e.key === 'Escape') setForm(null);
          }}
          placeholder={t('agents.descPlaceholder', { defaultValue: 'Description (optional)' })}
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            padding: '0 8px',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text-1)',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-1)',
            outline: 'none',
          }}
        />
        <button type="button" onClick={() => void submitForm()} disabled={!form.name.trim()} style={smallButton} title={t('common:save', { defaultValue: 'Save' })}>
          <Check size={13} style={{ color: 'var(--emerald-500)' }} />
        </button>
        <button type="button" onClick={() => setForm(null)} style={smallButton} title={t('common:cancel', { defaultValue: 'Cancel' })}>
          <X size={13} />
        </button>
      </div>
    );

  return (
    <SectionCard
      id="c3p-agents"
      icon="Bot"
      title={t('agents.title', { defaultValue: 'Agents' })}
      accent="violet-pink"
      description={t('agents.description', {
        defaultValue: 'Custom agents and jobs are account-owned definitions (.ant/agents) shared across your workspace projects.',
      })}
      bodyMaxWidth={720}
      statusAction={
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setForm({ kind: 'create-agent', name: '', description: '' })}
            style={smallButton}
            title={t('agents.createAgent', { defaultValue: 'Register agent' })}
            aria-label={t('agents.createAgent', { defaultValue: 'Register agent' })}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            style={smallButton}
            title={t('agents.refresh', { defaultValue: 'Refresh' })}
            aria-label={t('agents.refresh', { defaultValue: 'Refresh' })}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      }
    >
      {error && (
        <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--status-error-fg)' }}>{error}</div>
      )}
      {form?.kind === 'create-agent' && renderInlineForm()}
      {agents.length === 0 && !loading ? (
        <div style={{ padding: '10px 0', fontSize: 12, fontStyle: 'italic', color: 'var(--text-3)' }}>
          {t('agents.placeholder', { defaultValue: 'No agents yet — register one with +' })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {agents.map((agent) => {
            const writable = !agent.readonly;
            return (
              <div
                key={`${agent.scope}:${agent.id}`}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Bot size={14} style={{ flexShrink: 0, color: SCOPE_BADGE_COLOR[agent.scope] }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{agent.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 6px',
                      borderRadius: 999,
                      color: SCOPE_BADGE_COLOR[agent.scope],
                      border: `1px solid ${SCOPE_BADGE_COLOR[agent.scope]}`,
                    }}
                  >
                    {t(`agents.scope.${agent.scope}`, { defaultValue: agent.scope })}
                  </span>
                  {agent.readonly && <Lock size={11} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
                  <span style={{ flex: 1 }} />
                  {writable && (
                    <>
                      <button
                        type="button"
                        onClick={() => setForm({ kind: 'create-job', agentId: agent.id, name: '', description: '' })}
                        style={smallButton}
                        title={t('agents.addJob', { defaultValue: 'Add job' })}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm({ kind: 'edit-agent', agentId: agent.id, name: agent.name, description: agent.description })}
                        style={smallButton}
                        title={t('agents.edit', { defaultValue: 'Edit' })}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeAgent(agent.id)}
                        style={smallButton}
                        title={t('agents.delete', { defaultValue: 'Delete' })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
                {agent.description && (
                  <div style={{ marginTop: 2, marginLeft: 22, fontSize: 11, color: 'var(--text-3)' }}>{agent.description}</div>
                )}
                {((form?.kind === 'create-job' || form?.kind === 'edit-agent') && form.agentId === agent.id) && (
                  <div style={{ marginLeft: 22 }}>{renderInlineForm()}</div>
                )}
                <div style={{ marginTop: 6, marginLeft: 22, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {agent.jobs.length === 0 ? (
                    <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-3)' }}>
                      {t('agents.noJobs', { defaultValue: 'No jobs yet' })}
                    </div>
                  ) : (
                    agent.jobs.map((job) => {
                      const vKey = `${agent.id}/${job.id}`;
                      const v = validation[vKey];
                      return (
                        <div key={job.id}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{job.name}</span>
                            {job.description && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: 'var(--text-3)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  minWidth: 0,
                                }}
                              >
                                {job.description}
                              </span>
                            )}
                            <span style={{ flex: 1 }} />
                            {v && (
                              <span style={{ fontSize: 10, color: v.valid ? 'var(--emerald-500)' : 'var(--status-error-fg)' }} title={v.error}>
                                {v.valid ? t('agents.valid', { defaultValue: '✓ valid' }) : `✗ ${v.error ?? 'invalid'}`}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void runValidate(agent.id, job.id)}
                              style={{ ...smallButton, width: 'auto', padding: '0 6px', fontSize: 10 }}
                              title={t('agents.validate', { defaultValue: 'Validate' })}
                            >
                              {t('agents.validate', { defaultValue: 'Validate' })}
                            </button>
                            {writable && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setForm({ kind: 'edit-job', agentId: agent.id, jobId: job.id, name: job.name, description: job.description })}
                                  style={smallButton}
                                  title={t('agents.edit', { defaultValue: 'Edit' })}
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeJob(agent.id, job.id)}
                                  style={smallButton}
                                  title={t('agents.delete', { defaultValue: 'Delete' })}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </>
                            )}
                          </div>
                          {form?.kind === 'edit-job' && form.agentId === agent.id && form.jobId === job.id && renderInlineForm()}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
