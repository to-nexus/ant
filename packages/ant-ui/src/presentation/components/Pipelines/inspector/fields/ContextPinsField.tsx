import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FolderOpen, Trash2 } from 'lucide-react';
import type { CustomAgentSummary, JobStepDef, PipelineAdvisory, PipelineDef } from '@ant/shared';
import { useStore } from '@/domain/store';
import { useArtifactPickerTree } from '@/application/hooks/ui/useArtifactPickerTree';
import { AuroraInput, FieldLabel } from '../../../ConfigEditor/aurora';
import { HintBadge } from '../../../common/HintBadge';
import { FileTreePicker } from '../../../common/FileTreePicker';
import { updateStep } from '../../draft';
import { upstreamOutputSuggestions } from '../../upstreamOutputs';
import { resolveStepIdentity } from '../../stepIdentity';
import { availableStaticTokens } from '../../templateTokens';
import { Tooltip } from '../../../common/Tooltip';
import { TokenChip } from '../chips';
import { AdvisoryHints } from '../AdvisoryHints';

const linkButton: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 };

/**
 * Context pins — the step's inputs. Upstream steps' stop globs are offered as
 * chips (the natural pins), and the static partition variables pins accept
 * (`{{trigger.fireDate}}`, `{{run.id}}`) are one click too; free text stays
 * the primary input, Browse is a convenience tree of the currently selected
 * project (pins resolve against the ACTIVATION project at dispatch).
 */
export function ContextPinsField({
  def,
  step,
  onChange,
  customAgents,
  advisories,
}: {
  def: PipelineDef;
  step: JobStepDef;
  onChange: (d: PipelineDef) => void;
  customAgents: CustomAgentSummary[];
  advisories?: readonly PipelineAdvisory[];
}) {
  const { t } = useTranslation('pipelines');
  const pins = step.context ?? [];
  const setPins = (context: string[]) => onChange(updateStep(def, step.id, { context: context.length > 0 ? context : undefined }));
  const appendToken = (token: string) => {
    const last = pins.length - 1;
    if (last >= 0 && pins[last].trim() === '') setPins(pins.map((p, i) => (i === last ? token : p)));
    else setPins([...pins, token]);
  };

  const selectedProject = useStore((s) => s.selectedProject);
  const projectType = useStore((s) => s.projectType);
  const pickerTree = useArtifactPickerTree({ definitionMounts: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const canBrowse = !!selectedProject && projectType === 'universal' && pickerTree.length > 0;

  const suggestions = useMemo(() => upstreamOutputSuggestions(def, step.id, customAgents), [def, step.id, customAgents]);
  const stepName = (id: string) => {
    const source = def.steps.find((s) => s.id === id);
    return source ? resolveStepIdentity(source, customAgents, t).primary : id;
  };
  const suggestionGroups = useMemo(() => {
    const groups = new Map<string, typeof suggestions>();
    for (const sug of suggestions) groups.set(sug.sourceStepId, [...(groups.get(sug.sourceStepId) ?? []), sug]);
    return [...groups.entries()];
  }, [suggestions]);
  // `pinTemplateErrors` accepts the WHOLE static whitelist in a pin, so the
  // offer is the same gate the directive uses — a second local list is how the
  // `run.prevSuccess.*` pair went missing here while the validator took it.
  const pinVars = availableStaticTokens(def);

  return (
    <div>
      <FieldLabel
        optional
        action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {canBrowse && (
              <button onClick={() => setPickerOpen(true)} style={linkButton}>
                <FolderOpen size={11} /> {t('step.browse', 'Browse')}
              </button>
            )}
            <button onClick={() => setPins([...pins, ''])} style={linkButton}>
              <Plus size={11} /> {t('step.addContext', 'Add')}
            </button>
          </span>
        }
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {t('step.context', 'Context pins')}
          <HintBadge
            isCompact
            label={t('step.context', 'Context pins')}
            tooltip={t('step.contextHint', 'Attached to the step when it is dispatched. A glob expands to the matching artifacts (newest first); a pin that matches nothing fails the step — pin what an upstream step guarantees.')}
          />
        </span>
      </FieldLabel>
      {suggestionGroups.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>{t('step.upstreamOutputs', 'Upstream step outputs')}</span>
            <HintBadge
              isCompact
              label={t('step.upstreamOutputs', 'Upstream step outputs')}
              tooltip={t('step.upstreamOutputsHint', "Each glob is that step intent's stop-hook output contract — it exists before this step runs, and expands to the actual files at dispatch.")}
            />
          </div>
          {suggestionGroups.map(([sourceStepId, group]) => (
            <div key={sourceStepId} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)' }} title={sourceStepId}>
                {stepName(sourceStepId)}
              </span>
              {group.map((sug) => {
                const pinned = pins.includes(sug.glob);
                return (
                  <TokenChip key={sug.glob} disabled={pinned} onClick={() => setPins([...pins, sug.glob])}>
                    {sug.glob}
                  </TokenChip>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pins.map((path, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <AuroraInput mono value={path} placeholder={t('step.contextPlaceholder', 'plan/spec.md')} onChange={(v) => setPins(pins.map((c, j) => (j === i ? v : c)))} />
            </div>
            <button aria-label={t('step.removeContext', 'Remove pin')} onClick={() => setPins(pins.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>{t('step.pinVars', 'Partition variables')}</span>
        <HintBadge
          isCompact
          label={t('step.pinVars', 'Partition variables')}
          tooltip={t('step.pinVarsHint', 'A pin may carry a static variable — reports/{{trigger.fireDate}}/** pins exactly this run\'s partition. Step outputs cannot be pinned; pin the upstream glob instead.')}
        />
        {pinVars.map((spec) => (
          <Tooltip key={spec.name} content={`{{${spec.name}}} · ${t(spec.hintKey, spec.hintFallback)}`} placement="top" trigger="hover">
            <TokenChip onClick={() => appendToken(`{{${spec.name}}}`)}>
              <spec.icon size={11} />
              {t(spec.faceKey, spec.faceFallback)}
            </TokenChip>
          </Tooltip>
        ))}
      </div>
      <AdvisoryHints advisories={advisories} field="context" />
      {pickerOpen && (
        <FileTreePicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={t('step.browseTitle', 'Attach context — {{project}}', { project: selectedProject })}
          eyebrow={t('step.browseEyebrow', 'CONTEXT')}
          fileTree={pickerTree}
          initialSelected={pins.filter((c) => c.trim().length > 0)}
          onConfirm={(paths) => {
            setPins(paths);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
