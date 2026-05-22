import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { FeatureBreadcrumbLine } from '@ant/shared';
import { groupBreadcrumbs, type RenderRow } from './groupBreadcrumbs';

/**
 * Breadcrumb timeline view — feature.jsonl breadcrumbs grouped by
 * `(local-date, turnId)` so a single user turn's BCs render under one
 * bracket. Read-only snapshot fetched from the
 * `/api/.../breadcrumbs` endpoint via the `featureLog` slice.
 *
 * Refresh policy: `chatSseHandler` re-issues `loadFeatureBreadcrumbs`
 * on `job_status=completed|failed`. We do not wire a BC-append SSE
 * push (`appendFeatureBreadcrumb` slice action remains a stub).
 *
 * Each breadcrumb represents a completed piece of work:
 * - scope (initial_creation / modification / refactor) → dot color
 * - summary (1–2 sentence noun-form, ≤200 chars) → multi-line block
 * - anchors (mutually exclusive by touched-tier; see
 *   `packages/ant-cli/src/core/context/breadcrumb.ts:152`) → category rows
 * - stats (touched / created / modified / deleted) → footer chips
 *
 * NOTE: `traceRangeRef` is intentionally not consumed yet — wiring the
 * chat-scroll ref + ts→index map is non-trivial and out of scope for
 * the timeline redesign PR. See plan §2.2 (traceRangeRef).
 * TODO(traceRangeRef): chat scroll ref
 */
