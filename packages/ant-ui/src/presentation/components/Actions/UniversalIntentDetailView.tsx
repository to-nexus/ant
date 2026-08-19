/**
 * Universal per-intent detail view — the `intent-detail` step of the
 * universal actions panel, mirroring the canonical `ActionConfigView` layout:
 * a sticky sibling-tab nav on top, a `Section` stack, and the same bottom
 * menu (`ActionFooter`, universal-intent variant: Chat arms the intent and
 * focuses the composer, Build dispatches a run with it pinned).
 *
 * The body is read-only by design — definitions are edited in Agent Settings —
 * but it shows ALL THREE files that define the intent, one section each:
 * `infer.md` (criterion), `prompt.md` (fetched lazily; the catalog carries only
 * its presence flag) and `hooks.yaml` (structured rows). Every section links to
 * its own card in Agent Settings, for readonly (org/builtin) agents too — the
 * definition is viewable there whether or not this caller may edit it.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, BookOpen, CircleCheckBig, Target } from 'lucide-react';
import type { IntentStopHook } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { Skeleton } from '@/presentation/components/common/async';
import { ClampedBlock } from '@/presentation/components/common/ClampedBlock';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { ActionFooter } from './ActionFooter';
import { Section } from './config/Section';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import { PageTransition } from './PageTransition';
import { DomainBadge } from './DomainBadge';
import { useIntentPromptBody } from './useIntentPromptBody';
import type { UniversalActionSurface } from './useUniversalActionSurface';

const HOOK_TONE: Record<'artifact' | 'action', { color: string; bg: string }> = {
  artifact: { color: 'var(--emerald-700, var(--text-2))', bg: 'oklch(from var(--emerald-500) l c h / 0.14)' },
  action: { color: 'var(--amber-700, var(--text-2))', bg: 'oklch(from var(--amber-500) l c h / 0.14)' },
};

/** Same renderer the settings screen's prose surfaces use — one markdown look. */
const MARKDOWN_COMPONENTS = createMarkdownComponents({ paragraphTag: 'p' });

/** Collapsed heights: prose gets more room than a hook list. */
const CRITERIA_MAX_HEIGHT = 260;
const PROMPT_MAX_HEIGHT = 320;
const HOOKS_MAX_HEIGHT = 260;

/**
 * The shared shell every section's body sits in — one bordered "file box", so
 * the three files read as three views of the same thing rather than three
 * layouts. Clamping lives inside it, so a long body fades against the box's own
 * background.
 */
function FileBox({ maxHeight, children }: { maxHeight: number; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--r-md)] overflow-hidden"
      style={{ border: '1px solid var(--border-1)', background: 'var(--bg-surface)' }}
    >
      <ClampedBlock maxHeight={maxHeight}>{children}</ClampedBlock>
    </div>
  );
}

/** Muted caption for an absent/unreadable file — never a blank section. */
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11.5px] m-0" style={{ color: 'var(--text-4)', lineHeight: 1.5 }}>
      {children}
    </p>
  );
}

function SectionLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip content={label} placement="top" trigger="hover">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="inline-flex items-center justify-center rounded-md transition-colors hover:bg-[color:var(--bg-hover)]"
        style={{ width: 22, height: 22, color: 'var(--text-3)' }}
      >
        <ArrowUpRight size={13} aria-hidden />
      </button>
    </Tooltip>
  );
}

function StopHookRow({ hook }: { hook: IntentStopHook }) {
  const { t } = useTranslation('actions');
  const kind: 'artifact' | 'action' = 'artifact' in hook ? 'artifact' : 'action';
  const value = 'artifact' in hook ? hook.artifact : hook.action;
  const tone = HOOK_TONE[kind];
  return (
    <div
      className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2"
      style={{ border: '1px solid var(--border-1)', background: 'var(--bg-surface-2)' }}
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

/** Three shimmer lines, so the prompt section keeps its height while loading. */
const SKELETON_LINES: ReadonlyArray<[widthClass: string, delayMs: number]> = [
  ['w-[92%]', 0],
  ['w-[78%]', 90],
  ['w-[60%]', 180],
];

function PromptSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {SKELETON_LINES.map(([widthClass, delayMs]) => (
        <Skeleton key={widthClass} variant="rect" className={`h-2 ${widthClass}`} delayMs={delayMs} />
      ))}
    </div>
  );
}

