/**
 * Actions panel — universal (workspace) variant.
 *
 * The canonical panel's vocabulary (action → intent → config → basis) is
 * RAC-shaped and has no meaning here: a universal project's work is picked by
 * `{agentId}/{jobId}` and refined by the job's own intent catalog. The cards
 * themselves live in `UniversalActionCards`, shared verbatim with the chat
 * action area — this component owns only the panel's chrome: the shell, the
 * no-agents state, and the intent detail page (a full-height view the chat
 * column cannot host, which is why the chat hands off into it).
 *
 * The step rides the SAME `actionsStep` channel the canonical panel uses
 * (`pick-action` ≡ pick-job) rather than local state, so the chat action area
 * and an open panel always show the same level.
 */

import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useUniversalActionSurface } from './useUniversalActionSurface';
import { UniversalActionCards } from './UniversalActionCards';
import { UniversalIntentDetailView } from './UniversalIntentDetailView';

export function UniversalActionsPanel() {
  const { t } = useTranslation('actions');
  const surface = useUniversalActionSurface();
  const step = useStore((s) => s.actionsStep);

  if (!surface.hasAgents) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
          <span className="text-sm" style={{ color: 'var(--text-3)' }}>
            {t('universal.noAgent', { defaultValue: 'No agents are available in this workspace' })}
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

  // `ready` is the detail view's precondition: it reads the selected job's
  // catalog. Without it the cards clamp back to a level that has a subject.
  if (step === 'intent-detail' && surface.ready) {
    return <UniversalIntentDetailView surface={surface} />;
  }

  return (
    <Shell>
      <UniversalActionCards surface={surface} variant="panel" />
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