export function BreadcrumbTimeline() {
  const { t } = useTranslation('chat');
  const breadcrumbs = useStore(s => s.breadcrumbs);
  const status = useStore(s => s.breadcrumbsStatus);
  const error = useStore(s => s.breadcrumbsError);

  const ordered = useMemo(() => {
    const copy = [...breadcrumbs];
    copy.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return copy;
  }, [breadcrumbs]);

  const rows = useMemo(() => groupBreadcrumbs(ordered), [ordered]);

  if (status === 'loading' && ordered.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-[color:var(--text-3)]">
        {t('breadcrumb.loading', { defaultValue: 'Loading timeline…' })}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-4 text-sm text-red-600">
        {t('breadcrumb.loadError', { defaultValue: 'Failed to load timeline.' })}
        {error ? <div className="mt-1 text-xs text-[color:var(--text-3)]">{error}</div> : null}
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="text-3xl mb-3 opacity-60">🧭</div>
        <p className="text-sm text-[color:var(--text-3)]">
          {t('breadcrumb.empty', {
            defaultValue: 'No breadcrumbs yet. Completed tasks will appear here as navigation anchors.',
          })}
        </p>
      </div>
    );
  }

  // Soft refetch indicator — the slice hits `loading` mid-stream when
  // `job_status` completes and the SSE handler re-issues the loader.
  // We already have rendered rows, so a top-right dot is less jarring
  // than swapping back to the loading state.
  const refreshing = status === 'loading' && ordered.length > 0;

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto p-3">
      {refreshing && (
        <span
          className="absolute top-2 right-3 inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-status-pulse"
          aria-hidden="true"
        />
      )}
      <div className="space-y-3">
        {rows.map((row, idx) => {
          if (row.kind === 'date') {
            return <DateSeparator key={`d-${row.dateKey}-${idx}`} row={row} />;
          }
          return (
            <TurnGroup
              key={`t-${row.turnId}-${row.dateKey}-${idx}`}
              row={row}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DateSeparator — inline divider between local-date buckets.
// Not sticky (kept as plain inline divider to avoid layout coupling
// with parent overflow containers; see plan §2.2).
// ─────────────────────────────────────────────────────────────────────

function DateSeparator({ row }: { row: Extract<RenderRow, { kind: 'date' }> }) {
  const { t } = useTranslation('chat');
  const label = useMemo(() => {
    if (row.bucket === 'today') {
      return t('breadcrumb.date.today', { defaultValue: 'Today' });
    }
    if (row.bucket === 'yesterday') {
      return t('breadcrumb.date.yesterday', { defaultValue: 'Yesterday' });
    }
    return formatDateOnly(row.dateKey);
  }, [row.bucket, row.dateKey, t]);

  return (
    <div
      className="flex items-center gap-3 pt-2 first:pt-0"
      role="separator"
      aria-label={label}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-3)]">
        {label}
      </span>
      <span className="flex-1 h-px bg-[color:var(--bg-surface-3)]/60" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TurnGroup — bracket-bound mini-group for one (date, turnId) slice.
// A single-BC turn renders without the bracket so the timeline doesn't
// pile up visual noise on common cases.
// ─────────────────────────────────────────────────────────────────────

function TurnGroup({ row }: { row: Extract<RenderRow, { kind: 'turn' }> }) {
  const { t } = useTranslation('chat');
  const isMulti = row.items.length > 1;
  const headerTime = useMemo(() => formatTime(row.headerTs), [row.headerTs]);

  if (!isMulti) {
    // Single-BC turn — render the item directly (no bracket).
    return <BreadcrumbItem line={row.items[0]!} />;
  }

  return (
    <section className="relative pl-4 border-l-2 border-[color:var(--border-1)]">
      <header className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <time className="text-xs text-[color:var(--text-3)]">{headerTime}</time>
          <span className="text-[11px] text-[color:var(--text-3)]">
            {t('breadcrumb.group.tasks', {
              count: row.items.length,
              defaultValue: '{{count}} tasks',
            })}
          </span>
        </div>
        {row.mode && (row.mode === 'generate' || row.mode === 'refactor') && (
          <ModeBadge mode={row.mode} />
        )}
      </header>
      <div className="space-y-3">
        {row.items.map((bc, idx) => (
          <BreadcrumbItem
            key={`${bc.jobId}-${bc.ts}-${idx}`}
            line={bc}
            inGroup
          />
        ))}
      </div>
    </section>
  );
}

function ModeBadge({ mode }: { mode: 'generate' | 'refactor' }) {
  const palette =
    mode === 'refactor'
      ? 'bg-purple-50 text-purple-700 border-purple-200'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono ${palette}`}
    >
      {mode}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BreadcrumbItem — one BC line with multi-line summary + anchor rows
// and stats footer.
// ─────────────────────────────────────────────────────────────────────

function BreadcrumbItem({
  line,
  inGroup = false,
}: {
  line: FeatureBreadcrumbLine;
  inGroup?: boolean;
}) {
  const { t } = useTranslation('chat');
  const dot = scopeDot(line.scope);
  const timeLabel = useMemo(() => formatTime(line.ts), [line.ts]);

  const anchors = line.anchors ?? {};
  const stats = line.stats ?? {};
  const hasSpecs = !!anchors.specs && anchors.specs.length > 0;
  const hasPaths = !!anchors.paths && anchors.paths.length > 0;
  const hasFiles = !!anchors.files && anchors.files.length > 0;

  return (
    <article className={`relative ${inGroup ? '' : 'pl-4 border-l-2 border-[color:var(--border-1)]'}`}>
      <span
        className={`absolute top-1 -left-[5px] flex items-center justify-center w-2 h-2 rounded-full ring-2 ring-white ${dot}`}
        aria-hidden="true"
      />
      <header className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[11px] font-medium text-[color:var(--text-3)] uppercase tracking-wide">
          {t(`breadcrumb.scope.${line.scope}`, { defaultValue: line.scope })}
        </span>
        <time className="text-[11px] text-[color:var(--text-4)]">{timeLabel}</time>
      </header>
      <SummaryBlock summary={line.summary} />

      {hasSpecs && (
        <AnchorRow
          label={t('breadcrumb.anchors.specs', { defaultValue: 'Specs' })}
          items={anchors.specs!}
          kind="spec"
        />
      )}
      {hasPaths && (
        <AnchorRow
          label={t('breadcrumb.anchors.paths', { defaultValue: 'Paths' })}
          items={anchors.paths!}
          kind="path"
        />
      )}
      {hasFiles && (
        <AnchorRow
          label={t('breadcrumb.anchors.files', { defaultValue: 'Files' })}
          items={anchors.files!}
          kind="file"
          collapsible
        />
      )}

      {(stats.created || stats.modified || stats.deleted || stats.touched) && (
        <footer className="mt-2 flex flex-wrap gap-3 text-[11px] text-[color:var(--text-3)]">
          {stats.created ? <span>+{stats.created}</span> : null}
          {stats.modified ? <span>~{stats.modified}</span> : null}
          {stats.deleted ? <span>-{stats.deleted}</span> : null}
          {stats.touched ? <span>Σ {stats.touched}</span> : null}
        </footer>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SummaryBlock — multi-line summary with line-clamp-4 + expand/collapse.
// ─────────────────────────────────────────────────────────────────────

function SummaryBlock({ summary }: { summary: string }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  // Conservative heuristic: only show toggle if the text is long enough
  // that line-clamp-4 might actually clip. Avoids a useless toggle on
  // short summaries (the BE caps at ~200 chars; ~4 lines fit ~240–280
  // chars at typical chat panel widths).
  const mightClip = summary.length > 220 || summary.split('\n').length > 4;

  return (
    <div className="text-sm text-[color:var(--text-1)]">
      <p
        className={`whitespace-pre-line break-words ${expanded || !mightClip ? '' : 'line-clamp-4'}`}
      >
        {summary}
      </p>
      {mightClip && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[11px] font-medium text-blue-600 hover:text-blue-700"
        >
          {expanded
            ? t('breadcrumb.summary.collapse', { defaultValue: 'Collapse' })
            : t('breadcrumb.summary.expand', { defaultValue: 'Show more' })}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AnchorRow + AnchorChipList — categorized anchor wrap.
// ─────────────────────────────────────────────────────────────────────

const FILES_PREVIEW_THRESHOLD = 7;
const FILES_PREVIEW_VISIBLE = 6;

function AnchorRow({
  label,
  items,
  kind,
  collapsible = false,
}: {
  label: string;
  items: string[];
  kind: 'spec' | 'path' | 'file';
  collapsible?: boolean;
}) {
  return (
    <div className="mt-2 flex items-start gap-2">
      <span className="shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-3)]">
        {label}
      </span>
      <AnchorChipList items={items} kind={kind} collapsible={collapsible} />
    </div>
  );
}

function AnchorChipList({
  items,
  kind,
  collapsible,
}: {
  items: string[];
  kind: 'spec' | 'path' | 'file';
  collapsible: boolean;
}) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  // Only files have a wide enough cap (≤10 per BE SSOT, see
  // packages/ant-shared/src/session-log.ts:128) to warrant a "+N more"
  // toggle; specs/paths are bounded so tightly that always-expanded is
  // less noise.
  const shouldCollapse =
    collapsible && !expanded && items.length > FILES_PREVIEW_THRESHOLD;
  const visible = shouldCollapse
    ? items.slice(0, FILES_PREVIEW_VISIBLE)
    : items;
  const hidden = items.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map(label => (
        <AnchorChip key={`${kind}-${label}`} label={label} kind={kind} />
      ))}
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-mono bg-[color:var(--bg-canvas)]/60 text-[color:var(--text-3)] border-[color:var(--border-1)] hover:bg-[color:var(--bg-hover)]"
        >
          {t('breadcrumb.anchors.moreFiles', {
            count: hidden,
            defaultValue: '+{{count}} more',
          })}
        </button>
      )}
    </div>
  );
}

function AnchorChip({ label, kind }: { label: string; kind: 'spec' | 'path' | 'file' }) {
  const palette: Record<typeof kind, string> = {
    spec: 'bg-purple-50 text-purple-700 border-purple-200',
    path: 'bg-blue-50 text-blue-700 border-blue-200',
    file: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-mono truncate max-w-[260px] ${palette[kind]}`}
      title={label}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function scopeDot(scope: FeatureBreadcrumbLine['scope']): string {
  switch (scope) {
    case 'initial_creation':
      return 'bg-aurora-emerald-500';
    case 'refactor':
      return 'bg-aurora-violet-500';
    case 'modification':
    default:
      return 'bg-aurora-violet-400';
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

/** `YYYY-MM-DD` → locale `MMM d` (fallback for `older` bucket). */
function formatDateOnly(dateKey: string): string {
  // Construct at noon local to avoid tz edge cases producing a different
  // calendar day for the same `YYYY-MM-DD` input.
  const [y, m, d] = dateKey.split('-').map(n => Number(n));
  if (!y || !m || !d) return dateKey;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (Number.isNaN(date.getTime())) return dateKey;
  try {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateKey;
  }
}
