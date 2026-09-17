import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Settings2 } from 'lucide-react';
import {
  DEFAULT_PIPELINE_CAPS,
  isApprovalStep,
  parseCustomJobRef,
  resolveRunConcurrency,
  verdictEdgeOutcomes,
  type CustomAgentSummary,
  type PipelineDef,
  type PipelineOverlap,
  type PipelineUpstreamTrigger,
  type StepEdgeCondition,
} from '@ant/shared';
import { useStore } from '@/domain/store';
import { fetchPipeline } from '@/infrastructure/http/api/pipelines';
import { AuroraSelect } from '../../ConfigEditor/aurora';
import { CronBuilder } from '../CronBuilder';
import { NODE_KIND_STYLE, TRIGGER_MODE_ICON } from '../canvas/nodes';
import { setTriggerMode, triggerModeOf, updateSchedule, updateUpstream, type TriggerMode } from '../draft';
import { ToggleChip } from './chips';
import { FetchPanel } from './FetchPanel';
import { Field } from './primitives/Field';
import { InspectorSection } from './primitives/InspectorSection';

/** Select value for "the upstream run's seal" — the trigger writes no `step` for it. */
const RUN_NODE = '';
type WhenKind = 'success' | 'failure' | 'always' | 'verdict';
const whenKindOf = (when: StepEdgeCondition | undefined): WhenKind => (when?.startsWith('verdict:') ? 'verdict' : ((when ?? 'success') as WhenKind));

/** The outcomes an upstream job step's pinned intent declares — what a `verdict:` edge may name. */
function declaredOutcomes(upstreamDef: PipelineDef | null, stepId: string | undefined, agents: CustomAgentSummary[]): string[] {
  const step = upstreamDef?.steps.find((s) => s.id === stepId);
  if (!step || isApprovalStep(step) || !step.intent) return [];
  const ref = parseCustomJobRef(step.customJobRef);
  const job = ref ? agents.find((a) => a.id === ref.agentId)?.jobs.find((j) => j.id === ref.jobId) : undefined;
  return job?.intents?.find((i) => i.id === step.intent)?.outcomes ?? [];
}

/**
 * The upstream edge: which pipeline, which node of its runs (a step, or the
 * run's seal), and the same edge condition a step's `on` uses. The upstream
 * definition is read for its step ids and declared outcomes; when it is not
 * authored yet the node stays typeable as the run seal.
 */
