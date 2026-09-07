import { useTranslation } from 'react-i18next';
import type { PipelineDef, PipelineRunStatus } from '@ant/shared';
import { useStore } from '@/domain/store';
import { AuroraSelect, FieldLabel } from '../../ConfigEditor/aurora';
import { CronBuilder } from '../CronBuilder';
import { setTriggerMode, triggerModeOf, updateRunCompleted, updateSchedule, type TriggerMode } from '../draft';
import { ToggleChip } from './chips';

const TERMINAL_STATUSES = ['completed', 'failed', 'partial', 'cancelled'] as const;

export function TriggerPanel({ def, onChange, onCronValidity }: { def: PipelineDef; onChange: (d: PipelineDef) => void; onCronValidity: (ok: boolean) => void }) {
  const { t } = useTranslation('pipelines');
  const sched = def.on?.schedule;
  const runCompleted = def.on?.runCompleted;
  const mode = triggerModeOf(def);
  const pipelines = useStore((s) => s.pipelines);
  const selectedId = useStore((s) => s.selectedPipelineId);
  return (
    <>
      <div>
        <FieldLabel>{t('trigger.mode', 'Trigger')}</FieldLabel>
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
            { value: 'manual', label: t('trigger.modeManual', 'Manual only (Run now)') },
          ]}
        />
      </div>
      {mode === 'runCompleted' && (
        <>
          <div>
            <FieldLabel required>{t('trigger.chainSource', 'Fires when this pipeline finishes')}</FieldLabel>
            <AuroraSelect
              value={runCompleted?.pipelineId ?? ''}
              onChange={(v) => onChange(updateRunCompleted(def, { pipelineId: v }))}
              placeholder={t('trigger.chainSourcePick', 'Choose a pipeline')}
              options={pipelines.filter((p) => p.id !== selectedId).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div>
            <FieldLabel>{t('trigger.chainStatuses', 'On these outcomes')}</FieldLabel>
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
          </div>
        </>
      )}
      {sched && (
        <>
          <CronBuilder cron={sched.cron} tz={sched.tz} onChange={(patch) => onChange(updateSchedule(def, patch))} onValidity={onCronValidity} />
          <div>
            <FieldLabel>{t('trigger.onMissed', 'If a fire is missed')}</FieldLabel>
            <AuroraSelect
              value={sched.onMissed ?? 'skip'}
              onChange={(v) => onChange(updateSchedule(def, { onMissed: v as 'skip' | 'runOnce' }))}
              options={[
                { value: 'skip', label: t('trigger.onMissedSkip', 'Skip it (default)') },
                { value: 'runOnce', label: t('trigger.onMissedRunOnce', 'Run once on recovery') },
              ]}
            />
          </div>
          <div>
            <FieldLabel>{t('trigger.overlap', 'If the previous run is still live')}</FieldLabel>
            <AuroraSelect
              value={sched.overlap ?? 'skip'}
              onChange={(v) => onChange(updateSchedule(def, { overlap: v as 'skip' | 'queue' }))}
              options={[
                { value: 'skip', label: t('trigger.overlapSkip', 'Skip this fire (default)') },
                { value: 'queue', label: t('trigger.overlapQueue', 'Queue until it finishes') },
              ]}
            />
          </div>
        </>
      )}
      <div>
        <FieldLabel>{t('trigger.onStepFailure', 'When a step fails')}</FieldLabel>
        <AuroraSelect
          value={def.defaults?.onStepFailure ?? 'abort'}
          onChange={(v) => onChange({ ...def, defaults: { ...def.defaults, onStepFailure: v as 'abort' | 'continue' } })}
          options={[
            { value: 'abort', label: t('trigger.failAbort', 'Abort the run (default)') },
            { value: 'continue', label: t('trigger.failContinue', 'Continue other branches') },
          ]}
        />
      </div>
    </>
  );
}