export function UniversalIntentDetailView({ surface }: { surface: UniversalActionSurface }) {
  const { t } = useTranslation('actions');
  const setActionsStep = useStore((s) => s.setActionsStep);
  const detailIntentId = useStore((s) => s.universalDetailIntentId);
  const setDetailIntentId = useStore((s) => s.setUniversalDetailIntentId);
  const openMainPanelTab = useStore((s) => s.openMainPanelTab);
  const requestAgentSettingsFile = useStore((s) => s.requestAgentSettingsFile);
  // Sibling-tab navigation slides toward the tapped tab, like ActionConfigView.
  const prevIndexRef = useRef(0);

  const intent = surface.intents.find((i) => i.id === detailIntentId);
  const prompt = useIntentPromptBody(
    surface.agentId,
    surface.selectedJobId,
    intent?.id ?? '',
    intent?.hasPrompt,
  );

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

  /**
   * Open Agent Settings at this intent — the intent directory (its identity
   * card) with no file, or one of its three files. The path IS the request; the
   * settings screen owns the file→card mapping.
   */
  const openInSettings = (file?: 'infer.md' | 'prompt.md' | 'hooks.yaml') => {
    const { agentId, selectedJobId } = surface;
    if (!agentId || !selectedJobId) return;
    const dir = `jobs/${selectedJobId}/intents/${intent.id}`;
    requestAgentSettingsFile(agentId, file ? `${dir}/${file}` : dir);
    openMainPanelTab('agentSettings');
  };

  const sectionLinkLabel = t('universal.openSectionInSettings', {
    defaultValue: 'Open in Agent Settings',
  });

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 pt-5">
        <ScrollableTabNav
          items={tabItems}
          selectedId={intent.id}
          onSelect={(id) => setDetailIntentId(id)}
          onBack={() => setActionsStep('pick-intent')}
          rightAccessory={
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                aria-label={t('universal.openInSettingsAria', {
                  defaultValue: 'Open this intent in Agent Settings',
                })}
                onClick={() => openInSettings()}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 transition-colors"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--violet-600)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
              >
                <ArrowUpRight className="w-3 h-3 shrink-0" aria-hidden />
                {t('universal.openInSettings', { defaultValue: 'Open in Agent Settings' })}
              </button>
              <DomainBadge />
            </div>
          }
        />
      </div>

      <PageTransition pageKey={intent.id} direction={direction} className="flex-1 overflow-y-auto">
        <div className="px-5 py-5 space-y-4 max-w-2xl mx-auto w-full">
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
            action={<SectionLink label={sectionLinkLabel} onClick={() => openInSettings('infer.md')} />}
          >
            <FileBox maxHeight={CRITERIA_MAX_HEIGHT}>
              <p
                className="text-[12.5px] whitespace-pre-wrap m-0 px-3 py-2.5"
                style={{ color: 'var(--text-2)', lineHeight: 1.6 }}
              >
                {intent.infer}
              </p>
            </FileBox>
          </Section>

          <Section
            title={t('universal.intentDetailPrompt', { defaultValue: 'Prompt' })}
            icon={BookOpen}
            action={<SectionLink label={sectionLinkLabel} onClick={() => openInSettings('prompt.md')} />}
          >
            {prompt.status === 'absent' ? (
              <Caption>
                {t('universal.intentNoPromptHint', {
                  defaultValue: 'No prompt file — this intent runs on the base prompts alone.',
                })}
              </Caption>
            ) : prompt.status === 'error' ? (
              <Caption>
                {t('universal.intentPromptLoadError', {
                  defaultValue: 'Could not load prompt.md — open it in Agent Settings to read the file.',
                })}
              </Caption>
            ) : (
              <FileBox maxHeight={PROMPT_MAX_HEIGHT}>
                {prompt.status === 'loading' ? (
                  <PromptSkeleton />
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none px-3 py-2.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {prompt.body}
                    </ReactMarkdown>
                  </div>
                )}
              </FileBox>
            )}
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
            action={<SectionLink label={sectionLinkLabel} onClick={() => openInSettings('hooks.yaml')} />}
          >
            {stopHooks.length === 0 ? (
              <Caption>
                {t('universal.hooksNone', {
                  defaultValue: 'No hooks — the turn ends when the agent stops.',
                })}
              </Caption>
            ) : (
              <>
                <FileBox maxHeight={HOOKS_MAX_HEIGHT}>
                  <div className="flex flex-col gap-1.5 px-2.5 py-2.5">
                    {stopHooks.map((hook, i) => (
                      <StopHookRow key={i} hook={hook} />
                    ))}
                  </div>
                </FileBox>
                <p className="text-[10.5px] m-0 mt-1.5 px-1" style={{ color: 'var(--text-4)', lineHeight: 1.5 }}>
                  {t('universal.hooksVerified', {
                    defaultValue:
                      "Checked at the turn's stop event, from actual tool results — never from the model's claims. Unmet hooks re-prompt the agent a bounded number of times, then pause the job resumably.",
                  })}
                </p>
              </>
            )}
          </Section>
        </div>
      </PageTransition>

      <ActionFooter variant="universal-intent" intentId={intent.id} />
    </div>
  );
}
