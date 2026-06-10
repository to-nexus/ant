import { useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot, Zap, type LucideIcon } from 'lucide-react';
import { formatElapsedTime } from '@/shared/utils/timeUtils';
import { formatTokenCount, formatPercent, getTokenUsageMetrics, sumTokenUsages, costUsdFromByModel, creditsFromUsd, formatUsd, formatCredits } from '@/shared/utils/tokenUtils';
import { JobTiming, TaskTokenUsage, TokenUsageByModel, PhaseTokenUsage } from '@/domain/models/types';
import { Tooltip } from '../common/Tooltip';
import { useStore } from '@/domain/store';
import { selectCanViewUsdCost } from '@/domain/store/selectors/auth';
import { cn } from '@/shared/utils/design-system';

/**
 * useRealtimeTick - Forces a re-render every second while `enabled` is true.
 * Used to drive Date.now()-based calculations without stale closures.
 */
function useRealtimeTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);
}

/**
 * LiveElapsedTime - Real-time elapsed time from a startedAt timestamp.
 * Used inside tooltips for in-progress items.
 */
function LiveElapsedTime({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Date.now() - start));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <>{formatElapsedTime(elapsed, true)}</>;
}

/**
 * Wall-clock elapsed time from JobTiming.
 * Pure function — call on every render for real-time display.
 * Uses the same formula for all states (completed/paused/running).
 */
function calculateJobElapsed(jobTiming: JobTiming): number {
  const start = new Date(jobTiming.startedAt).getTime();
  const paused = jobTiming.totalPausedDuration || 0;

  if (jobTiming.completedAt) {
    return Math.max(0, new Date(jobTiming.completedAt).getTime() - start - paused);
  }
  if (jobTiming.pausedAt) {
    return Math.max(0, new Date(jobTiming.pausedAt).getTime() - start - paused);
  }
  return Math.max(0, Date.now() - start - paused);
}

/**
 * Calculate wall-clock duration for the tasks phase using interval merging.
 * Overlapping intervals (parallel tasks) are merged so their time is not double-counted.
 */
function calculateTasksWallClock(
  completedTasks?: Array<{ timing?: { startedAt?: string; completedAt?: string } }>,
  inProgressTasks?: Array<{ timing?: { startedAt?: string } }>
): number {
  const intervals: [number, number][] = [];

  for (const task of completedTasks || []) {
    if (task.timing?.startedAt && task.timing?.completedAt) {
      intervals.push([
        new Date(task.timing.startedAt).getTime(),
        new Date(task.timing.completedAt).getTime(),
      ]);
    }
  }
  for (const task of inProgressTasks || []) {
    if (task.timing?.startedAt) {
      intervals.push([new Date(task.timing.startedAt).getTime(), Date.now()]);
    }
  }
  if (intervals.length === 0) return 0;

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1]) {
      last[1] = Math.max(last[1], intervals[i][1]);
    } else {
      merged.push(intervals[i]);
    }
  }
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/* ────────────────────────────────────────────────────────────────────────
   Popover presentation — the elapsed-time / token badges and their detail
   popovers share the chat "Actions CTA" glass look (ChatPanel.ActionsCTA): a
   faint translucent tint over the surface, a tinted border, 8px radius, no
   shadow/gradient/blur. Token = orange, time = violet (same look, hue only).

   POPOVER_ACCENT is the single source for each one's color identity — trigger
   badge, Tooltip shell, and content accents all read from one entry. `surface`
   layers the CTA's 14% tint over an opaque `--bg-surface` so the floating
   popover stays readable; `text`/`subtext` are the CTA's exact Tailwind text
   classes (title / subtitle) so accent text matches the action badge in both
   themes (darkMode = [data-theme="dark"] reaches portaled content).
   ──────────────────────────────────────────────────────────────────────── */
