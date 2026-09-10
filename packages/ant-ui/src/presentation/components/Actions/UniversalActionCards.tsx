/**
 * The universal card vocabulary — agent › job › intent — rendered ONCE.
 *
 * These cards are exposed in exactly two places: the Actions tab page
 * (`UniversalActionsPanel`) and the chat window's action area
 * (`UniversalChatActionCards`). Those used to be two JSX bodies over one hook,
 * and they had already drifted — the panel had jobs and intents, the chat had
 * jobs only and ejected the reader into the panel on every click. One renderer
 * means a level added here appears in both, in the same order, with the same
 * grouping, disabled rules and back edges.
 *
 * `variant` decides chrome only. The single behavioural difference is the
 * intent hand-off: the detail view is a full-height page with its own footer,
 * so the chat variant opens the panel onto it instead of hosting it.
 */

import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { IntentChipGrid } from './ActionChipGrid';
import { ScrollableTabNav } from './ScrollableTabNav';
import { ActionsScrollArea } from './ActionsScrollArea';
import { DomainBadge } from './DomainBadge';
import { AgentScopeGroups } from './AgentScopeGroups';
import { universalCardLevel } from './universalSurfaceRules';
import type { UniversalActionSurface } from './useUniversalActionSurface';

export function UniversalActionCards({
  surface,
  variant,
}: {
  surface: UniversalActionSurface;
  variant: 'panel' | 'chat';
}) {
  const { t } = useTranslation('actions');
  const step = useStore((s) => s.actionsStep);
  const setActionsStep = useStore((s) => s.setActionsStep);
  const openActionsPanel = useStore((s) => s.openActionsPanel);

  // Clamp downward when the level below has no subject — the vanished-subject
  // guard the intent detail view already applies, one level up: an agent with
  // no jobs (or none selected) would otherwise draw an empty strip over an
  // empty grid, which reads as a broken panel rather than a step.
  const requested = universalCardLevel(step);
  const level =
    requested !== 'agent' && surface.agentId == null
      ? 'agent'
      : requested === 'intent' && surface.jobTabItems.length === 0
        ? 'job'
        : requested;

  const handleIntentSelect = (intentId: string) => {
    // Canonical parity (ActionsPanel.handleIntentSelect): ONE atomic selection
    // write — arms the intent AND sets the detail subject — then a separate
    // step decision.
    surface.selectIntent(intentId);
    if (variant === 'chat') openActionsPanel();
    setActionsStep('intent-detail');
  };

  if (level === 'agent') {
    return (
      <Scroll variant={variant}>
        <AgentScopeGroups
          surface={surface}
          onSelect={(agentId) => {
            surface.selectAgent(agentId);
            setActionsStep('pick-action');
          }}
        />
      </Scroll>
    );
  }

  if (level === 'job') {
    return (
      <>
        <Strip variant={variant}>
          <ScrollableTabNav
            items={surface.agentTabItems}
            selectedId={surface.agentId ?? surface.agentTabItems[0]?.id ?? ''}
            onSelect={(agentId) => surface.selectAgent(agentId)}
            onBack={() => setActionsStep('pick-agent')}
            rightAccessory={variant === 'panel' ? <DomainBadge /> : undefined}
          />
        </Strip>
        <Scroll variant={variant} pageKey={surface.agentId ?? ''}>
          <IntentChipGrid
            items={surface.jobChipItems}
            onSelect={(jobId) => {
              surface.selectJob(jobId);
              setActionsStep('pick-intent');
            }}
            title={t('universal.pickJobTitle', { defaultValue: 'What should this agent do?' })}
          />
        </Scroll>
      </>
    );
  }

  return (
    <>
      <Strip variant={variant}>
        <ScrollableTabNav
          items={surface.jobTabItems}
          selectedId={surface.selectedJobId ?? surface.jobTabItems[0]?.id ?? ''}
          onSelect={(jobId) => surface.selectJob(jobId)}
          onBack={() => setActionsStep('pick-action')}
          rightAccessory={variant === 'panel' ? <DomainBadge /> : undefined}
        />
      </Strip>
      <Scroll variant={variant} pageKey={surface.selectedJobId ?? ''}>
        {surface.intentChipItems.length === 0 ? (
          <span
            className="block mx-auto text-xs text-center"
            style={{ color: 'var(--text-4)', maxWidth: 380, lineHeight: 1.6 }}
          >
            {t('universal.noIntents', {
              defaultValue: 'This job declares no intents — every turn runs with its base prompt.',
            })}
          </span>
        ) : (
          <IntentChipGrid
            items={surface.intentChipItems}
            onSelect={handleIntentSelect}
            subtitle={t('universal.pickIntentHint', {
              defaultValue:
                'Pick an intent to pin it to your next chat turn — its contract opens for review.',
            })}
          />
        )}
      </Scroll>
    </>
  );
}

/** The panel owns a scroll viewport; the chat area is already inside one. */
function Scroll({
  variant,
  pageKey,
  children,
}: {
  variant: 'panel' | 'chat';
  pageKey?: string;
  children: React.ReactNode;
}) {
  if (variant === 'panel') {
    return (
      <ActionsScrollArea pageKey={pageKey} direction={1}>
        {children}
      </ActionsScrollArea>
    );
  }
  return <div style={{ width: '100%', flexShrink: 0 }}>{children}</div>;
}

function Strip({ variant, children }: { variant: 'panel' | 'chat'; children: React.ReactNode }) {
  return (
    <div className={variant === 'panel' ? 'shrink-0 px-5 pt-5' : 'shrink-0 w-full pb-3'}>{children}</div>
  );
}
