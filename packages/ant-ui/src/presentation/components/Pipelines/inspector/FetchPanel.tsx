/**
 * The fetch trigger as a guided flow of four cards — connect → request →
 * read the response and map items → poll cadence. The validator owns every
 * rule; this form shapes the object, registers the credentials an inline
 * connection names, and turns `preview-fetch` into a response an author
 * clicks to fill `items` / `key` / `fields` instead of typing item-paths.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTree, Plug, Send, Timer } from 'lucide-react';
import {
  DEFAULT_PIPELINE_CAPS,
  MCP_HEADER_NAME_PATTERN,
  PIPELINE_FETCH_FIELD_NAME_PATTERN,
  fetchConnectionSource,
  formatItemPath,
  parseCustomJobRef,
  parseSecretRef,
  validatePipelineFetchSelection,
  type CustomAgentSummary,
  type ItemPathSegment,
  type PipelineDef,
  type PipelineFetchConnectionSource,
  type PipelineFetchPreview,
  type PipelineFetchTrigger,
} from '@ant/shared';
import { useStore } from '@/domain/store';
import { useMcpCredentialRegistry } from '@/application/hooks/ui/useMcpCredentialRegistry';
import { previewPipelineFetch } from '@/infrastructure/http/api/pipelines';
import { AuroraInput, AuroraSelect, FieldHint } from '../../ConfigEditor/aurora';
import { Badge, Button, Textarea } from '../../aurora';
import { DEFAULT_FETCH_TRIGGER, setFetchConnectionSource, updateFetch, updateFetchBinding, updateFetchConnection } from '../draft';
import { NODE_KIND_STYLE } from '../canvas/nodes';
import { ToggleChip } from './chips';
import { withCurrentValue } from './selectOptions';
import { Field } from './primitives/Field';
import { InspectorSection, type InspectorSectionStatus } from './primitives/InspectorSection';
import { KeyValueRows } from './primitives/KeyValueRows';
import { PathInput } from './primitives/PathInput';
import { useKeyValueRows } from './primitives/useKeyValueRows';
import { ResponseExplorer } from './fetch/ResponseExplorer';
import { SecretRefField } from './fetch/SecretRefField';
import { absoluteFromItem, firstItemSegments, relativeToItem, sampleAt, sampleText, segmentsOf, suggestFieldName, suggestSecretKey, type PickMode } from './fetch/fetchMapping';

const EVERY_PRESETS = ['1m', '5m', '15m', '30m', '1h', '6h', '1d'] as const;
const BATCH_OPTIONS = Array.from({ length: DEFAULT_PIPELINE_CAPS.maxFetchBatch }, (_, i) => i + 1);
const TONE = { items: 'var(--teal-500)', key: 'var(--amber-500)', field: 'var(--violet-500)' } as const;
const ACCENT = NODE_KIND_STYLE.trigger.accent;

function baseUrlError(raw: string): boolean {
  if (!raw.trim()) return false;
  try {
    const u = new URL(raw);
    return !(u.protocol === 'http:' || u.protocol === 'https:') || u.search !== '' || u.hash !== '';
  } catch {
    return true;
  }
}

export function FetchPanel({ def, onChange, customAgents }: { def: PipelineDef; onChange: (d: PipelineDef) => void; customAgents: CustomAgentSummary[] }) {
  const { t } = useTranslation('pipelines');
  const fetch: PipelineFetchTrigger = def.on?.fetch ?? DEFAULT_FETCH_TRIGGER;
  const patch = (p: Parameters<typeof updateFetch>[1]) => onChange(updateFetch(def, p));
  const patchRequest = (p: Partial<PipelineFetchTrigger['request']>) => patch({ request: { ...fetch.request, ...p } });
  const unknown = (v: string) => t('inspector.unknownValue', 'Unknown value: {{v}}', { v });
  const selectedPipelineId = useStore((s) => s.selectedPipelineId);
  const selectedProject = useStore((s) => s.selectedProject);
  const registry = useMcpCredentialRegistry();

  // ── 1. Connection ──────────────────────────────────────────────────────────
  const source = fetchConnectionSource(fetch);
  const connection = fetch.connection ?? { baseUrl: '' };
  const [headerRows, setHeaderRows] = useKeyValueRows(connection.headers, (headers) => onChange(updateFetchConnection(def, { headers })));
  const secretKeys = Object.values(connection.headers ?? {}).map(parseSecretRef).filter((k): k is string => k !== null);
  const unregistered = secretKeys.filter((k) => !(k in registry.registeredAt));

  const ref = parseCustomJobRef(fetch.customJobRef ?? '');
  const agent = customAgents.find((a) => a.id === ref?.agentId);
  const job = agent?.jobs.find((j) => j.id === ref?.jobId);
  const apiNames = Object.entries(job?.apis ?? {})
    .filter(([, meta]) => !meta.self)
    .map(([name]) => name);
  const agentSel = withCurrentValue(customAgents.map((a) => ({ value: a.id, label: a.name })), ref?.agentId, unknown);
  const jobSel = withCurrentValue((agent?.jobs ?? []).map((j) => ({ value: j.id, label: j.name })), ref?.jobId, unknown);
  const apiSel = withCurrentValue(apiNames.map((n) => ({ value: n, label: n })), fetch.api ?? '', unknown);

  const connectionReady = source === 'inline' ? connection.baseUrl.trim() !== '' && !baseUrlError(connection.baseUrl) : Boolean(fetch.api && ref);
  const connectionStatus: InspectorSectionStatus = !connectionReady ? 'todo' : unregistered.length > 0 ? 'warn' : 'ok';
  const connectionLabel = !connectionReady
    ? t('trigger.fetch.statusIncomplete', 'Incomplete')
    : unregistered.length > 0
      ? t('trigger.fetch.statusUnregistered', '{{n}} credential(s) not registered', { n: unregistered.length })
      : source === 'inline'
        ? new URL(connection.baseUrl).host
        : `${fetch.api}`;

  // ── 2. Request ─────────────────────────────────────────────────────────────
  const [queryRows, setQueryRows] = useKeyValueRows(fetch.request.query, (query) => patchRequest({ query }));
  const [bodyText, setBodyText] = useState(() => (fetch.request.body ? JSON.stringify(fetch.request.body, null, 2) : ''));
  const [bodyInvalid, setBodyInvalid] = useState(false);
  const pathOk = /^\/(?!\/)\S*$/.test(fetch.request.path);
  const requestStatus: InspectorSectionStatus = pathOk && !bodyInvalid ? 'ok' : 'todo';

  // ── 3. Response + mapping ──────────────────────────────────────────────────
  const [preview, setPreview] = useState<PipelineFetchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pickMode, setPickMode] = useState<PickMode | null>(null);
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const runPreview = async (current: PipelineFetchTrigger) => {
    setPreviewing(true);
    try {
      setPreview(await previewPipelineFetch(current, selectedProject ?? undefined, selectedPipelineId ?? undefined));
    } catch (e) {
      setPreview({ ok: false, error: e instanceof Error ? e.message : String(e), items: [], seen: 0, skipped: 0 });
    } finally {
      setPreviewing(false);
    }
  };
  // Once a response is on screen, a changed selection re-reads it (debounced) so the mapping table follows the paths.
  const selectionKey = JSON.stringify([fetch.items, fetch.key, fetch.fields]);
  const lastSelection = useRef(selectionKey);
  useEffect(() => {
    if (!preview?.sample || selectionKey === lastSelection.current) return;
    lastSelection.current = selectionKey;
    if (validatePipelineFetchSelection(fetch).length > 0) return;
    const handle = setTimeout(() => void runPreview(fetch), 600);
    return () => clearTimeout(handle);
  }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sample = preview?.sample;
  const itemsSegs = segmentsOf(fetch.items);
  const itemsNode = sample && itemsSegs ? sampleAt(sample, itemsSegs) : undefined;
  const firstItem = sample ? sampleAt(sample, firstItemSegments(fetch.items) ?? []) : undefined;
  const resolvedRelative = (rel: string) => (sample && firstItem ? sampleText(sampleAt(sample, absoluteFromItem(fetch.items, rel) ?? [])) : undefined);
  const [fieldRows, setFieldRows] = useKeyValueRows(fetch.fields, (fields) => patch({ fields }));
  const fieldNames = fieldRows.map(([n]) => n);

  const onPick = (absolute: ItemPathSegment[]) => {
    setPickNotice(null);
    if (pickMode === 'items') {
      patch({ items: formatItemPath(absolute) });
    } else if (pickMode === 'key' || pickMode === 'field') {
      const rel = relativeToItem(fetch.items, absolute);
      if (!rel) {
        setPickNotice(t('trigger.fetch.pickInsideItem', 'Pick a value inside the first item of the array — key and field paths are relative to one item.'));
        return;
      }
      if (pickMode === 'key') patch({ key: formatItemPath(rel) });
      else setFieldRows([...fieldRows, [suggestFieldName(rel, fieldNames), formatItemPath(rel)]]);
    }
    setPickMode(null);
  };

  const mappingStatus: InspectorSectionStatus = !preview ? 'todo' : !preview.ok || preview.mapping?.ok === false ? 'warn' : preview.items.length > 0 ? 'ok' : 'warn';
  const mappingLabel = !preview
    ? t('trigger.fetch.statusNoResponse', 'No response yet')
    : !preview.ok
      ? t('trigger.fetch.statusRequestFailed', 'Request failed')
      : preview.mapping?.ok === false
        ? t('trigger.fetch.statusUnmapped', 'Paths select nothing')
        : t('trigger.fetch.previewSeen', '{{n}} item(s) seen, {{skipped}} skipped', { n: preview.seen, skipped: preview.skipped });

  // ── 4. Polling ─────────────────────────────────────────────────────────────
  const everyIsPreset = (EVERY_PRESETS as readonly string[]).includes(fetch.every);
  const [customEvery, setCustomEvery] = useState(!everyIsPreset);
  const everyOk = /^[1-9]\d{0,3}(m|h|d)$/.test(fetch.every);

  const explorerLabels = useMemo(
    () => ({
      root: t('trigger.fetch.sampleRoot', 'response'),
      more: (n: number) => t('trigger.fetch.sampleMore', '… {{n}} more', { n }),
      total: (n: number) => t('trigger.fetch.sampleTotal', '{{n}} item(s)', { n }),
      pickHere: t('trigger.fetch.pickHere', 'Use this path'),
    }),
    [t],
  );

  return (
    <>
      <InspectorSection
        step={1}
        icon={Plug}
        accent={ACCENT}
        title={t('trigger.fetch.connection', 'Connection')}
        description={t('trigger.fetch.connectionHint', "The poll runs with the activator's own credentials for this connection.")}
        status={connectionStatus}
        statusLabel={connectionLabel}
        data-section="fetch-connection"
      >
        <Field label={t('trigger.fetch.source', 'Connection source')} help={t('trigger.fetch.sourceHint', "Reuse a job's apis entry when a step already reaches this system; otherwise declare the connection here, so no agent gains tools it has no use for.")}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ToggleChip active={source === 'inline'} onClick={() => onChange(setFetchConnectionSource(def, 'inline' as PipelineFetchConnectionSource))}>
              {t('trigger.fetch.sourceInline', 'Inline — this pipeline only')}
            </ToggleChip>
            <ToggleChip active={source === 'bound'} onClick={() => onChange(setFetchConnectionSource(def, 'bound' as PipelineFetchConnectionSource))}>
              {t('trigger.fetch.sourceBound', "An agent's declared apis entry")}
            </ToggleChip>
          </div>
        </Field>
        {source === 'bound' ? (
          <>
            <Field label={t('trigger.fetch.agent', 'Agent')} required>
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
            </Field>
            <Field label={t('trigger.fetch.job', 'Job')} required>
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
            </Field>
            <Field
              label={t('trigger.fetch.api', 'API connection')}
              required
              hint={t('trigger.fetch.boundCredentialHint', 'This connection and its credentials are declared in Agent Settings; the poll must also pass its allow rules.')}
            >
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
            </Field>
          </>
        ) : (
          <>
            <Field label={t('trigger.fetch.baseUrl', 'Base URL')} required error={baseUrlError(connection.baseUrl) ? t('trigger.fetch.baseUrlInvalid', 'An absolute http(s) URL without query or fragment.') : null}>
              <AuroraInput mono value={connection.baseUrl} placeholder="https://jira.example.com/rest" onChange={(v) => onChange(updateFetchConnection(def, { baseUrl: v }))} />
            </Field>
            <Field
              label={t('trigger.fetch.headers', 'Headers')}
              optional
              help={t('trigger.fetch.secretHint', 'Write credentials as ${secret:KEY} — the value stays in credential settings, registered by whoever activates the pipeline.')}
            >
              <KeyValueRows
                rows={headerRows}
                onChange={setHeaderRows}
                columns="minmax(90px, 1fr) minmax(0, 2.4fr)"
                namePlaceholder={t('trigger.fetch.headerName', 'Header')}
                addLabel={t('trigger.fetch.addHeader', 'Add header')}
                removeLabel={t('trigger.fetch.removeHeader', 'Remove header')}
                newRow={['Authorization', '']}
                nameInvalid={(name) => !MCP_HEADER_NAME_PATTERN.test(name)}
                emptyHint={t('trigger.fetch.headersEmpty', 'No headers — add one if the source needs a token.')}
                renderValue={([name, value], setValue) => (
                  <SecretRefField value={value} onChange={setValue} registry={registry} suggestedKey={suggestSecretKey([selectedPipelineId ?? 'pipeline', name || 'token'])} />
                )}
                data-rows="headers"
              />
            </Field>
          </>
        )}
      </InspectorSection>

      <InspectorSection step={2} icon={Send} accent={ACCENT} title={t('trigger.fetch.request', 'Request')} description={t('trigger.fetch.requestHint', 'A READ the poller repeats: GET, or POST for a search endpoint.')} status={requestStatus} statusLabel={pathOk ? `${fetch.request.method} ${fetch.request.path}` : t('trigger.fetch.statusIncomplete', 'Incomplete')} data-section="fetch-request">
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'start' }}>
          <Field label={t('trigger.fetch.method', 'Method')}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['GET', 'POST'] as const).map((m) => (
                <ToggleChip key={m} active={fetch.request.method === m} onClick={() => patchRequest({ method: m, ...(m === 'GET' && { body: undefined }) })}>
                  {m}
                </ToggleChip>
              ))}
            </div>
          </Field>
          <Field label={t('trigger.fetch.path', 'Path')} required hint={t('trigger.fetch.pathHint', "Relative to the connection's base URL, within its allow rules.")}>
            <AuroraInput mono value={fetch.request.path} hasError={!pathOk} placeholder="/rest/api/3/search" onChange={(v) => patchRequest({ path: v })} />
          </Field>
        </div>
        <Field label={t('trigger.fetch.query', 'Query parameters')} optional>
          <KeyValueRows
            rows={queryRows}
            onChange={setQueryRows}
            namePlaceholder={t('trigger.fetch.queryName', 'name')}
            valuePlaceholder={t('trigger.fetch.queryValue', 'value')}
            addLabel={t('trigger.fetch.addQuery', 'Add parameter')}
            removeLabel={t('trigger.fetch.removeQuery', 'Remove parameter')}
            data-rows="query"
          />
        </Field>
        {fetch.request.method === 'POST' && (
          <Field label={t('trigger.fetch.body', 'JSON body')} optional error={bodyInvalid ? t('trigger.fetch.bodyInvalid', 'Body must be a JSON object') : null}>
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
                  } else setBodyInvalid(true);
                } catch {
                  setBodyInvalid(true);
                }
              }}
            />
          </Field>
        )}
      </InspectorSection>

      <InspectorSection
        step={3}
        icon={ListTree}
        accent={ACCENT}
        title={t('trigger.fetch.mapping', 'Response & items')}
        description={t('trigger.fetch.mappingHint', 'Fetch the response once, then click the array of cases, the key inside one case, and the values a step should receive.')}
        status={mappingStatus}
        statusLabel={mappingLabel}
        action={
          <Button variant="secondary" size="xs" disabled={previewing || !connectionReady || !pathOk} onClick={() => void runPreview(fetch)}>
            {previewing ? t('trigger.fetch.previewing', 'Polling…') : preview ? t('trigger.fetch.refetch', 'Fetch again') : t('trigger.fetch.fetchResponse', 'Fetch response')}
          </Button>
        }
        data-section="fetch-mapping"
      >
        {!connectionReady && <FieldHint tone="muted">{t('trigger.fetch.needsConnection', 'Finish the connection and request above to fetch a response.')}</FieldHint>}
        {preview && !preview.ok && <FieldHint tone="warn">{preview.error}</FieldHint>}
        {sample && (
          <ResponseExplorer sample={sample} itemsPath={fetch.items} keyPath={fetch.key} fieldPaths={fieldRows.map(([, p]) => p)} pickMode={pickMode} onPick={onPick} labels={explorerLabels} />
        )}
        {pickNotice && <FieldHint tone="warn">{pickNotice}</FieldHint>}
        <Field label={t('trigger.fetch.items', 'Items path')} required help={t('trigger.fetch.itemsHint', 'Where the item array is in the response, e.g. $.issues')}>
          <PathInput
            value={fetch.items}
            onChange={(v) => patch({ items: v })}
            placeholder="$.issues"
            accent={TONE.items}
            resolved={sample ? (itemsNode?.t === 'arr' ? explorerLabels.total(itemsNode.total) : sampleText(itemsNode)) : undefined}
            onPick={sample ? () => setPickMode(pickMode === 'items' ? null : 'items') : undefined}
            picking={pickMode === 'items'}
            pickId="items"
          />
        </Field>
        <Field label={t('trigger.fetch.key', 'Key path')} required help={t('trigger.fetch.keyHint', "Each item's unique key — the run's label and its dedupe identity, e.g. $.key")}>
          <PathInput
            value={fetch.key}
            onChange={(v) => patch({ key: v })}
            placeholder="$.key"
            accent={TONE.key}
            resolved={resolvedRelative(fetch.key)}
            onPick={firstItem ? () => setPickMode(pickMode === 'key' ? null : 'key') : undefined}
            picking={pickMode === 'key'}
            pickId="key"
          />
        </Field>
        <Field
          label={t('trigger.fetch.fields', 'Fields')}
          optional
          help={t('trigger.fetch.fieldsHint', 'Each field becomes {{trigger.item.<name>}} in step directives.')}
          action={
            firstItem ? (
              <button type="button" onClick={() => setPickMode(pickMode === 'field' ? null : 'field')} aria-pressed={pickMode === 'field'} data-pick="field" style={{ background: 'none', border: 'none', cursor: 'pointer', color: pickMode === 'field' ? TONE.field : 'var(--violet-500)', fontSize: 11, fontWeight: 600, padding: 0 }}>
                {pickMode === 'field' ? t('trigger.fetch.picking', 'Click in the response…') : t('trigger.fetch.pickField', 'Pick from response')}
              </button>
            ) : undefined
          }
        >
          <KeyValueRows
            rows={fieldRows}
            onChange={setFieldRows}
            columns="minmax(90px, 1fr) minmax(0, 1.6fr)"
            namePlaceholder={t('trigger.fetch.fieldName', 'name')}
            addLabel={t('trigger.fetch.addField', 'Add field')}
            removeLabel={t('trigger.fetch.removeField', 'Remove field')}
            newRow={['', '$.']}
            nameInvalid={(name) => !PIPELINE_FETCH_FIELD_NAME_PATTERN.test(name) || name === 'key'}
            renderValue={([, itemPath], setValue) => <PathInput value={itemPath} onChange={setValue} accent={TONE.field} resolved={resolvedRelative(itemPath)} />}
            emptyHint={t('trigger.fetch.fieldsEmpty', 'No fields yet — the step only learns the key.')}
            data-rows="fields"
          />
        </Field>
        {preview?.ok && preview.mapping?.ok === false && <FieldHint tone="warn">{preview.mapping.error}</FieldHint>}
        {preview?.ok && preview.mapping?.ok && (
          <div data-mapping-result style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {preview.items.length === 0 && <FieldHint tone="warn">{t('trigger.fetch.previewEmpty', 'The poll returned no items.')}</FieldHint>}
            {preview.items.slice(0, 8).map((item) => (
              <div key={item.key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'center', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-surface-2)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TONE.key, fontWeight: 700 }}>
                  {item.key}
                  {item.claimed && (
                    <Badge tone="neutral" size="sm">
                      {t('trigger.fetch.claimed', 'claimed')}
                    </Badge>
                  )}
                </span>
                <span style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(item.fields ?? {})}>
                  {Object.entries(item.fields ?? {})
                    .slice(0, 3)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' · ')}
                </span>
              </div>
            ))}
            {preview.items.length > 8 && <FieldHint tone="muted">{t('trigger.fetch.previewMore', '… and {{n}} more', { n: preview.items.length - 8 })}</FieldHint>}
            {!selectedProject && <FieldHint tone="muted">{t('trigger.fetch.previewNeedsProject', 'Pass a project to see which items are already claimed.')}</FieldHint>}
          </div>
        )}
      </InspectorSection>

      <InspectorSection step={4} icon={Timer} accent={ACCENT} title={t('trigger.fetch.schedule', 'Polling')} description={t('trigger.fetch.batchHint', 'How many new items one poll may start, while the activation has room under "Live runs at once". Unclaimed items are seen again next poll.')} status={everyOk ? 'ok' : 'warn'} statusLabel={everyOk ? t('trigger.fetch.everyBatch', 'every {{every}} · {{batch}} per poll', { every: fetch.every, batch: fetch.batch ?? 1 }) : t('trigger.fetch.everyHint', 'Duration like 5m, 1h, 1d — at least 1m.')} data-section="fetch-polling">
        <Field label={t('trigger.fetch.every', 'Poll every')}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {EVERY_PRESETS.map((e) => (
              <ToggleChip
                key={e}
                active={!customEvery && fetch.every === e}
                onClick={() => {
                  setCustomEvery(false);
                  patch({ every: e });
                }}
              >
                {e}
              </ToggleChip>
            ))}
            <ToggleChip active={customEvery} onClick={() => setCustomEvery(true)}>
              {t('trigger.fetch.everyCustom', 'Custom…')}
            </ToggleChip>
          </div>
          {customEvery && (
            <div style={{ marginTop: 6 }}>
              <AuroraInput mono value={fetch.every} hasError={!everyOk} placeholder="5m" onChange={(v) => patch({ every: v })} />
            </div>
          )}
        </Field>
        <Field label={t('trigger.fetch.batch', 'Items per poll')}>
          <AuroraSelect value={String(fetch.batch ?? 1)} onChange={(v) => patch({ batch: Number(v) > 1 ? Number(v) : undefined })} options={BATCH_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))} />
        </Field>
      </InspectorSection>
    </>
  );
}
