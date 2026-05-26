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

import { memo } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import type {
  ChatStatusLine,
  PendingCardSnapshot,
  RefineImpactMetadata,
} from '@ant/shared';
import { TurnCardShell } from './cards/TurnCardShell';

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

export const RefineImpactCard = memo(function RefineImpactCard({ line, pending: _pending }: RefineImpactCardProps) {
  const meta = isRefineImpactMetadata(line.metadata) ? line.metadata : undefined;

  if (!meta) {
    return null;
  }

  const sections = meta.updatedSections ?? [];
  const affected = meta.affected ?? [];
  const unscannable = meta.unscannableTaskIds ?? [];
  const sourceLabel = (meta.diffSources ?? []).join(' + ') || 'no diff source';

  return (
    <TurnCardShell accent="warning" hoverLift={false}>
      <div
        className="flex flex-col gap-2 px-3 py-2.5"
        style={{
          background: 'oklch(from var(--amber-500) 96% 0.06 85 / 0.45)',
        }}
      >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--amber-500)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--status-progress-fg)' }}>
          {meta.updatedDoc} refined — {affected.length} downstream design task(s) may be stale
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 pl-6">
        {sections.length > 0 ? (
          sections.map((section, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px]"
              style={{
                background: 'var(--status-progress-bg)',
                color: 'var(--status-progress-fg)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {section}
            </span>
          ))
        ) : (
          <span className="text-[11px] italic" style={{ color: 'var(--text-3)' }}>
            no identifiable sections in diff
          </span>
        )}
        <span className="text-[10px] self-center" style={{ color: 'var(--text-3)' }}>
          ({sourceLabel})
        </span>
      </div>

      {affected.length > 0 && (
        <div className="flex flex-col gap-1 pl-6">
          {affected.map(item => (
            <div
              key={item.taskId}
              className="flex items-start gap-1.5 text-[11px]"
              style={{ color: 'var(--status-progress-fg)' }}
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
                    className="text-[10px] px-1 py-0.5 rounded"
                    style={{
                      background: 'oklch(from var(--amber-500) 70% 0.10 85 / 0.30)',
                      fontFamily: 'var(--font-mono)',
                    }}
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
          className="flex items-center gap-1.5 pl-6 pt-1 mt-1 text-[10.5px]"
          style={{ borderTop: '1px solid var(--border-1)', color: 'var(--text-3)' }}
        >
          <AlertTriangle className="w-3 h-3 flex-shrink-0 opacity-60" />
          <span>
            {unscannable.length} task(s) built without {meta.updatedDoc} as ref —
            sync cannot speak for them.
          </span>
        </div>
      )}
      </div>
    </TurnCardShell>
  );
});