const POPOVER_ACCENT = {
  time: {
    surface: 'linear-gradient(oklch(from var(--violet-300) l c h / 0.14), oklch(from var(--violet-300) l c h / 0.14)), var(--bg-surface)',
    border: 'oklch(from var(--violet-400) l c h / 0.35)',
    text: 'text-violet-700 dark:text-violet-200',
    subtext: 'text-violet-700/80 dark:text-violet-200/85',
  },
  token: {
    surface: 'linear-gradient(oklch(from var(--orange-300) l c h / 0.14), oklch(from var(--orange-300) l c h / 0.14)), var(--bg-surface)',
    border: 'oklch(from var(--orange-400) l c h / 0.35)',
    text: 'text-orange-700 dark:text-orange-200',
    subtext: 'text-orange-700/80 dark:text-orange-200/85',
  },
} as const;

/** Header row (제목): icon + label in the accent's title text class. */
function PopoverTitle({ icon: Icon, label, textClass }: { icon: LucideIcon; label: string; textClass: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-xs font-semibold', textClass)}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
  );
}

/** Hairline-divided section on the tinted surface (no fill). */
function Section({ children }: { children: ReactNode }) {
  return (
    <div className="pt-2 space-y-1" style={{ borderTop: '1px solid var(--border-1)' }}>
      {children}
    </div>
  );
}

/** Uppercase section label (소제목). Defaults to neutral; pass accent subtext. */
function CardLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[11px] font-semibold uppercase tracking-wide', className ?? 'text-[color:var(--text-2)]')}>
      {children}
    </div>
  );
}

/**
 * Label/value row. Neutral rows pass labelColor/valueColor (inline CSS color).
 * Accent rows pass `accentClass` (Tailwind text class) for both spans instead.
 */
