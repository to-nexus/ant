/**
 * StepInspector — the right-hand drawer the canvas opens on node click
 * (n8n interaction model). Three panels over ONE draft — trigger, job step,
 * approval gate — each laid out identity → wiring → work → inputs → policy.
 * Save-time advisories for the selected step ride in and land under the
 * field they name.
 */

import { useTranslation } from 'react-i18next';
import { isApprovalStep, type CustomAgentSummary, type PipelineAdvisory, type PipelineDef } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Button } from '../aurora';
import { InspectorShell } from './InspectorShell';
import { NODE_KIND_STYLE, TRIGGER_MODE_ICON, type NodeKind } from './canvas/nodes';
import { TRIGGER_NODE_ID, removeStep, triggerModeOf } from './draft';
import { TriggerPanel } from './inspector/TriggerPanel';
import { JobStepPanel } from './inspector/JobStepPanel';
import { GatePanel } from './inspector/GatePanel';

export interface StepInspectorProps {
  def: PipelineDef;
  nodeId: string;
  onChange: (next: PipelineDef) => void;
  onClose: () => void;
  onCronValidity: (ok: boolean) => void;
  /** Save-time advisories anchored to this node (already filtered by stepId). */
  advisories?: readonly PipelineAdvisory[];
  /** The selected node's id changed through the id field — keep the selection on it. */
  onStepRenamed?: (id: string) => void;
}

export function StepInspector({ def, nodeId, onChange, onClose, onCronValidity, advisories, onStepRenamed }: StepInspectorProps) {
  const { t } = useTranslation('pipelines');
  // Account-scoped catalog — the pipelines tab is account-scoped, so the
  // project-scoped `customAgents` slice can be legitimately empty here.
  const customAgents = useStore((s) => s.accountAgents) as CustomAgentSummary[];

  const step = def.steps.find((s) => s.id === nodeId);
  const isTrigger = nodeId === TRIGGER_NODE_ID;
  const stepIndex = def.steps.findIndex((s) => s.id === nodeId);

  const kind: NodeKind = isTrigger ? 'trigger' : step && isApprovalStep(step) ? 'gate' : 'step';
  const title = { trigger: t('inspector.trigger', 'Trigger & policies'), gate: t('inspector.gate', 'Approval gate'), step: t('inspector.step', 'Job step') }[kind];
  const look = NODE_KIND_STYLE[kind];

  return (
    <InspectorShell title={title} icon={isTrigger ? TRIGGER_MODE_ICON[triggerModeOf(def)] : look.icon} accent={look.accent} onClose={onClose}>
      {isTrigger ? (
        <TriggerPanel def={def} onChange={onChange} onCronValidity={onCronValidity} />
      ) : step && isApprovalStep(step) ? (
        <GatePanel def={def} step={step} stepIndex={stepIndex} onChange={onChange} advisories={advisories} onStepRenamed={onStepRenamed} />
      ) : step ? (
        <JobStepPanel def={def} step={step} stepIndex={stepIndex} onChange={onChange} customAgents={customAgents} advisories={advisories} onStepRenamed={onStepRenamed} />
      ) : null}
      {!isTrigger && step && (
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border-1)' }}>
          <Button
            variant="danger"
            size="sm"
            fullWidth
            onClick={() => {
              onChange(removeStep(def, step.id));
              onClose();
            }}
          >
            {t('inspector.deleteStep', 'Remove step')}
          </Button>
        </div>
      )}
    </InspectorShell>
  );
}
