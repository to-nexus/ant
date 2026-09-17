import { useTranslation } from 'react-i18next';
import { CalendarClock, Settings2 } from 'lucide-react';
import { DEFAULT_PIPELINE_CAPS, resolveRunConcurrency, type CustomAgentSummary, type PipelineDef, type PipelineRunStatus } from '@ant/shared';
import { useStore } from '@/domain/store';
import { AuroraSelect } from '../../ConfigEditor/aurora';
import { CronBuilder } from '../CronBuilder';
import { NODE_KIND_STYLE, TRIGGER_MODE_ICON } from '../canvas/nodes';
import { setTriggerMode, triggerModeOf, updateRunCompleted, updateSchedule, type TriggerMode } from '../draft';
import { ToggleChip } from './chips';
import { FetchPanel } from './FetchPanel';
import { Field } from './primitives/Field';
import { InspectorSection } from './primitives/InspectorSection';

const TERMINAL_STATUSES = ['completed', 'failed', 'partial', 'cancelled'] as const;
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
  const runCompleted = def.on?.runCompleted;
  const mode = triggerModeOf(def);
  const pipelines = useStore((s) => s.pipelines);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const MODE_DESCRIPTION: Record<TriggerMode, string> = {
    schedule: t('trigger.modeScheduleHint', 'Fires on a cron expression in the chosen time zone.'),
    runCompleted: t('trigger.modeRunCompletedHint', "Fires when another pipeline of yours seals a run — on the activator's other projects."),
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
            { value: 'runCompleted', label: t('trigger.modeRunCompleted', 'After another pipeline') },
            { value: 'fetch', label: t('trigger.modeFetch', 'Poll an external queue (fetch)') },
            { value: 'manual', label: t('trigger.modeManual', 'Manual only (Run now)') },
          ]}
        />
        {mode === 'runCompleted' && (
          <>
            <Field label={t('trigger.chainSource', 'Fires when this pipeline finishes')} required>
              <AuroraSelect
                value={runCompleted?.pipelineId ?? ''}
                onChange={(v) => onChange(updateRunCompleted(def, { pipelineId: v }))}
                placeholder={t('trigger.chainSourcePick', 'Choose a pipeline')}
                options={pipelines.filter((p) => p.id !== selectedId).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label={t('trigger.chainStatuses', 'On these outcomes')}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {TERMINAL_STATUSES.map((s) => {
                  const active = (runCompleted?.statuses ?? ['completed']).includes(s);
                  return (
                    <ToggleChip
                      key={s}
                      active={active}
                      onClick={() => {
                        const current = new Set<PipelineRunStatus>(runCompleted?.statuses ?? ['completed']);
                        if (active) current.delete(s);
                        else current.add(s);
                        onChange(updateRunCompleted(def, { statuses: current.size > 0 ? [...current] : ['completed'] }));
                      }}
                    >
                      {t(`runs.${s}`, s)}
                    </ToggleChip>
                  );
                })}
              </div>
            </Field>
          </>
        )}
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

      <InspectorSection icon={Settings2} accent={ACCENT} title={t('trigger.policyTitle', 'Run policy')} description={t('trigger.concurrencyHint', 'Applies to every trigger: Run now, the schedule and chain fires each start a run while the activation is below this cap.')} data-section="trigger-policy">
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
