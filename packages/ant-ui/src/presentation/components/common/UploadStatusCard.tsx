/**
 * Bottom-centre upload card + refusal notice, portalled to <body>.
 *
 * The markup is the artifacts panel's, lifted verbatim so the screen that
 * already had it keeps its exact surface while the definition screens gain one
 * instead of inventing a second vocabulary for the same event.
 */

import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Upload, X } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import type { UploadStatus } from '@/application/hooks/ui/useUploadStatus';

export interface UploadStatusCardProps {
  status: UploadStatus | null;
  notice: string | null;
  /** X button — dismiss when finished, abort while in flight. */
  onCancel: () => void;
  onDismiss: () => void;
  onDismissNotice: () => void;
}

export function UploadStatusCard({
  status,
  notice,
  onCancel,
  onDismiss,
  onDismissNotice,
}: UploadStatusCardProps) {
  const { t } = useTranslation('artifacts');

  if (!status && !notice) return null;

  // A completed card is tinted by its tone: `warning` means the upload landed
  // but not everything in it did, which must not read as an unqualified green.
  const indeterminate = !!status && !status.completed && status.total === 0;
  const accent =
    status?.tone === 'warning' ? 'var(--status-progress-fg)' : 'var(--status-done-fg)';

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-80 flex flex-col gap-2">
      {status && (
        <div
          className={cn(
            'rounded-xl border shadow-lg p-3 space-y-2 cursor-pointer transition-colors',
            'bg-[color:var(--bg-surface)]',
            !status.completed && 'border-[color:var(--violet-500)]',
          )}
          style={status.completed ? { borderColor: accent } : undefined}
          onClick={status.completed ? onDismiss : undefined}
        >
          <div className="flex items-center justify-between">
            <span
              className="flex items-center gap-2 text-xs font-medium truncate"
              style={{ color: status.completed ? accent : 'var(--violet-700)' }}
            >
              {status.completed ? (
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
              ) : (
                <Upload className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              {status.completed
                ? (status.summary ?? t('upload.complete', { count: status.fileCount }))
                : t('upload.uploading', {
                    count: status.fileCount,
                    dir: status.targetDir,
                  })}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="flex-shrink-0 ml-2 p-1 rounded-md hover:bg-[color:var(--bg-active)] text-[color:var(--text-4)] hover:text-[color:var(--text-3)] transition-colors"
              title={status.completed ? t('upload.dismiss') : t('upload.cancel')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div
            className="w-full h-2 rounded-full overflow-hidden"
            style={{
              background: status.completed
                ? `oklch(from ${accent} l c h / 0.15)`
                : 'var(--violet-100)',
            }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                // A lane with no byte reporting (the definition multipart lanes
                // ride `fetch`) would otherwise sit at a flat 0% and read as
                // stuck. Say "working, ratio unknown" instead of lying.
                ...(indeterminate
                  ? { width: '40%', animation: 'upload-indeterminate 1.1s ease-in-out infinite' }
                  : {
                      width:
                        status.total > 0
                          ? `${Math.round((status.loaded / status.total) * 100)}%`
                          : status.completed
                            ? '100%'
                            : '0%',
                    }),
                background: status.completed ? accent : 'var(--violet-500)',
              }}
            />
          </div>
          {indeterminate && (
            <style>{`@keyframes upload-indeterminate{0%{margin-left:0}50%{margin-left:60%}100%{margin-left:0}}`}</style>
          )}
          {status.total > 0 && !status.completed && (
            <div className="text-[10px] text-[color:var(--violet-500)] text-right font-medium">
              {Math.round((status.loaded / status.total) * 100)}%
            </div>
          )}
        </div>
      )}
      {notice && (
        <div
          className="relative rounded-xl border bg-[color:var(--bg-surface)] shadow-lg p-3 cursor-pointer transition-colors overflow-hidden"
          style={{ borderColor: 'var(--status-error-fg)' }}
          onClick={onDismissNotice}
        >
          <span className="flex items-center gap-2 text-xs font-medium text-[color:var(--status-error-fg)]">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {notice}
          </span>
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: 'oklch(from var(--status-error-fg) l c h / 0.15)' }}
          >
            <div
              className="h-full"
              style={{
                background: 'var(--status-error-fg)',
                animation: 'shrink-progress 3000ms linear forwards',
              }}
            />
          </div>
          <style>{`@keyframes shrink-progress{from{width:100%}to{width:0%}}`}</style>
        </div>
      )}
    </div>,
    document.body,
  );
}