function StatRow({
  label,
  value,
  labelColor = 'var(--text-2)',
  valueColor = 'var(--text-1)',
  strong,
  title,
  accentClass,
}: {
  label: ReactNode;
  value: ReactNode;
  labelColor?: string;
  valueColor?: string;
  strong?: boolean;
  title?: string;
  accentClass?: string;
}) {
  return (
    <div className="flex justify-between items-center gap-3 text-xs">
      <span
        className={cn('min-w-0 flex-1 truncate', strong && 'font-semibold', accentClass)}
        style={accentClass ? undefined : { color: labelColor }}
        title={title}
      >
        {label}
      </span>
      <span
        className={cn('font-mono whitespace-nowrap shrink-0', strong && 'font-semibold', accentClass)}
        style={accentClass ? undefined : { color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}

interface ElapsedTimeBadgeProps {
  jobTiming?: JobTiming;
  completedTasks?: Array<{
    id: string;
    name: string;
    timing?: {
      startedAt?: string;
      completedAt?: string;
      elapsedTime?: number;
    };
  }>;
  inProgressTasks?: Array<{
    id: string;
    name: string;
    timing?: {
      startedAt?: string;
      elapsedTime?: number;
    };
  }>;
  estimatingActivity?: {
    label: string;
    startedAt: string;
  } | null;
  /**
   * Compact mode (h-5, text-[10px]) for dense inline contexts such as the
   * Job-tab dropdown rows. Tooltip content is unchanged.
   */
  compact?: boolean;
  /**
   * When true, tracks real-time only when this specific job is the one the
   * store considers running. Defaults to `true` to preserve the original
   * header behaviour; the dropdown passes `false` for non-current rows so
   * historical snapshots render as static.
   */
  tickFromStore?: boolean;
}

/**
 * ElapsedTimeBadge - Real-time 뱃지 우측에 위치할 경과 시간 뱃지 (with breakdown tooltip)
 *
 * ✅ FIX: Tick-driven re-render + pure Date.now() calculation on every render.
 * No state for elapsed time — avoids stale-value reset from SSE object reference changes.
 * Same proven pattern as LiveElapsedTime.
 */
export function ElapsedTimeBadge({
  jobTiming,
  completedTasks,
  inProgressTasks,
  estimatingActivity,
  compact = false,
  tickFromStore = true,
}: ElapsedTimeBadgeProps) {
  const { t } = useTranslation('kanban');
  // ✅ FIX: Also check store.isRunning as a safety net.
  // If the backend fails to set completedAt/pausedAt on jobTiming (e.g., plan jobs before this fix),
  // the workflow end event still sets store.isRunning=false, which stops the timer.
  const storeIsRunning = useStore((s) => s.isRunning);
  const timingIsRunning = !!jobTiming?.startedAt && !jobTiming?.completedAt && !jobTiming?.pausedAt;
  const isRunning = (tickFromStore ? storeIsRunning : true) && timingIsRunning;
  useRealtimeTick(isRunning);
  
  // ✅ Show badge if job has timing data
  if (!jobTiming) {
    return null;
  }

  const realtimeElapsed = calculateJobElapsed(jobTiming);
  
  // Format elapsed time (include seconds for real-time updates)
  const formattedTime = formatElapsedTime(realtimeElapsed, true);
  
  // Calculate breakdown
  const estimatingTime = jobTiming.estimatingDuration || 0;
  const isEstimatingFinalized = !!jobTiming.estimatingDuration;
  const tasksTotal = calculateTasksWallClock(completedTasks, inProgressTasks);
  const taskCount = (completedTasks?.length || 0) + (inProgressTasks?.length || 0);
  const tasksSequentialSum = (completedTasks?.reduce((s, t) => s + (t.timing?.elapsedTime || 0), 0) || 0)
    + (inProgressTasks?.reduce((s, t) => s + (t.timing?.startedAt ? Date.now() - new Date(t.timing.startedAt).getTime() : 0), 0) || 0);
  const parallelSaved = tasksSequentialSum - tasksTotal;
  
  // Build tooltip content
  const accent = POPOVER_ACCENT.time;
  const tooltipContent = (
    <div className="space-y-2 min-w-[320px] max-h-[80vh] overflow-y-auto">
      <PopoverTitle icon={CircleDot} label={t('header.timeBreakdown')} textClass={accent.text} />

      {/* Total */}
      <div className="flex justify-between items-baseline px-0.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{t('header.total')}</span>
        <span className="font-mono font-semibold text-lg" style={{ color: 'var(--text-1)' }}>{formattedTime}</span>
      </div>

      {/* Estimating Phase */}
      <Section>
        <StatRow
          strong
          accentClass={accent.subtext}
          label={t('header.estimatingPhase')}
          value={isEstimatingFinalized
            ? formatElapsedTime(estimatingTime, true)
            : estimatingActivity?.startedAt
              ? <LiveElapsedTime startedAt={jobTiming.startedAt} />
              : formatElapsedTime(estimatingTime, true)}
        />
        {jobTiming.phaseBreakdown && Object.keys(jobTiming.phaseBreakdown).length > 0 && (
          <div className="space-y-0.5 pl-1">
            {Object.entries(jobTiming.phaseBreakdown).map(([phase, ms]) => (
              <StatRow
                key={phase}
                labelColor="var(--text-3)"
                valueColor="var(--text-3)"
                label={<span className="capitalize">{phase}</span>}
                value={formatElapsedTime(ms, true)}
              />
            ))}
          </div>
        )}
        {!isEstimatingFinalized && estimatingActivity && (
          <div className="pl-1">
            <StatRow
              accentClass={accent.subtext}
              label={estimatingActivity.label}
              value={<LiveElapsedTime startedAt={estimatingActivity.startedAt} />}
            />
          </div>
        )}
      </Section>

      {/* Tasks */}
      {taskCount > 0 && (
        <Section>
          <StatRow
            strong
            label={t('header.tasksCount', { count: taskCount })}
            value={formatElapsedTime(tasksTotal, true)}
          />
          <div className="space-y-0.5 pl-1">
            {inProgressTasks?.map(task => (
              <StatRow
                key={task.id}
                title={task.name}
                accentClass={accent.subtext}
                label={task.name}
                value={task.timing?.startedAt ? <LiveElapsedTime startedAt={task.timing.startedAt} /> : '0s'}
              />
            ))}
            {completedTasks?.map(task => (
              <StatRow
                key={task.id}
                title={task.name}
                labelColor="var(--text-2)"
                valueColor="var(--text-2)"
                label={task.name}
                value={task.timing?.elapsedTime ? formatElapsedTime(task.timing.elapsedTime, true) : '0s'}
              />
            ))}
            {parallelSaved > 1000 && (
              <div className="space-y-0.5 pt-1 mt-1" style={{ borderTop: '1px solid var(--border-1)' }}>
                <StatRow
                  labelColor="var(--text-3)"
                  valueColor="var(--text-3)"
                  label={t('header.parallelTotal')}
                  value={formatElapsedTime(tasksSequentialSum, true)}
                />
                <StatRow
                  strong
                  labelColor="var(--status-done-fg)"
                  valueColor="var(--status-done-fg)"
                  label={t('header.parallelSaved')}
                  value={`-${formatElapsedTime(parallelSaved, true)}`}
                />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Paused Duration */}
      {jobTiming.totalPausedDuration > 0 && (
        <Section>
          <StatRow
            labelColor="var(--text-2)"
            valueColor="var(--text-2)"
            label={t('header.paused')}
            value={formatElapsedTime(jobTiming.totalPausedDuration, true)}
          />
        </Section>
      )}
    </div>
  );
  
  const sizeClass = compact
    ? 'h-5 min-h-5 max-h-5 px-1.5 gap-1'
    : 'h-7 min-h-7 max-h-7 px-2.5';
  const innerSize = compact ? 'h-5 gap-1' : 'h-7 gap-1.5';
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <Tooltip content={tooltipContent} placement="bottom" surface={accent.surface} borderColor={accent.border}>
      <div
        className={cn(sizeClass, 'cursor-pointer')}
        style={{
          background: accent.surface,
          border: `1px solid ${accent.border}`,
          borderRadius: 'var(--r-sm)',
        }}
      >
        <div className={cn('flex items-center justify-center', innerSize, accent.text)}>
          <CircleDot className={iconSize} />
          <span className={cn(textSize, 'font-medium leading-none')}>
            {formattedTime}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

interface TokenUsageBadgeProps {
  jobId?: string;
  tokenUsage?: TaskTokenUsage;
  /** Per-model job usage — enables precise USD/credit cost (priced per model). */
  tokenUsageByModel?: TokenUsageByModel;
  estimatingTokenUsage?: TaskTokenUsage;
  phaseTokenUsages?: PhaseTokenUsage[];
  completedTasks?: Array<{
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  }>;
  inProgressTasks?: Array<{
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  }>;
  /**
   * Compact mode (h-5, text-[10px]) for dense inline contexts such as the
   * Job-tab dropdown rows. Tooltip content is unchanged.
   */
  compact?: boolean;
}

/**
 * TokenUsageBadge - Display token usage with billing-centric display
 *
 * Architecture: docs/architecture/13-token-usage-tracking.md
 *
 * DESIGN PRINCIPLE: Show billable (cost-weighted) input tokens, not raw volume.
 *   - billableInput = new×1.0 + creation×1.25 + read×0.1
 *   - Output is always 1:1 (not cacheable)
 *
 * Badge: "132K in · 4.9K out" — billable input, actual cost
 * Tooltip sections:
 *   1. Billing — billable input + output (what you pay)
 *   2. Cache Efficiency — volume, hit rate, savings (when cache active)
 *   3. Phase Breakdown — planning + individual tasks
 */
export function TokenUsageBadge({ jobId, tokenUsage, tokenUsageByModel, estimatingTokenUsage, phaseTokenUsages, completedTasks, inProgressTasks, compact = false }: TokenUsageBadgeProps) {
  const { t } = useTranslation('kanban');
  const canViewUsd = useStore(selectCanViewUsdCost);
  // Precise cost from per-model usage (priced per model). Credits always shown;
  // USD gated to operators via `selectCanViewUsdCost`.
  const costUsd = costUsdFromByModel(tokenUsageByModel);
  const tasksUsage = sumTokenUsages([
    ...(completedTasks?.map(t => t.tokenUsage) || []),
    ...(inProgressTasks?.map(t => t.tokenUsage) || []),
  ]);

  if (!jobId && !tokenUsage && !tasksUsage) {
    return null;
  }

  const tasks = getTokenUsageMetrics(tasksUsage);
  const estimatingMetrics = estimatingTokenUsage ? getTokenUsageMetrics(estimatingTokenUsage) : null;

  // Effective total: use the LARGER of job-level snapshot vs (estimating + tasks).
  // Job-level tokenUsage can be stale (broadcast snapshot) while task-level is more current.
  const partsSum = sumTokenUsages([estimatingTokenUsage, tasksUsage]);
  const partsMetrics = getTokenUsageMetrics(partsSum);
  const jobMetrics = getTokenUsageMetrics(tokenUsage);
  const effective = (partsSum && partsMetrics.billableInputTokens >= jobMetrics.billableInputTokens)
    ? partsMetrics
    : jobMetrics;

  // Planning phase billable input (prefer direct tracking, fallback to subtraction)
  const estimatingInput = estimatingMetrics
    ? estimatingMetrics.billableInputTokens
    : (tokenUsage ? Math.max(0, effective.billableInputTokens - tasks.billableInputTokens) : 0);
  const estimatingOutput = estimatingMetrics
    ? estimatingMetrics.outputTokens
    : (tokenUsage ? Math.max(0, effective.outputTokens - tasks.outputTokens) : 0);

  const hasTokenData = effective.billableInputTokens > 0 || effective.outputTokens > 0;
  const taskCount = (completedTasks?.length || 0) + (inProgressTasks?.length || 0);

  const accent = POPOVER_ACCENT.token;
  const tooltipContent = (
    <div className="space-y-2 w-[480px] max-h-[80vh] overflow-y-auto">
      <PopoverTitle icon={Zap} label={t('header.tokenUsage')} textClass={accent.text} />

      {hasTokenData ? (
        <>
          {/* Billing (input + output) */}
          <Section>
            <StatRow
              strong
              label={<>{t('tokenStats.input')} <span className="font-normal italic" style={{ color: 'var(--text-3)' }}>{t('tokenStats.inputDescription')}</span></>}
              value={formatTokenCount(effective.billableInputTokens)}
            />
            <StatRow
              strong
              label={<>{t('tokenStats.output')} <span className="font-normal italic" style={{ color: 'var(--text-3)' }}>{t('tokenStats.outputDescription')}</span></>}
              value={formatTokenCount(effective.outputTokens)}
            />
          </Section>

          {/* Cost & Credit — precise per-model cost. Credits always; USD gated. */}
          {costUsd !== undefined && costUsd > 0 && (
            <Section>
              <StatRow
                strong
                label={t('tokenStats.creditsConsumed', 'Credits used')}
                value={formatCredits(creditsFromUsd(costUsd))}
              />
              {canViewUsd && (
                <StatRow
                  labelColor="var(--text-3)"
                  valueColor="var(--text-3)"
                  label={t('tokenStats.estimatedCost', 'Cost (USD)')}
                  value={formatUsd(costUsd)}
                />
              )}
            </Section>
          )}

          {/* Cache Efficiency (only when cache active) */}
          {effective.hasCache && (
            <Section>
              <CardLabel>{t('tokenStats.cacheEfficiency')}</CardLabel>
              <StatRow labelColor="var(--text-3)" valueColor="var(--text-3)" label={t('tokenStats.totalProcessed')} value={formatTokenCount(effective.totalInputProcessed)} />
              <StatRow labelColor="var(--text-3)" valueColor="var(--text-3)" label={t('tokenStats.newCacheMiss')} value={formatTokenCount(effective.newInputTokens)} />
              {effective.cacheReadTokens > 0 && (
                <StatRow labelColor="var(--text-3)" valueColor="var(--text-3)" label={t('tokenStats.cacheHit')} value={formatTokenCount(effective.cacheReadTokens)} />
              )}
              {effective.cacheCreationTokens > 0 && (
                <StatRow labelColor="var(--text-3)" valueColor="var(--text-3)" label={t('tokenStats.cacheCreated')} value={formatTokenCount(effective.cacheCreationTokens)} />
              )}
              {effective.cacheHitRate > 0 && (
                <StatRow strong labelColor="var(--status-done-fg)" valueColor="var(--status-done-fg)" label={t('tokenStats.cacheHitRate')} value={formatPercent(effective.cacheHitRate)} />
              )}
              {effective.inputSavingsPercent > 0 && (
                <StatRow strong labelColor="var(--status-done-fg)" valueColor="var(--status-done-fg)" label={t('tokenStats.savings')} value={`~${formatPercent(effective.inputSavingsPercent)}`} />
              )}
            </Section>
          )}

          {/* Phase Breakdown */}
          {(tokenUsage || taskCount > 0 || (phaseTokenUsages && phaseTokenUsages.length > 0)) && (
            <Section>
              <CardLabel className={accent.subtext}>{t('tokenStats.byPhase')}</CardLabel>

              {phaseTokenUsages && phaseTokenUsages.length > 0 ? (
                <div className="space-y-0.5">
                  {phaseTokenUsages.map((p) => {
                    const m = getTokenUsageMetrics(p.tokenUsage);
                    return (m.billableInputTokens > 0 || m.outputTokens > 0) ? (
                      <StatRow
                        key={p.phase}
                        title={p.label || p.phase}
                        labelColor="var(--text-2)"
                        valueColor="var(--text-3)"
                        label={<span className="capitalize">{p.label || p.phase}</span>}
                        value={`${formatTokenCount(m.billableInputTokens)} in · ${formatTokenCount(m.outputTokens)} out`}
                      />
                    ) : null;
                  })}
                  {(() => {
                    const phaseSum = sumTokenUsages(phaseTokenUsages.map(p => p.tokenUsage));
                    const phaseSumMetrics = getTokenUsageMetrics(phaseSum);
                    const overheadIn = Math.max(0, effective.billableInputTokens - phaseSumMetrics.billableInputTokens);
                    const overheadOut = Math.max(0, effective.outputTokens - phaseSumMetrics.outputTokens);
                    return (overheadIn > 100 || overheadOut > 100) ? (
                      <div className="opacity-60">
                        <StatRow
                          labelColor="var(--text-3)"
                          valueColor="var(--text-3)"
                          label={<span className="italic">{t('tokenStats.overhead', 'Overhead')}</span>}
                          value={`${formatTokenCount(overheadIn)} in · ${formatTokenCount(overheadOut)} out`}
                        />
                      </div>
                    ) : null;
                  })()}
                </div>
              ) : (
                <div className="space-y-1">
                  {tokenUsage && (
                    <StatRow
                      strong
                      labelColor="var(--text-2)"
                      valueColor="var(--text-2)"
                      label={t('tokenStats.estimating')}
                      value={`${formatTokenCount(estimatingInput)} in · ${formatTokenCount(estimatingOutput)} out`}
                    />
                  )}
                  {taskCount > 0 && (
                    <div className="space-y-0.5">
                      <StatRow
                        strong
                        labelColor="var(--text-2)"
                        valueColor="var(--text-2)"
                        label={t('header.tasksCount', { count: taskCount })}
                        value={`${formatTokenCount(tasks.billableInputTokens)} in · ${formatTokenCount(tasks.outputTokens)} out`}
                      />
                      <div className="space-y-0.5 pl-1">
                        {inProgressTasks?.filter(t => t.tokenUsage).map(task => {
                          const m = getTokenUsageMetrics(task.tokenUsage!);
                          return (m.billableInputTokens > 0 || m.outputTokens > 0) ? (
                            <StatRow
                              key={task.id}
                              title={task.name}
                              labelColor="var(--text-3)"
                              valueColor="var(--text-3)"
                              label={task.name}
                              value={`${formatTokenCount(m.billableInputTokens)} / ${formatTokenCount(m.outputTokens)}`}
                            />
                          ) : null;
                        })}
                        {completedTasks?.map((task) => {
                          const m = task.tokenUsage ? getTokenUsageMetrics(task.tokenUsage) : null;
                          return (
                            <StatRow
                              key={task.id}
                              title={task.name}
                              labelColor="var(--text-3)"
                              valueColor="var(--text-3)"
                              label={task.name}
                              value={m ? `${formatTokenCount(m.billableInputTokens)} / ${formatTokenCount(m.outputTokens)}` : '0'}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}
        </>
      ) : (
        <div className="text-sm italic" style={{ color: 'var(--text-3)' }}>
          {t('tokenStats.noTokenData')}
        </div>
      )}
    </div>
  );

  const sizeClass = compact
    ? 'h-5 min-h-5 max-h-5 px-1.5 gap-1'
    : 'h-7 min-h-7 max-h-7 px-2.5';
  const innerSize = compact ? 'h-5 gap-1' : 'h-7 gap-1.5';
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <Tooltip content={tooltipContent} placement="bottom" surface={accent.surface} borderColor={accent.border}>
      <div
        className={cn(sizeClass, 'cursor-pointer')}
        style={{
          background: accent.surface,
          border: `1px solid ${accent.border}`,
          borderRadius: 'var(--r-sm)',
        }}
      >
        <div className={cn('flex items-center justify-center', innerSize, accent.text)}>
          <Zap className={iconSize} />
          <span className={cn(textSize, 'font-mono font-medium leading-none whitespace-nowrap')}>
            {hasTokenData
              ? `${formatTokenCount(effective.billableInputTokens)}↑·${formatTokenCount(effective.outputTokens)}↓`
              : '0'}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

interface GaugesGroupProps {
  recursionCount?: number;
  recursionLimit?: number;
  /** Active worker's task name (truncated, for parallel mode identification) */
  recursionTaskName?: string;
}

/**
 * Truncate text to maxLen characters with ellipsis
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/**
 * GaugesGroup - Recursion limit gauge with optional worker task name
 */
export function GaugesGroup({
  recursionCount = 0,
  recursionLimit = 50,
  recursionTaskName,
}: GaugesGroupProps) {
  return (
    <>
      {/* Recursion Limit Gauge */}
      <div
        className="relative h-7 min-h-7 max-h-7 px-3 min-w-[120px] overflow-hidden"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          borderRadius: 'var(--r-sm)',
        }}
      >
        <div className="absolute inset-0" style={{ borderRadius: 'var(--r-sm)' }}>
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              background: 'var(--violet-500)',
              opacity: 0.35,
              width: `${recursionLimit
                ? Math.min(((recursionCount || 0) / recursionLimit) * 100, 100)
                : 0}%`,
            }}
          />
        </div>
        <div className="relative z-10 flex items-center justify-center h-7 gap-1.5">
          {recursionTaskName && (
            <span
              className="text-[10px] font-medium leading-none truncate max-w-[90px] opacity-80"
              style={{ color: 'var(--violet-500)' }}
              title={recursionTaskName}
            >
              {truncateText(recursionTaskName, 13)}
            </span>
          )}
          <span
            className="text-xs font-medium leading-none whitespace-nowrap"
            style={{ color: 'var(--violet-500)' }}
          >
            {recursionCount}/{recursionLimit}
          </span>
        </div>
      </div>
    </>
  );
}
