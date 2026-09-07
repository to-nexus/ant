import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isApprovalStep, parseCustomJobRef, type CustomAgentSummary, type PipelineDef, type PipelineStepDef, type StepEdgeCondition } from '@ant/shared';
import { useStore } from '@/domain/store';
import { AuroraSelect, FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { effectiveNeedsOf, updateStep } from '../../draft';
import { ToggleChip } from '../chips';
import { withCurrentValue } from '../selectOptions';

const VERDICT_PREFIX = 'verdict:';

/**
 * `on:` — success / failure / always, or a verdict switch over the outcomes
 * the DIRECT needs' pinned intents declare (the validator's satisfiability
 * rule, mirrored). A step owed to more than one outcome takes the disjunction
 * `verdict:a|b`, authored as multi-select chips; an authored condition on a
 * root step stays visible so it can be removed.
 */
export function EdgeConditionField({ def, step, onChange }: { def: PipelineDef; step: PipelineStepDef; onChange: (d: PipelineDef) => void }) {
  const { t } = useTranslation('pipelines');
  const customAgents = useStore((s) => s.accountAgents) as CustomAgentSummary[];
  const idx = def.steps.findIndex((s) => s.id === step.id);
  const effective = idx < 0 ? [] : effectiveNeedsOf(def, idx);

  const verdictOptions = useMemo(() => {
    const out: string[] = [];
    for (const needId of effective) {
      const need = def.steps.find((s) => s.id === needId);
      if (!need || isApprovalStep(need) || !need.intent) continue;
      const ref = parseCustomJobRef(need.customJobRef);
      if (!ref) continue;
      const outcomes =
        customAgents
          .find((a) => a.id === ref.agentId)
          ?.jobs.find((j) => j.id === ref.jobId)
          ?.intents?.find((i) => i.id === need.intent)?.outcomes ?? [];
      for (const o of outcomes) if (!out.includes(o)) out.push(o);
    }
    return out;
  }, [def, effective, customAgents]);

  if (effective.length === 0 && step.on === undefined) return null;

  const current = step.on ?? 'success';
  const isVerdict = current.startsWith(VERDICT_PREFIX);
  const selected = isVerdict ? current.slice(VERDICT_PREFIX.length).split('|') : [];
  const set = (on: string | undefined) => onChange(updateStep(def, step.id, { on: on === 'success' ? undefined : (on as StepEdgeCondition | undefined) }));

  const base = withCurrentValue(
    [
      { value: 'success', label: t('step.onSuccess', 'Succeeded (default)') },
      { value: 'failure', label: t('step.onFailure', 'Failed (failure branch)') },
      { value: 'always', label: t('step.onAlways', 'Finished either way') },
      ...(verdictOptions.length > 0 || isVerdict ? [{ value: 'verdict', label: t('step.onVerdictPick', 'On a verdict…') }] : []),
    ],
    isVerdict ? 'verdict' : current,
    (v) => t('inspector.unknownValue', 'Unknown value: {{v}}', { v }),
  );
  // Outcomes the switch can name: the catalog's, plus any authored one the
  // catalog no longer declares — shown so it can be seen and removed.
  const chipOutcomes = [...verdictOptions, ...selected.filter((o) => !verdictOptions.includes(o))];

  return (
    <div>
      <FieldLabel>{t('step.on', 'Run when its dependencies…')}</FieldLabel>
      <AuroraSelect
        value={isVerdict ? 'verdict' : current}
        hasError={base.hasError}
        onChange={(v) => set(v === 'verdict' ? `${VERDICT_PREFIX}${verdictOptions[0] ?? selected[0] ?? ''}` : v)}
        options={base.options}
      />
      {isVerdict && (
        <>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {chipOutcomes.map((o) => {
              const active = selected.includes(o);
              const stale = !verdictOptions.includes(o);
              return (
                <ToggleChip
                  key={o}
                  active={active}
                  title={stale ? t('step.onVerdictStale', 'Not declared by the upstream intent any more') : undefined}
                  onClick={() => {
                    const next = active ? selected.filter((x) => x !== o) : [...selected, o];
                    if (next.length === 0) return; // a switch with no arm is `success` — pick that in the select
                    set(`${VERDICT_PREFIX}${next.join('|')}`);
                  }}
                >
                  {stale ? `⚠ ${o}` : o}
                </ToggleChip>
              );
            })}
          </div>
          <FieldHint spacing="above">{t('step.onVerdictOutcomes', 'Runs when the upstream verdict is one of the selected outcomes; a non-match skips this step and everything downstream of it.')}</FieldHint>
        </>
      )}
    </div>
  );
}