function UpstreamFields({ def, onChange, customAgents }: { def: PipelineDef; onChange: (d: PipelineDef) => void; customAgents: CustomAgentSummary[] }) {
  const { t } = useTranslation('pipelines');
  const pipelines = useStore((s) => s.pipelines);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const upstream: PipelineUpstreamTrigger = def.on?.upstream ?? { pipelineId: '' };
  const [upstreamDef, setUpstreamDef] = useState<PipelineDef | null>(null);
  useEffect(() => {
    const id = upstream.pipelineId;
    if (!id) {
      setUpstreamDef(null);
      return;
    }
    let stale = false;
    fetchPipeline(id)
      .then((detail) => {
        if (!stale) setUpstreamDef(detail.def);
      })
      .catch(() => {
        if (!stale) setUpstreamDef(null);
      });
    return () => {
      stale = true;
    };
  }, [upstream.pipelineId]);

  const stepIds = upstreamDef?.steps.map((s) => s.id) ?? [];
  const nodeOptions = [
    { value: RUN_NODE, label: t('trigger.upstreamNodeRun', 'The run itself (seals when every step has)') },
    ...(upstream.step && !stepIds.includes(upstream.step) ? [{ value: upstream.step, label: upstream.step }] : []),
    ...stepIds.map((id) => ({ value: id, label: id })),
  ];
  const outcomes = declaredOutcomes(upstreamDef, upstream.step, customAgents);
  const whenKind = whenKindOf(upstream.when);
  const chosenOutcomes = whenKind === 'verdict' && upstream.when ? verdictEdgeOutcomes(upstream.when) : [];
  const whenOptions: Array<{ value: WhenKind; label: string }> = [
    { value: 'success', label: t('trigger.whenSuccess', 'Succeeded (default)') },
    { value: 'failure', label: t('trigger.whenFailure', 'Failed') },
    { value: 'always', label: t('trigger.whenAlways', 'Succeeded or failed') },
    ...(upstream.step && (outcomes.length > 0 || whenKind === 'verdict')
      ? [{ value: 'verdict' as const, label: t('trigger.whenVerdict', 'Sealed a verdict…') }]
      : []),
  ];
  const setWhen = (kind: WhenKind) => {
    if (kind === 'verdict') {
      const first = outcomes[0] ?? chosenOutcomes[0];
      onChange(updateUpstream(def, { when: first ? (`verdict:${first}` as StepEdgeCondition) : undefined }));
      return;
    }
    onChange(updateUpstream(def, { when: kind === 'success' ? undefined : kind }));
  };
  const toggleOutcome = (o: string) => {
    const next = chosenOutcomes.includes(o) ? chosenOutcomes.filter((x) => x !== o) : [...chosenOutcomes, o];
    if (next.length === 0) return; // a verdict edge names at least one outcome
    onChange(updateUpstream(def, { when: `verdict:${next.join('|')}` as StepEdgeCondition }));
  };

  return (
    <>
      <Field label={t('trigger.upstreamSource', 'Upstream pipeline')} required>
        <AuroraSelect
          value={upstream.pipelineId}
          onChange={(v) => onChange(updateUpstream(def, { pipelineId: v }))}
          placeholder={t('trigger.chainSourcePick', 'Choose a pipeline')}
          options={pipelines.filter((p) => p.id !== selectedId).map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <Field
        label={t('trigger.upstreamNode', 'Upstream node')}
        hint={t('trigger.upstreamNodeHint', 'A step fires the moment it seals, while the upstream run is still going; the run fires when it seals.')}
      >
        <AuroraSelect
          value={upstream.step ?? RUN_NODE}
          onChange={(v) => onChange(updateUpstream(def, { step: v === RUN_NODE ? undefined : v }))}
          disabled={!upstream.pipelineId}
          options={nodeOptions}
        />
      </Field>
      <Field label={t('trigger.upstreamWhen', 'Fires when the node')} hint={t('trigger.upstreamWhenHint', 'A skipped or cancelled node did not happen and never fires.')}>
        <AuroraSelect value={whenKind} onChange={(v) => setWhen(v as WhenKind)} options={whenOptions} />
        {whenKind === 'verdict' && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {[...new Set([...outcomes, ...chosenOutcomes])].map((o) => (
              <ToggleChip key={o} active={chosenOutcomes.includes(o)} onClick={() => toggleOutcome(o)}>
                {o}
              </ToggleChip>
            ))}
          </div>
        )}
      </Field>
      <Field label={t('trigger.overlap', 'If the previous run is still live')}>
        <AuroraSelect
          value={upstream.overlap ?? 'skip'}
          onChange={(v) => onChange(updateUpstream(def, { overlap: v === 'skip' ? undefined : (v as PipelineOverlap) }))}
          options={[
            { value: 'skip', label: t('trigger.overlapSkip', 'Skip this fire (default)') },
            { value: 'queue', label: t('trigger.overlapQueue', 'Queue until it finishes') },
          ]}
        />
      </Field>
    </>
  );
}
/** `1..maxLiveRunsPerActivation` — the validator's range, offered as a closed list. */
const CONCURRENCY_OPTIONS = Array.from({ length: DEFAULT_PIPELINE_CAPS.maxLiveRunsPerActivation }, (_, i) => i + 1);
const ACCENT = NODE_KIND_STYLE.trigger.accent;

/** `concurrency: 1` is the default — the key is omitted rather than written as the default. */
function setConcurrency(def: PipelineDef, n: number): PipelineDef {
  const { concurrency: _prev, ...rest } = def;
  return n > 1 ? { ...rest, concurrency: n } : rest;
}

/**
 * Trigger — what starts a run (one card per mode; fetch unfolds into its own
 * numbered flow), then the run policy every trigger shares.
 */
