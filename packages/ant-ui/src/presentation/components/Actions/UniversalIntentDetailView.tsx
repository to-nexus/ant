/**
 * Universal per-intent detail view — the `intent-detail` step of the
 * universal actions panel, mirroring the canonical `ActionConfigView` layout:
 * a sticky sibling-tab nav on top, a `Section` stack, and the same bottom
 * menu (`ActionFooter`, universal-intent variant: Chat arms the intent and
 * focuses the composer, Build dispatches a run with it pinned).
 *
 * The body is read-only by design — definitions are edited in Agent Settings.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CircleCheckBig, Target } from 'lucide-react';
import type { IntentStopHook } from '@ant/shared';
import { useStore } from '@/domain/store';
import { ActionFooter } from './ActionFooter';
import { Section } from './config/Section';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import { PageTransition } from './PageTransition';
import { DomainBadge } from './DomainBadge';
import type { UniversalActionSurface } from './useUniversalActionSurface';

const HOOK_TONE: Record<'artifact' | 'action', { color: string; bg: string }> = {
  artifact: { color: 'var(--emerald-700, var(--text-2))', bg: 'oklch(from var(--emerald-500) l c h / 0.14)' },
  action: { color: 'var(--amber-700, var(--text-2))', bg: 'oklch(from var(--amber-500) l c h / 0.14)' },
};

function StopHookRow({ hook }: { hook: IntentStopHook }) {
  const { t } = useTranslation('actions');
  const kind: 'artifact' | 'action' = 'artifact' in hook ? 'artifact' : 'action';
  const value = 'artifact' in hook ? hook.artifact : hook.action;
  const tone = HOOK_TONE[kind];
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-3 py-2"
      style={{ border: '1px solid var(--border-1)', background: 'var(--bg-surface)' }}
    >
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0"
        style={{ color: tone.color, background: tone.bg }}
      >
        {kind}
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className="text-[12px] truncate"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}
          title={value}
        >
          {value}
        </span>
        <span className="text-[10.5px]" style={{ color: 'var(--text-4)' }}>
          {kind === 'artifact'
            ? t('universal.hookArtifactMeaning', {
                defaultValue: 'A real file write this turn must match this glob.',
              })
            : t('universal.hookActionMeaning', {
                defaultValue: 'This tool must have been successfully called this turn.',
              })}
        </span>
      </div>
    </div>
  );
}

export function UniversalIntentDetailView({ surface }: { surface: UniversalActionSurface }) {
  const { t } = useTranslation('actions');
  const setActionsStep = useStore((s) => s.setActionsStep);
  const detailIntentId = useStore((s) => s.universalDetailIntentId);
  const setDetailIntentId = useStore((s) => s.setUniversalDetailIntentId);
  // Sibling-tab navigation slides toward the tapped tab, like ActionConfigView.
  const prevIndexRef = useRef(0);

  const intent = surface.intents.find((i) => i.id === detailIntentId);

  // Catalog reload race: the intent vanished while its detail was open.
  useEffect(() => {
    if (!intent) setActionsStep('pick-intent');
  }, [intent, setActionsStep]);
  if (!intent) return null;

  const index = surface.intents.indexOf(intent);
  const direction = index >= prevIndexRef.current ? 1 : -1;
  prevIndexRef.current = index;

  const tabItems: TabItem[] = surface.intents.map((i) => ({
    id: i.id,
    label: i.id,
    icon: Target,
  }));

  const stopHooks = intent.hooks?.stop ?? [];

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 pt-5">
        <ScrollableTabNav
          items={tabItems}
          selectedId={intent.id}
          onSelect={(id) => setDetailIntentId(id)}
          onBack={() => setActionsStep('pick-intent')}
          rightAccessory={<DomainBadge />}
        />
      </div>

      <PageTransition pageKey={intent.id} direction={direction} className="flex-1 overflow-y-auto">
        <div className="px-5 py-5 space-y-5 max-w-2xl mx-auto w-full">
          <Section
            title={t('universal.intentDetailCriteria', { defaultValue: 'Matching criteria' })}
            icon={Target}
            hint={
              intent.clarify === false
                ? {
                    label: t('universal.intentAutonomous', { defaultValue: 'autonomous' }),
                    tooltip: t('universal.intentAutonomousHint', {
                      defaultValue:
                        'Turns under this intent never ask a blocking question and proceed with sensible defaults.',
                    }),
                    colorScheme: 'amber',
                  }
                : undefined
            }
          >
            <p
              className="text-[12.5px] whitespace-pre-wrap m-0"
              style={{ color: 'var(--text-2)', lineHeight: 1.6 }}
            >
              {intent.infer}
            </p>
          </Section>

          <Section
            title={t('universal.intentDetailPrompt', { defaultValue: 'Prompt' })}
            icon={BookOpen}
          >
            <p className="text-[11.5px] m-0" style={{ color: 'var(--text-4)' }}>
              {intent.hasPrompt === true
                ? t('universal.intentHasPromptHint', {
                    defaultValue: 'Adds its own prompt.md to the system prompt while active.',
                  })
                : t('universal.intentNoPromptHint', {
                    defaultValue: 'No prompt file — this intent runs on the base prompts alone.',
                  })}
            </p>
          </Section>

          <Section
            title={t('universal.intentDetailHooks', { defaultValue: 'Hooks' })}
            icon={CircleCheckBig}
            hint={
              stopHooks.length > 1
                ? {
                    label: t('universal.hooksAll', { defaultValue: 'All required' }),
                    tooltip: t('universal.hooksAllHint', {
                      defaultValue:
                        'Every entry must hold when the turn stops (the stop event, AND), verified from actual tool results.',
                    }),
                    colorScheme: 'amber',
                  }
                : undefined
            }
          >
            {stopHooks.length === 0 ? (
              <p className="text-[11.5px] m-0" style={{ color: 'var(--text-4)' }}>
                {t('universal.hooksNone', {
                  defaultValue: 'No hooks — the turn ends when the agent stops.',
                })}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {stopHooks.map((hook, i) => (
                  <StopHookRow key={i} hook={hook} />
                ))}
                <p className="text-[10.5px] m-0 mt-1" style={{ color: 'var(--text-4)', lineHeight: 1.5 }}>
                  {t('universal.hooksVerified', {
                    defaultValue:
                      "Checked at the turn's stop event, from actual tool results — never from the model's claims. Unmet hooks re-prompt the agent a bounded number of times, then pause the job resumably.",
                  })}
                </p>
              </div>
            )}
          </Section>
        </div>
      </PageTransition>

      <ActionFooter variant="universal-intent" intentId={intent.id} />
    </div>
  );
}
