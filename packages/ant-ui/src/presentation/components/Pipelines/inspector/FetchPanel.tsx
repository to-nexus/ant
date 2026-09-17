/**
 * The fetch trigger's form — connection (a job's declared external api, or an
 * inline baseUrl + headers), the polled request, the item selection (items /
 * key / fields), and the poll cadence. The validator owns every rule; this
 * form only shapes the object and round-trips "what would a poll see" through
 * `preview-fetch` (the caller's own credentials, no claim).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_PIPELINE_CAPS,
  fetchConnectionSource,
  MCP_HEADER_NAME_PATTERN,
  parseCustomJobRef,
  PIPELINE_FETCH_FIELD_NAME_PATTERN,
  type CustomAgentSummary,
  type PipelineDef,
  type PipelineFetchConnectionSource,
  type PipelineFetchTrigger,
} from '@ant/shared';
import { useStore } from '@/domain/store';
import { previewPipelineFetch, type PipelineFetchPreview } from '@/infrastructure/http/api/pipelines';
import { AuroraInput, AuroraSelect, FieldHint, FieldLabel } from '../../ConfigEditor/aurora';
import { Textarea } from '../../aurora';
import { Badge, Button } from '../../aurora';
import { HintBadge } from '../../common/HintBadge';
import { DEFAULT_FETCH_TRIGGER, setFetchConnectionSource, updateFetch, updateFetchBinding, updateFetchConnection } from '../draft';
import { SectionHeading } from './SectionHeading';
import { withCurrentValue } from './selectOptions';

const EVERY_PRESETS = ['1m', '5m', '15m', '30m', '1h', '6h', '1d'] as const;
const BATCH_OPTIONS = Array.from({ length: DEFAULT_PIPELINE_CAPS.maxFetchBatch }, (_, i) => i + 1);

/** `name = value` lines ⇄ the query map — the only shape a person edits by hand here. */
function queryToLines(query: PipelineFetchTrigger['request']['query']): string {
  return Object.entries(query ?? {})
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join('\n');
}
function linesToQuery(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    if (k) out[k] = line.slice(eq + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function FetchPanel({ def, onChange, customAgents }: { def: PipelineDef; onChange: (d: PipelineDef) => void; customAgents: CustomAgentSummary[] }) {
  const { t } = useTranslation('pipelines');
  const fetch: PipelineFetchTrigger = def.on?.fetch ?? DEFAULT_FETCH_TRIGGER;
  const patch = (p: Parameters<typeof updateFetch>[1]) => onChange(updateFetch(def, p));
  const patchRequest = (p: Partial<PipelineFetchTrigger['request']>) => patch({ request: { ...fetch.request, ...p } });
  const unknown = (v: string) => t('inspector.unknownValue', 'Unknown value: {{v}}', { v });

  const source = fetchConnectionSource(fetch);
  const connection = fetch.connection ?? { baseUrl: '' };
  const headerRows = useMemo(() => Object.entries(connection.headers ?? {}), [connection.headers]);
  const setHeaders = (rows: Array<[string, string]>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of rows) next[k] = v;
    onChange(updateFetchConnection(def, { headers: rows.length > 0 ? next : undefined }));
  };
  const connectionReady = source === 'inline' ? connection.baseUrl.trim() !== '' : Boolean(fetch.api && parseCustomJobRef(fetch.customJobRef ?? ''));

  const ref = parseCustomJobRef(fetch.customJobRef ?? '');
  const agent = customAgents.find((a) => a.id === ref?.agentId);
  const job = agent?.jobs.find((j) => j.id === ref?.jobId);
  // External connections only — a self entry targets this Ant server, which is not a case source.
  const apiNames = Object.entries(job?.apis ?? {})
    .filter(([, meta]) => !meta.self)
    .map(([name]) => name);
  const agentSel = withCurrentValue(customAgents.map((a) => ({ value: a.id, label: a.name })), ref?.agentId, unknown);
  const jobSel = withCurrentValue((agent?.jobs ?? []).map((j) => ({ value: j.id, label: j.name })), ref?.jobId, unknown);
  const apiSel = withCurrentValue(apiNames.map((n) => ({ value: n, label: n })), fetch.api ?? '', unknown);

  const [queryText, setQueryText] = useState(() => queryToLines(fetch.request.query));
  const [bodyText, setBodyText] = useState(() => (fetch.request.body ? JSON.stringify(fetch.request.body, null, 2) : ''));
  const [bodyInvalid, setBodyInvalid] = useState(false);
  const everyIsPreset = (EVERY_PRESETS as readonly string[]).includes(fetch.every);
  const [customEvery, setCustomEvery] = useState(!everyIsPreset);

  const selectedProject = useStore((s) => s.selectedProject);
  const [preview, setPreview] = useState<PipelineFetchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await previewPipelineFetch(fetch, selectedProject ?? undefined));
    } catch (e) {
      setPreview({ ok: false, error: e instanceof Error ? e.message : String(e), items: [], seen: 0, skipped: 0 });
    } finally {
      setPreviewing(false);
    }
  };

  const fieldRows = useMemo(() => Object.entries(fetch.fields ?? {}), [fetch.fields]);
  const setFields = (rows: Array<[string, string]>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of rows) next[k] = v;
    patch({ fields: rows.length > 0 ? next : undefined });
  };

  return (
    <>
      <SectionHeading>{t('trigger.fetch.connection', 'Connection')}</SectionHeading>
      <div>
        <FieldLabel>{t('trigger.fetch.source', 'Connection source')}</FieldLabel>
        <AuroraSelect
          value={source}
          onChange={(v) => onChange(setFetchConnectionSource(def, v as PipelineFetchConnectionSource))}
          options={[
            { value: 'bound', label: t('trigger.fetch.sourceBound', "An agent's declared apis entry") },
            { value: 'inline', label: t('trigger.fetch.sourceInline', 'Inline — this pipeline only') },
          ]}
        />
        <FieldHint tone="muted">
          {t(
            'trigger.fetch.sourceHint',
            "Reuse a job's apis entry when a step already reaches this system; otherwise declare the connection here, so no agent gains tools it has no use for.",
          )}
        </FieldHint>
      </div>
      <FieldHint tone="muted">{t('trigger.fetch.connectionHint', "The poll runs with the activator's own credentials for this connection.")}</FieldHint>
      {source === 'bound' ? (
        <>
          <div>
            <FieldLabel required>{t('trigger.fetch.agent', 'Agent')}</FieldLabel>
            <AuroraSelect
              value={ref?.agentId ?? ''}
              hasError={agentSel.hasError}
              onChange={(agentId) => {
                const firstJob = customAgents.find((a) => a.id === agentId)?.jobs[0]?.id ?? '';
                onChange(updateFetchBinding(def, { customJobRef: firstJob ? `${agentId}/${firstJob}` : '', api: '' }));
              }}
              placeholder={t('step.pickAgent', 'Choose an agent')}
              options={agentSel.options}
            />
          </div>
          <div>
            <FieldLabel required>{t('trigger.fetch.job', 'Job')}</FieldLabel>
            <AuroraSelect
              value={ref?.jobId ?? ''}
              hasError={jobSel.hasError}
              disabled={!agent}
              onChange={(jobId) => {
                if (ref) onChange(updateFetchBinding(def, { customJobRef: `${ref.agentId}/${jobId}`, api: '' }));
              }}
              placeholder={t('step.pickJob', 'Choose a job')}
              options={jobSel.options}
            />
          </div>
          <div>
            <FieldLabel required>{t('trigger.fetch.api', 'API connection')}</FieldLabel>
            {job && apiNames.length === 0 && !fetch.api ? (
              <FieldHint tone="warn">{t('trigger.fetch.apiNone', 'This job declares no external API connection — add one under apis in Agent Settings.')}</FieldHint>
            ) : (
              <AuroraSelect
                value={fetch.api ?? ''}
                hasError={apiSel.hasError}
                disabled={!job}
                onChange={(api) => onChange(updateFetchBinding(def, { api }))}
                placeholder={t('trigger.fetch.apiPick', 'Choose a connection')}
                options={apiSel.options}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <div>
            <FieldLabel required>{t('trigger.fetch.baseUrl', 'Base URL')}</FieldLabel>
            <AuroraInput mono value={connection.baseUrl} placeholder="https://jira.example.com/rest" onChange={(v) => onChange(updateFetchConnection(def, { baseUrl: v }))} />
          </div>
          <div>
            <FieldLabel
              optional
              action={
                <button
                  onClick={() => setHeaders([...headerRows, ['', '']])}
                  style={{ background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
                >
                  <Plus size={11} /> {t('trigger.fetch.addHeader', 'Add header')}
                </button>
              }
            >
              {t('trigger.fetch.headers', 'Headers')}
            </FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {headerRows.map(([name, value], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, alignItems: 'center' }}>
                  <AuroraInput
                    mono
                    value={name}
                    hasError={name.length > 0 && !MCP_HEADER_NAME_PATTERN.test(name)}
                    placeholder={t('trigger.fetch.headerName', 'Header')}
                    onChange={(v) => setHeaders(headerRows.map((row, j) => (j === i ? [v, row[1]] : row)))}
                  />
                  <AuroraInput
                    mono
                    value={value}
                    placeholder={t('trigger.fetch.headerValue', 'Value')}
                    onChange={(v) => setHeaders(headerRows.map((row, j) => (j === i ? [row[0], v] : row)))}
                  />
                  <button
                    aria-label={t('trigger.fetch.removeHeader', 'Remove header')}
                    onClick={() => setHeaders(headerRows.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <FieldHint tone="muted">
              {t('trigger.fetch.secretHint', 'Write credentials as ${secret:KEY} — the value stays in credential settings, registered by whoever activates the pipeline.')}
            </FieldHint>
          </div>
        </>
      )}

      <SectionHeading>{t('trigger.fetch.request', 'Request')}</SectionHeading>
      <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 6 }}>
        <div>
          <FieldLabel>{t('trigger.fetch.method', 'Method')}</FieldLabel>
          <AuroraSelect
            value={fetch.request.method}
            onChange={(v) => patchRequest({ method: v as 'GET' | 'POST', ...(v === 'GET' && { body: undefined }) })}
            options={[
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
            ]}
          />
        </div>
        <div>
          <FieldLabel required>{t('trigger.fetch.path', 'Path')}</FieldLabel>
          <AuroraInput mono value={fetch.request.path} placeholder="/rest/api/3/search" onChange={(v) => patchRequest({ path: v })} />
        </div>
      </div>
      <FieldHint tone="muted">{t('trigger.fetch.pathHint', "Relative to the connection's base URL, within its allow rules.")}</FieldHint>
      <div>
        <FieldLabel optional>{t('trigger.fetch.query', 'Query parameters')}</FieldLabel>
        <Textarea
          value={queryText}
          rows={2}
          placeholder={t('trigger.fetch.queryHint', 'One per line: name = value')}
          onChange={(e) => {
            setQueryText(e.target.value);
            patchRequest({ query: linesToQuery(e.target.value) });
          }}
        />
      </div>
      {fetch.request.method === 'POST' && (
        <div>
          <FieldLabel optional>{t('trigger.fetch.body', 'JSON body')}</FieldLabel>
          <Textarea
            value={bodyText}
            rows={3}
            placeholder='{ "jql": "status = Open" }'
            onChange={(e) => {
              setBodyText(e.target.value);
              const text = e.target.value.trim();
              if (!text) {
                setBodyInvalid(false);
                patchRequest({ body: undefined });
                return;
              }
              try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  setBodyInvalid(false);
                  patchRequest({ body: parsed as Record<string, unknown> });
                } else {
                  setBodyInvalid(true);
                }
              } catch {
                setBodyInvalid(true);
              }
            }}
          />
          {bodyInvalid && <FieldHint tone="warn">{t('trigger.fetch.bodyInvalid', 'Body must be a JSON object')}</FieldHint>}
        </div>
      )}

      <SectionHeading>{t('trigger.fetch.selection', 'Items')}</SectionHeading>
      <div>
        <FieldLabel required>{t('trigger.fetch.items', 'Items path')}</FieldLabel>
        <AuroraInput mono value={fetch.items} placeholder="$.issues" onChange={(v) => patch({ items: v })} />
        <FieldHint tone="muted">{t('trigger.fetch.itemsHint', 'Where the item array is in the response, e.g. $.issues')}</FieldHint>
      </div>
      <div>
        <FieldLabel required>{t('trigger.fetch.key', 'Key path')}</FieldLabel>
        <AuroraInput mono value={fetch.key} placeholder="$.key" onChange={(v) => patch({ key: v })} />
        <FieldHint tone="muted">{t('trigger.fetch.keyHint', "Each item's unique key — the run's label and its dedupe identity, e.g. $.key")}</FieldHint>
      </div>
      <div>
        <FieldLabel
          optional
          action={
            <button
              onClick={() => setFields([...fieldRows, ['', '$.']])}
              style={{ background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
            >
              <Plus size={11} /> {t('trigger.fetch.addField', 'Add field')}
            </button>
          }
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {t('trigger.fetch.fields', 'Fields')}
            <HintBadge isCompact label={t('trigger.fetch.fields', 'Fields')} tooltip={t('trigger.fetch.fieldsHint', 'Each field becomes {{trigger.item.<name>}} in step directives.')} />
          </span>
        </FieldLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fieldRows.map(([name, itemPath], i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, alignItems: 'center' }}>
              <AuroraInput
                mono
                value={name}
                hasError={name.length > 0 && (!PIPELINE_FETCH_FIELD_NAME_PATTERN.test(name) || name === 'key')}
                placeholder={t('trigger.fetch.fieldName', 'name')}
                onChange={(v) => setFields(fieldRows.map((row, j) => (j === i ? [v, row[1]] : row)))}
              />
              <AuroraInput mono value={itemPath} placeholder={t('trigger.fetch.fieldPath', '$.path')} onChange={(v) => setFields(fieldRows.map((row, j) => (j === i ? [row[0], v] : row)))} />
              <button
                aria-label={t('trigger.fetch.removeField', 'Remove field')}
                onClick={() => setFields(fieldRows.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <SectionHeading>{t('trigger.fetch.schedule', 'Polling')}</SectionHeading>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <FieldLabel>{t('trigger.fetch.every', 'Poll every')}</FieldLabel>
          {customEvery ? (
            <AuroraInput mono value={fetch.every} placeholder="5m" onChange={(v) => patch({ every: v })} />
          ) : (
            <AuroraSelect
              value={fetch.every}
              onChange={(v) => {
                if (v === '__custom') setCustomEvery(true);
                else patch({ every: v });
              }}
              options={[...EVERY_PRESETS.map((e) => ({ value: e, label: e })), { value: '__custom', label: t('trigger.fetch.everyCustom', 'Custom…') }]}
            />
          )}
          {customEvery && <FieldHint tone="muted">{t('trigger.fetch.everyHint', 'Duration like 5m, 1h, 1d — at least 1m.')}</FieldHint>}
        </div>
        <div>
          <FieldLabel>{t('trigger.fetch.batch', 'Items per poll')}</FieldLabel>
          <AuroraSelect
            value={String(fetch.batch ?? 1)}
            onChange={(v) => patch({ batch: Number(v) > 1 ? Number(v) : undefined })}
            options={BATCH_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
      </div>
      <FieldHint tone="muted">
        {t('trigger.fetch.batchHint', 'How many new items one poll may start, while the activation has room under "Live runs at once". Unclaimed items are seen again next poll.')}
      </FieldHint>

      <div>
        <Button variant="secondary" size="xs" disabled={previewing || !connectionReady} onClick={runPreview}>
          {previewing ? t('trigger.fetch.previewing', 'Polling…') : t('trigger.fetch.preview', 'Preview items')}
        </Button>
        {preview && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {!preview.ok ? (
              <FieldHint tone="warn">{preview.error}</FieldHint>
            ) : (
              <>
                <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                  {t('trigger.fetch.previewSeen', '{{n}} item(s) seen, {{skipped}} skipped', { n: preview.seen, skipped: preview.skipped })}
                </span>
                {preview.items.length === 0 && <FieldHint tone="muted">{t('trigger.fetch.previewEmpty', 'The poll returned no items.')}</FieldHint>}
                {preview.items.map((item) => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{item.key}</span>
                    {item.claimed && (
                      <Badge tone="neutral" size="sm">
                        {t('trigger.fetch.claimed', 'claimed')}
                      </Badge>
                    )}
                    {item.fields && (
                      <span style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(item.fields)}>
                        {Object.values(item.fields)[0]}
                      </span>
                    )}
                  </div>
                ))}
                {!selectedProject && <FieldHint tone="muted">{t('trigger.fetch.previewNeedsProject', 'Pass a project to see which items are already claimed.')}</FieldHint>}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