export function TriggerPanel({ def, onChange, onCronValidity, customAgents }: { def: PipelineDef; onChange: (d: PipelineDef) => void; onCronValidity: (ok: boolean) => void; customAgents: CustomAgentSummary[] }) {
  const { t } = useTranslation('pipelines');
  const sched = def.on?.schedule;
  const mode = triggerModeOf(def);
  const MODE_DESCRIPTION: Record<TriggerMode, string> = {
    schedule: t('trigger.modeScheduleHint', 'Fires on a cron expression in the chosen time zone.'),
    upstream: t('trigger.modeUpstreamHint', "Hangs off one node of another pipeline of yours — a step, or the run itself — and fires when it seals, on the activator's other projects."),
    fetch: t('trigger.modeFetchHint', 'Polls an external queue and starts one run per new item; the source is the queue, Ant keeps the claim ledger.'),
    manual: t('trigger.modeManualHint', 'Fires only when someone presses Run now on an activation.'),
  };
  return (
    <>
      <InspectorSection icon={TRIGGER_MODE_ICON[mode]} accent={ACCENT} title={t('trigger.mode', 'Trigger')} description={MODE_DESCRIPTION[mode]} data-section="trigger-mode">
        <AuroraSelect
          value={mode}
          onChange={(v) => {
            onChange(setTriggerMode(def, v as TriggerMode));
            // Only a schedule has a cron to validate — other modes open the gate.
            if (v !== 'schedule') onCronValidity(true);
          }}
          options={[
            { value: 'schedule', label: t('trigger.modeSchedule', 'Cron schedule') },
            { value: 'upstream', label: t('trigger.modeUpstream', "After another pipeline's node") },
            { value: 'fetch', label: t('trigger.modeFetch', 'Poll an external queue (fetch)') },
            { value: 'manual', label: t('trigger.modeManual', 'Manual only (Run now)') },
          ]}
        />
        {mode === 'upstream' && <UpstreamFields def={def} onChange={onChange} customAgents={customAgents} />}
      </InspectorSection>

      {mode === 'fetch' && <FetchPanel def={def} onChange={onChange} customAgents={customAgents} />}

      {sched && (
        <InspectorSection icon={CalendarClock} accent={ACCENT} title={t('trigger.scheduleTitle', 'Schedule')} description={t('trigger.scheduleHint', 'When it fires, and what happens when a fire is missed or the previous run is still live.')} data-section="trigger-schedule">
          <CronBuilder cron={sched.cron} tz={sched.tz} onChange={(patch) => onChange(updateSchedule(def, patch))} onValidity={onCronValidity} />
          <Field label={t('trigger.onMissed', 'If a fire is missed')}>
            <AuroraSelect
              value={sched.onMissed ?? 'skip'}
              onChange={(v) => onChange(updateSchedule(def, { onMissed: v as 'skip' | 'runOnce' }))}
              options={[
                { value: 'skip', label: t('trigger.onMissedSkip', 'Skip it (default)') },
                { value: 'runOnce', label: t('trigger.onMissedRunOnce', 'Run once on recovery') },
              ]}
            />
          </Field>
          <Field label={t('trigger.overlap', 'If the previous run is still live')}>
            <AuroraSelect
              value={sched.overlap ?? 'skip'}
              onChange={(v) => onChange(updateSchedule(def, { overlap: v as 'skip' | 'queue' }))}
              options={[
                { value: 'skip', label: t('trigger.overlapSkip', 'Skip this fire (default)') },
                { value: 'queue', label: t('trigger.overlapQueue', 'Queue until it finishes') },
              ]}
            />
          </Field>
        </InspectorSection>
      )}

      <InspectorSection icon={Settings2} accent={ACCENT} title={t('trigger.policyTitle', 'Run policy')} description={t('trigger.concurrencyHint', 'Applies to every trigger: Run now, the schedule, upstream fires and fetched items each start a run while the activation is below this cap.')} data-section="trigger-policy">
        <Field label={t('trigger.concurrency', 'Live runs at once')}>
          <AuroraSelect
            value={String(resolveRunConcurrency(def))}
            onChange={(v) => onChange(setConcurrency(def, Number(v)))}
            options={CONCURRENCY_OPTIONS.map((n) => ({
              value: String(n),
              label: n === 1 ? t('trigger.concurrencyOne', '1 — one run at a time (default)') : t('trigger.concurrencyN', '{{n}} — up to {{n}} independent runs', { n }),
            }))}
          />
        </Field>
        <Field label={t('trigger.onStepFailure', 'When a step fails')}>
          <AuroraSelect
            value={def.defaults?.onStepFailure ?? 'abort'}
            onChange={(v) => onChange({ ...def, defaults: { ...def.defaults, onStepFailure: v as 'abort' | 'continue' } })}
            options={[
              { value: 'abort', label: t('trigger.failAbort', 'Abort the run (default)') },
              { value: 'continue', label: t('trigger.failContinue', 'Continue other branches') },
            ]}
          />
        </Field>
      </InspectorSection>
    </>
  );
}
