/**
 * Overview form sections — each section reads ONE definition file, patches
 * yaml fields via `yaml.parseDocument` (comment-preserving), and saves
 * through the SAME single write funnel as the raw editor
 * (`saveDefinitionFile`). No section owns a bespoke endpoint.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDocument } from 'yaml';
import { useStore } from '@/domain/store';
import { fetchDefinitionFile, saveDefinitionFile } from '@/infrastructure/http/api/accountAgents';
import { Button, Input, Textarea } from '@/presentation/components/aurora';
import type { CustomIntentDef, DefinitionValidationResult } from '@ant/shared';

export interface OverviewSectionContext {
  agentId: string;
  /** undefined = agent-level overview; set = job-level overview. */
  jobId?: string;
  readonly: boolean;
  onSaved: (validation: DefinitionValidationResult) => void;
  onError: (message: string) => void;
}

export interface OverviewSectionDef {
  id: string;
  appliesTo: 'agent' | 'job' | 'both';
  Component: (props: { ctx: OverviewSectionContext }) => React.ReactElement | null;
}

function yamlPathFor(ctx: OverviewSectionContext, file: 'main' | 'intents'): string {
  if (ctx.jobId) return file === 'main' ? `jobs/${ctx.jobId}/job.yaml` : `jobs/${ctx.jobId}/intents.yaml`;
  return file === 'main' ? 'agent.yaml' : 'intents.yaml';
}

/**
 * Load → patch → save cycle over one yaml definition file. The patch runs on
 * a comment-preserving `yaml` Document; the serialized document goes through
 * the shared write funnel.
 */
function useYamlFile(ctx: OverviewSectionContext, file: 'main' | 'intents') {
  const path = yamlPathFor(ctx, file);
  const [raw, setRaw] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { content } = await fetchDefinitionFile(ctx.agentId, path);
      setRaw(content);
      setMissing(false);
    } catch {
      setRaw(null);
      setMissing(true);
    }
  }, [ctx.agentId, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (patch: (doc: ReturnType<typeof parseDocument>) => void) => {
      const doc = parseDocument(raw ?? '');
      patch(doc);
      try {
        const { validation } = await saveDefinitionFile(ctx.agentId, path, doc.toString());
        ctx.onSaved(validation);
        await reload();
        return true;
      } catch (e) {
        ctx.onError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [ctx, path, raw, reload],
  );

  return { raw, missing, save, reload, path };
}

function SectionShellCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── General (name / description) ─────────────────────────────────────────────

function GeneralSection({ ctx }: { ctx: OverviewSectionContext }) {
  const { t } = useTranslation('agents');
  const { raw, save } = useYamlFile(ctx, 'main');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (raw == null) return;
    const doc = parseDocument(raw);
    setName(String(doc.get('name') ?? ''));
    setDescription(String(doc.get('description') ?? ''));
    setDirty(false);
  }, [raw]);

  if (raw == null) return null;

  return (
    <SectionShellCard title={t('overview.general', 'General')}>
      <Input
        value={name}
        disabled={ctx.readonly}
        onChange={(e) => { setName(e.target.value); setDirty(true); }}
        placeholder={t('overview.name', 'Name')}
      />
      <Textarea
        value={description}
        disabled={ctx.readonly}
        onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
        placeholder={t('overview.description', 'Description')}
        rows={2}
      />
      {!ctx.readonly && dirty && (
        <div>
          <Button
            size="sm"
            onClick={() => void save((doc) => { doc.set('name', name); doc.set('description', description); }).then((ok) => ok && setDirty(false))}
          >
            {t('overview.save', 'Save')}
          </Button>
        </div>
      )}
    </SectionShellCard>
  );
}

// ── Tools (builtin allowlist, narrowing-only) ────────────────────────────────

