/**
 * RefineImpactCard - Cross-document sync alert for the operator.
 *
 * Emitted by the rev-plan completion hook (F3). Surfaces:
 *   - which PRD/GDD sections were rewritten,
 *   - which design tasks cite those sections (and are now stale),
 *   - which design tasks the sync canNOT speak about because the
 *     authoring checkpoint did not have the plan doc as `role='ref'`
 *     (`unscannableTaskIds`).
 *
 * The card is informational — clicking through is left to a future
 * "rerun stale tasks" affordance. The emoji + colour treatment is
 * deliberately attention-grabbing because skipping this card means
 * downstream design work risks drifting from the refined plan doc.
 */

import { AlertTriangle, FileText } from 'lucide-react';
import type {
  ChatStatusLine,
  PendingCardSnapshot,
  RefineImpactMetadata,
} from '@ant/shared';

interface RefineImpactCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
}

function isRefineImpactMetadata(
  raw: unknown,
): raw is RefineImpactMetadata {
  if (!raw || typeof raw !== 'object') return false;
  const updatedDoc = (raw as { updatedDoc?: unknown }).updatedDoc;
  return updatedDoc === 'prd.md' || updatedDoc === 'gdd.md';
}

export function RefineImpactCard({ line, pending: _pending }: RefineImpactCardProps) {
  const meta = isRefineImpactMetadata(line.metadata) ? line.metadata : undefined;

  if (!meta) {
    return null;
  }

  const sections = meta.updatedSections ?? [];
  const affected = meta.affected ?? [];
  const unscannable = meta.unscannableTaskIds ?? [];
  const sourceLabel = (meta.diffSources ?? []).join(' + ') || 'no diff source';

  return (
    <div
      className="flex flex-col gap-2 px-3 py-2.5 rounded-lg
                 bg-amber-50/60 dark:bg-amber-900/15 border border-amber-200/60 dark:border-amber-800/40"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
          {meta.updatedDoc} refined — {affected.length} downstream design task(s) may be stale
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 pl-6">
        {sections.length > 0 ? (
          sections.map((section, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-1.5 py-0.5 rounded
                         bg-amber-100/80 dark:bg-amber-800/30 text-[11px]
                         font-mono text-amber-900 dark:text-amber-100"
            >
              {section}
            </span>
          ))
        ) : (
          <span className="text-[11px] italic text-amber-700/80 dark:text-amber-400/80">
            no identifiable sections in diff
          </span>
        )}
        <span className="text-[10px] text-amber-700/60 dark:text-amber-400/60 self-center">
          ({sourceLabel})
        </span>
      </div>

      {affected.length > 0 && (
        <div className="flex flex-col gap-1 pl-6">
          {affected.map(item => (
            <div
              key={item.taskId}
              className="flex items-start gap-1.5 text-[11px]
                         text-amber-800/90 dark:text-amber-200/90"
            >
              <FileText className="w-3 h-3 flex-shrink-0 mt-0.5 opacity-70" />
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="font-medium">{item.taskName}</span>
                {item.targetFile && (
                  <span className="font-mono opacity-70">{item.targetFile}</span>
                )}
                <span className="opacity-70">cites</span>
                {item.matchedSections.map((m, idx) => (
                  <span
                    key={idx}
                    className="font-mono text-[10px] px-1 py-0.5 rounded
                               bg-amber-200/40 dark:bg-amber-800/40"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {unscannable.length > 0 && (
        <div
          className="flex items-center gap-1.5 pl-6 pt-1 mt-1
                     border-t border-amber-300/40 dark:border-amber-700/40
                     text-[10.5px] text-amber-700/80 dark:text-amber-400/80"
        >
          <AlertTriangle className="w-3 h-3 flex-shrink-0 opacity-60" />
          <span>
            {unscannable.length} task(s) built without {meta.updatedDoc} as ref —
            sync cannot speak for them.
          </span>
        </div>
      )}
    </div>
  );
}
