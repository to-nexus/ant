import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { FeatureBreadcrumbLine } from '@ant/shared';

/**
 * Breadcrumb timeline view — vertical list of work navigation anchors
 * recorded in feature.jsonl. Read-only snapshot fetched from the
 * `/api/.../breadcrumbs` endpoint via the `featureLog` slice.
 *
 * Each breadcrumb represents a completed piece of work:
 * - scope (initial_creation / modification / refactor)
 * - summary (single-line noun phrase)
 * - anchors (bubble-up: specs / paths / files)
 * - stats (touched / created / modified / deleted)
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

  if (status === 'loading' && ordered.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400">
        {t('breadcrumb.loading', { defaultValue: 'Loading timeline…' })}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-4 text-sm text-red-600 dark:text-red-400">
        {t('breadcrumb.loadError', { defaultValue: 'Failed to load timeline.' })}
        {error ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{error}</div> : null}
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="text-3xl mb-3 opacity-60">🧭</div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('breadcrumb.empty', {
            defaultValue: 'No breadcrumbs yet. Completed tasks will appear here as navigation anchors.',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-3">
        {ordered.map((bc, idx) => (
          <BreadcrumbItem key={`${bc.jobId}-${bc.ts}-${idx}`} line={bc} />
        ))}
      </ol>
    </div>
  );
}

function BreadcrumbItem({ line }: { line: FeatureBreadcrumbLine }) {
  const { t } = useTranslation('chat');
  const dot = useMemo(() => scopeDot(line.scope), [line.scope]);
  const timeLabel = useMemo(() => formatTs(line.ts), [line.ts]);

  const anchors = line.anchors ?? {};
  const stats = line.stats ?? {};
  const hasSpecs = anchors.specs && anchors.specs.length > 0;
  const hasPaths = anchors.paths && anchors.paths.length > 0;
  const hasFiles = anchors.files && anchors.files.length > 0;

  return (
    <li className="mb-5 ml-4">
      <span
        className={`absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full ${dot}`}
        aria-hidden="true"
      />
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {t(`breadcrumb.scope.${line.scope}`, { defaultValue: line.scope })}
        </span>
        <time className="text-xs text-gray-400 dark:text-gray-500">{timeLabel}</time>
      </div>
      <p className="text-sm text-gray-800 dark:text-gray-100 break-words">{line.summary}</p>

      {(hasSpecs || hasPaths || hasFiles) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {hasSpecs &&
            anchors.specs!.map(s => (
              <AnchorChip key={`spec-${s}`} label={s} kind="spec" />
            ))}
          {hasPaths &&
            anchors.paths!.map(p => (
              <AnchorChip key={`path-${p}`} label={p} kind="path" />
            ))}
          {hasFiles &&
            anchors.files!.map(f => (
              <AnchorChip key={`file-${f}`} label={f} kind="file" />
            ))}
        </div>
      )}

      {(stats.created || stats.modified || stats.deleted || stats.touched) && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
          {stats.created ? <span>+{stats.created}</span> : null}
          {stats.modified ? <span>~{stats.modified}</span> : null}
          {stats.deleted ? <span>-{stats.deleted}</span> : null}
          {stats.touched ? <span>Σ {stats.touched}</span> : null}
        </div>
      )}
    </li>
  );
}

function AnchorChip({ label, kind }: { label: string; kind: 'spec' | 'path' | 'file' }) {
  const palette: Record<typeof kind, string> = {
    spec: 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/50',
    path: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50',
    file: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50',
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

function scopeDot(scope: FeatureBreadcrumbLine['scope']): string {
  switch (scope) {
    case 'initial_creation':
      return 'bg-emerald-500';
    case 'refactor':
      return 'bg-purple-500';
    case 'modification':
    default:
      return 'bg-blue-500';
  }
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch {
    return ts;
  }
}