function ToolsSection({ ctx }: { ctx: OverviewSectionContext }) {
  const { t } = useTranslation('agents');
  const builtinToolPreset = useStore((s) => s.builtinToolPreset);
  const { raw, save } = useYamlFile(ctx, 'main');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (raw == null) return;
    const doc = parseDocument(raw);
    const listed = doc.getIn(['tools', 'builtin']);
    const arr = listed && typeof (listed as any).toJSON === 'function' ? (listed as any).toJSON() : listed;
    setSelected(Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : null);
    setDirty(false);
  }, [raw]);

  if (raw == null || builtinToolPreset.length === 0) return null;
  const effective = selected ?? new Set(builtinToolPreset);

  const toggle = (tool: string) => {
    const next = new Set(effective);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    setSelected(next);
    setDirty(true);
  };

  return (
    <SectionShellCard title={t('overview.tools', 'Tools')}>
      <div className="text-xs" style={{ color: 'var(--text-4)' }}>
        {t('overview.toolsHint', 'Narrowing only — a job can restrict but never add beyond this set.')}
      </div>
      <div className="flex flex-wrap gap-2">
        {builtinToolPreset.map((tool) => (
          <label key={tool} className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-2)' }}>
            <input
              type="checkbox"
              disabled={ctx.readonly}
              checked={effective.has(tool)}
              onChange={() => toggle(tool)}
            />
            {tool}
          </label>
        ))}
      </div>
      {!ctx.readonly && dirty && (
        <div>
          <Button
            size="sm"
            onClick={() => void save((doc) => {
              if (effective.size === builtinToolPreset.length) {
                doc.deleteIn(['tools', 'builtin']);
              } else {
                doc.setIn(['tools', 'builtin'], [...effective]);
              }
            }).then((ok) => ok && setDirty(false))}
          >
            {t('overview.save', 'Save')}
          </Button>
        </div>
      )}
    </SectionShellCard>
  );
}

// ── enum field sections (workspace / plan / outputs.mode) ────────────────────

function EnumSection({
  ctx,
  title,
  yamlPath,
  options,
  clearValue,
}: {
  ctx: OverviewSectionContext;
  title: string;
  yamlPath: string[];
  options: string[];
  /** Value meaning "remove the key" (inherit default). */
  clearValue?: string;
}) {
  const { t } = useTranslation('agents');
  const { raw, save } = useYamlFile(ctx, 'main');
  const [value, setValue] = useState<string>('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (raw == null) return;
    const doc = parseDocument(raw);
    setValue(String(doc.getIn(yamlPath) ?? clearValue ?? ''));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  if (raw == null) return null;

  return (
    <SectionShellCard title={title}>
      <div className="flex items-center gap-2">
        <select
          value={value}
          disabled={ctx.readonly}
          onChange={(e) => { setValue(e.target.value); setDirty(true); }}
          className="text-sm rounded-md px-2 py-1"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
        >
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {!ctx.readonly && dirty && (
          <Button
            size="sm"
            onClick={() => void save((doc) => {
              if (clearValue !== undefined && value === clearValue) doc.deleteIn(yamlPath);
              else doc.setIn(yamlPath, value);
            }).then((ok) => ok && setDirty(false))}
          >
            {t('overview.save', 'Save')}
          </Button>
        )}
      </div>
    </SectionShellCard>
  );
}

function WorkspaceSection({ ctx }: { ctx: OverviewSectionContext }) {
  const { t } = useTranslation('agents');
  return (
    <EnumSection
      ctx={ctx}
      title={t('overview.workspace', 'Workspace access')}
      yamlPath={['workspace']}
      options={['none', 'read']}
      clearValue="none"
    />
  );
}

function PlanSection({ ctx }: { ctx: OverviewSectionContext }) {
  const { t } = useTranslation('agents');
  return (
    <EnumSection
      ctx={ctx}
      title={t('overview.plan', 'Plan convention')}
      yamlPath={['plan']}
      options={['suggested', 'required', 'off']}
      clearValue="suggested"
    />
  );
}

function OutputsSection({ ctx }: { ctx: OverviewSectionContext }) {
  const { t } = useTranslation('agents');
  const { raw, save } = useYamlFile(ctx, 'main');
  const [mode, setMode] = useState<string>('free');
  const [artifacts, setArtifacts] = useState<Array<Record<string, string>>>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (raw == null) return;
    const doc = parseDocument(raw);
    setMode(String(doc.getIn(['outputs', 'mode']) ?? 'free'));
    const arts = doc.getIn(['outputs', 'artifacts']);
    const arr = arts && typeof (arts as any).toJSON === 'function' ? (arts as any).toJSON() : arts;
    setArtifacts(Array.isArray(arr) ? arr : []);
    setDirty(false);
  }, [raw]);

  if (raw == null) return null;

  return (
    <SectionShellCard title={t('overview.outputs', 'Outputs')}>
      <div className="flex items-center gap-2">
        <select
          value={mode}
          disabled={ctx.readonly}
          onChange={(e) => { setMode(e.target.value); setDirty(true); }}
          className="text-sm rounded-md px-2 py-1"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
        >
          {['none', 'free', 'contract'].map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
      {mode === 'contract' && artifacts.length > 0 && (
        <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
          {artifacts.map((a, i) => (
            <div key={i} className="font-mono">
              {a.kind} → {a.dir} (.{a.format}, {a.naming}{a.update ? `, ${a.update}` : ''})
            </div>
          ))}
          <div style={{ color: 'var(--text-4)' }}>
            {t('overview.outputsEditHint', 'Edit artifact rows in the Files tab (job.yaml).')}
          </div>
        </div>
      )}
      {!ctx.readonly && dirty && (
        <div>
          <Button
            size="sm"
            onClick={() => void save((doc) => { doc.setIn(['outputs', 'mode'], mode); }).then((ok) => ok && setDirty(false))}
          >
            {t('overview.save', 'Save')}
          </Button>
        </div>
      )}
    </SectionShellCard>
  );
}

