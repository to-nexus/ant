/**
 * Actions panel — universal (workspace) variant.
 *
 * The canonical panel's vocabulary (action → intent → config → basis) is
 * RAC-shaped and has no meaning here: a universal project's work is picked by
 * `{agentId}/{jobId}` and refined by the job's own intent catalog. So this is
 * the same two-step flow with the universal nouns — job, then intent — and no
 * config/basis depth. The chips themselves come from
 * `useUniversalActionSurface`, shared with the chat empty state.
 *
 * The step rides the SAME `actionsStep` channel the canonical panel uses
 * (`pick-action` ≡ pick-job) rather than local state, so the chat empty state
 * can hand off into the intent step exactly as a canonical chip does.
 */

import { Briefcase } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { IntentChipGrid } from './ActionChipGrid';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import { ActionsScrollArea } from './ActionsScrollArea';
import { DomainBadge } from './DomainBadge';
import { useUniversalActionSurface } from './useUniversalActionSurface';
import { UniversalIntentDetailView } from './UniversalIntentDetailView';

export function UniversalActionsPanel() {
  const { t } = useTranslation('actions');
  const surface = useUniversalActionSurface();
  const step = useStore((s) => s.actionsStep);
  const setActionsStep = useStore((s) => s.setActionsStep);

  const handleJobSelect = (jobId: string) => {
    surface.selectJob(jobId);
    setActionsStep('pick-intent');
  };

  const jobTabItems: TabItem[] = surface.jobs.map((j) => ({
    id: j.id,
    label: j.name,
    icon: Briefcase,
  }));

  if (!surface.ready) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
          <span className="text-sm" style={{ color: 'var(--text-3)' }}>
            {t('universal.noAgent', { defaultValue: 'Select an agent in the chat toolbar first' })}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-4)', maxWidth: 380, lineHeight: 1.6 }}>
            {t('universal.noAgentHint', {
              defaultValue: 'Agents and their jobs are authored in Agent Settings, from the profile menu.',
            })}
          </span>
        </div>
      </Shell>
    );
  }

  if (step === 'intent-detail') {
    return <UniversalIntentDetailView surface={surface} />;
  }

  if (step === 'pick-action') {
    return (
      <Shell>
        <ActionsScrollArea>
          <IntentChipGrid
            items={surface.jobChipItems}
            onSelect={handleJobSelect}
            title={t('universal.pickJobTitle', { defaultValue: 'What should this agent do?' })}
            subtitle={surface.agentName}
          />
        </ActionsScrollArea>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="shrink-0 px-5 pt-5">
        <ScrollableTabNav
          items={jobTabItems}
          selectedId={surface.selectedJobId ?? surface.jobs[0].id}
          onSelect={(jobId) => surface.selectJob(jobId)}
          onBack={() => setActionsStep('pick-action')}
          rightAccessory={<DomainBadge />}
        />
      </div>
      <ActionsScrollArea pageKey={surface.selectedJobId ?? ''} direction={1}>
        {surface.intentChipItems.length === 0 ? (
          <span className="block mx-auto text-xs text-center" style={{ color: 'var(--text-4)', maxWidth: 380, lineHeight: 1.6 }}>
            {t('universal.noIntents', {
              defaultValue:
                'This job declares no intents — every turn runs with its base prompt.',
            })}
          </span>
        ) : (
          <IntentChipGrid
            items={surface.intentChipItems}
            onSelect={(intentId) => {
              // Canonical parity (ActionsPanel.handleIntentSelect): ONE atomic
              // selection write — arms the intent AND sets the detail subject —
              // then a separate step decision.
              surface.selectIntent(intentId);
              setActionsStep('intent-detail');
            }}
            subtitle={t('universal.pickIntentHint', {
              defaultValue:
                'Pick an intent to pin it to your next chat turn — its contract opens for review.',
            })}
          />
        )}
      </ActionsScrollArea>
    </Shell>
  );
}

/** Canonical parity: the panel paints `--bg-app` and clips; each step scrolls itself. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-app)' }}
    >
      {children}
    </div>
  );
}