// ── Intents (intents.yaml — WS5 schema) ──────────────────────────────────────

function IntentsSection({ ctx }: { ctx: OverviewSectionContext }) {
  const { t } = useTranslation('agents');
  const { raw, missing, save } = useYamlFile(ctx, 'intents');
  const [entries, setEntries] = useState<CustomIntentDef[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (raw == null) { setEntries([]); setDirty(false); return; }
    const doc = parseDocument(raw);
    const listed = doc.get('intents');
    const arr = listed && typeof (listed as any).toJSON === 'function' ? (listed as any).toJSON() : listed;
    setEntries(
      Array.isArray(arr)
        ? arr.filter((e): e is CustomIntentDef => !!e && typeof e === 'object' && typeof e.id === 'string')
        : [],
    );
    setDirty(false);
  }, [raw]);

  const update = (idx: number, patch: Partial<CustomIntentDef>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
    setDirty(true);
  };

  const persist = () =>
    void save((doc) => {
      doc.set('version', doc.get('version') ?? 1);
      doc.set(
        'intents',
        entries.map((e) => ({
          id: e.id,
          description: e.description,
          ...(e.injections && e.injections.length > 0 ? { injections: e.injections } : {}),
        })),
      );
    }).then((ok) => ok && setDirty(false));

  return (
    <SectionShellCard title={t('overview.intents', 'Intents')}>
      <div className="text-xs" style={{ color: 'var(--text-4)' }}>
        {missing
          ? t('overview.intentsMissing', 'No intents.yaml yet — adding an entry creates it.')
          : t('overview.intentsHint', 'Descriptions ARE the classification criteria; injections inline in full when the intent is active.')}
      </div>
      {entries.map((entry, idx) => (
        <div key={idx} className="flex flex-col gap-1 rounded-md p-2" style={{ border: '1px solid var(--border-1)' }}>
          <div className="flex items-center gap-2">
            <Input
              value={entry.id}
              disabled={ctx.readonly}
              onChange={(e) => update(idx, { id: e.target.value })}
              placeholder="intent-id"
            />
            {!ctx.readonly && (
              <Button size="sm" variant="ghost" onClick={() => { setEntries((prev) => prev.filter((_, i) => i !== idx)); setDirty(true); }}>
                {t('overview.remove', 'Remove')}
              </Button>
            )}
          </div>
          <Textarea
            value={entry.description}
            disabled={ctx.readonly}
            onChange={(e) => update(idx, { description: e.target.value })}
            placeholder={t('overview.intentDescription', 'Matching criterion (rendered verbatim as a catalog row)')}
            rows={2}
          />
          <Input
            value={(entry.injections ?? []).join(', ')}
            disabled={ctx.readonly}
            onChange={(e) =>
              update(idx, {
                injections: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={t('overview.intentInjections', 'injections/*.md file names, comma-separated')}
          />
        </div>
      ))}
      {!ctx.readonly && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setEntries((prev) => [...prev, { id: '', description: '' }]); setDirty(true); }}
          >
            {t('overview.addIntent', 'Add intent')}
          </Button>
          {dirty && (
            <Button size="sm" onClick={persist}>
              {t('overview.save', 'Save')}
            </Button>
          )}
        </div>
      )}
    </SectionShellCard>
  );
}

/** Section registry — Overview renders the entries matching the selection level. */
export const OVERVIEW_SECTIONS: OverviewSectionDef[] = [
  { id: 'general', appliesTo: 'both', Component: GeneralSection },
  { id: 'tools', appliesTo: 'both', Component: ToolsSection },
  { id: 'workspace', appliesTo: 'both', Component: WorkspaceSection },
  { id: 'outputs', appliesTo: 'job', Component: OutputsSection },
  { id: 'plan', appliesTo: 'job', Component: PlanSection },
  { id: 'intents', appliesTo: 'both', Component: IntentsSection },
];
