import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Trash2, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useJobHistory } from '@/application/hooks/features/useJobHistory';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { cn } from '@/shared/utils/design-system';
import type { JobHistoryEntry, KanbanData } from '@/infrastructure/http/api';
import {
  ElapsedTimeBadge,
  TokenUsageBadge,
} from '@/presentation/components/kanban/KanbanHeader';

interface JobIdDropdownProps {
  jobId: string;
}

/**
 * Job-tab ID chip + dropdown.
 *
 * Replaces the legacy "click to copy" chip and tab-level X button. The chip
 * itself is now a dropdown trigger; clicking it reveals a panel listing every
 * jobId for the same feature × jobType, most-recent first:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ ● {currentJobId}            [Copy] [Trash]  │  ← pinned top, emerald dot
 *   │   {olderJobId₁}             [Copy] [Trash]  │
 *   │   {olderJobId₂}             [Copy] [Trash]  │
 *   │   ...                                       │
 *   └─────────────────────────────────────────────┘
 *
 * Row body click → switch the kanban view to that jobId (no-op for the
 *   currently selected row; just closes the dropdown).
 * Copy icon    → copy that jobId to clipboard.
 * Trash icon   → confirm + delete every artifact tied to that jobId.
 *                Disabled for live (running/paused) jobs. Deleting the
 *                currently selected jobId auto-switches to the next-most
 *                recent entry; if none exists, the board is left empty.
 */
export function JobIdDropdown({ jobId }: JobIdDropdownProps) {
  const { t } = useTranslation('nav');
  const { toast } = useToastContext();
  const { showConfirm, showInfo } = useAlertModalContext();
  const selectJobId = useStore((s) => s.selectJobId);
  const deleteJobId = useStore((s) => s.deleteJobId);

  const [open, setOpen] = useState(false);
  const [chipHover, setChipHover] = useState(false);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [hoveredCopyId, setHoveredCopyId] = useState<string | null>(null);
  const [hoveredDeleteId, setHoveredDeleteId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });
  const { entries, refresh } = useJobHistory();
  // Live kanban for the currently selected jobId — preferred over the
  // persisted snapshot (which may lag the live SSE stream by a few seconds).
  const currentKanban = useStore((s) => s.kanban);

  // Compute fixed-position coordinates for the portaled panel so it sits
  // directly under the chip. Right-edge overflow flips to right-align; the
  // left edge is clamped to keep the panel on-screen.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const GAP = 4;
    const MARGIN = 8;
    const MENU_WIDTH = Math.min(480, window.innerWidth - 24);
    let left = rect.left;
    if (left + MENU_WIDTH > window.innerWidth - MARGIN) {
      left = rect.right - MENU_WIDTH;
    }
    if (left < MARGIN) left = MARGIN;
    setMenuPos({
      top: rect.bottom + GAP,
      left,
      width: MENU_WIDTH,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Both refs must miss — portal child is NOT under triggerRef tree, so
      // a single-container check would close the menu on every click inside it.
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Ignore scrolls inside the menu itself.
      const target = e.target as Node;
      if (menuRef.current && menuRef.current.contains(target)) return;
      // Close only when an ancestor of the trigger scrolls (the chip actually
      // moves). window/page scroll has target===document and
      // document.contains(trigger)===true, so it still closes. Unrelated
      // sibling scroll containers — e.g. the chat history's virtual scroller —
      // do NOT contain the trigger, so streaming chat no longer dismisses it.
      if (triggerRef.current && target.contains(triggerRef.current)) {
        setOpen(false);
      }
    };
    const onResize = () => setOpen(false);

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('scroll', onScroll, true);
    });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Refresh history when opening so users see the latest after a sibling
  // tab finishes a job.
  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  // Pin the current jobId at the top regardless of its completedAt ordering.
  // If the current jobId is absent from `entries` (Redis stale, session not
  // yet flushed, etc.) synthesize a minimal entry so the row still renders.
  const currentEntry: JobHistoryEntry =
    entries.find((e) => e.jobId === jobId) ?? {
      jobId,
      type: '',
      status: 'unknown',
      live: false,
    };
  const others = entries.filter((e) => e.jobId !== jobId);
  const rows: Array<{ entry: JobHistoryEntry; isCurrent: boolean }> = [
    { entry: currentEntry, isCurrent: true },
    ...others.map((e) => ({ entry: e, isCurrent: false })),
  ];

  const copyToClipboard = (id: string) => {
    void navigator.clipboard.writeText(id);
    toast.success(t('tabs.copiedJobId'));
  };

  const handleSelect = (id: string, live: boolean, isCurrent: boolean) => {
    setOpen(false);
    if (isCurrent) return;
    void selectJobId(id, { live });
  };

  const handleDelete = (id: string, live: boolean, isCurrent: boolean) => {
    if (live) {
      showInfo(t('tabs.deleteJobIdBlocked'), {
        type: 'warning',
        title: t('tabs.deleteJobId'),
      });
      return;
    }
    // Snapshot the pre-delete "next candidate" so we can hop the board there
    // after a successful wipe. Only relevant when removing the current row.
    // `others` is already sorted most-recent first by useJobHistory.
    const nextCandidate = isCurrent ? others.find((e) => !e.live) ?? null : null;

    showConfirm(
      <p>{t('tabs.deleteJobIdDesc', { jobId: id })}</p>,
      {
        type: 'warning',
        title: t('tabs.deleteJobId'),
        confirmText: t('common:button.remove'),
        cancelText: t('common:button.cancel'),
        onConfirm: async () => {
          try {
            await deleteJobId(id);
            toast.success(t('tabs.deletedJobId'));
            if (isCurrent && nextCandidate) {
              // `deleteJobId` already unset currentJobId + cleared the board,
              // so selectJobId will treat the switch as a fresh selection.
              await selectJobId(nextCandidate.jobId, { live: nextCandidate.live });
            }
            void refresh();
          } catch {
            toast.error(t('tabs.deleteJobIdFailed'));
          }
        },
      },
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) updatePosition();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setChipHover(true)}
        onMouseLeave={() => setChipHover(false)}
        className={cn(
          'ml-0.5 px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap rounded',
          'transition-colors cursor-pointer',
          'inline-flex items-center gap-1',
        )}
        style={{
          background: chipHover ? 'var(--bg-hover)' : 'var(--bg-surface)',
          color: 'var(--text-3)',
        }}
        title={jobId}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{jobId}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && createPortal(
        // Rendered via React Portal so backdrop-filter on the active TabButton
        // (which creates its own stacking context) cannot trap the dropdown
        // behind sibling kanban surfaces (sticky header z-10, swimlane backdrop).
        <div
          ref={menuRef}
          role="menu"
          // Rows: job + time + token share one flex with uniform `gap-2` (no
          // fixed-width badge columns). Copy/delete sit in a shrink-0 sibling so
          // they stay on the right edge of the panel while the left group grows.
          className={cn(
            'fixed rounded-md z-[9999] py-1',
          )}
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-h-80 overflow-auto px-2">
            <ul className="w-full">
              {rows.map(({ entry, isCurrent }) => {
                // Preferred source per row:
                //  - current jobId → live store kanban (most up-to-date)
                //  - everything else → persisted snapshot from the BE history
                //                     payload (falls back to no-badge when missing)
                const snapshot: KanbanData | undefined = isCurrent
                  ? (currentKanban as KanbanData | undefined)
                  : entry.kanbanSnapshot;
                const hasTiming = !!snapshot?.jobTiming;
                const hasTokens = !!(
                  snapshot?.tokenUsage ||
                  snapshot?.estimatingTokenUsage ||
                  (snapshot?.phaseTokenUsages && snapshot.phaseTokenUsages.length > 0) ||
                  (snapshot?.completed && snapshot.completed.length > 0) ||
                  (snapshot?.inProgress && snapshot.inProgress.length > 0)
                );

                const rowHovered = hoveredRowId === entry.jobId;
                const rowBackground = isCurrent
                  ? 'var(--bg-surface-2)'
                  : rowHovered
                    ? 'var(--bg-hover)'
                    : 'transparent';

                return (
                  <li
                    key={entry.jobId}
                    className="group flex w-full min-w-0 items-center"
                    style={{ background: rowBackground }}
                    onMouseEnter={() => !isCurrent && setHoveredRowId(entry.jobId)}
                    onMouseLeave={() => setHoveredRowId((prev) => (prev === entry.jobId ? null : prev))}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => handleSelect(entry.jobId, entry.live, isCurrent)}
                        className={cn(
                          'flex shrink-0 items-center gap-2 text-left whitespace-nowrap',
                          'text-xs font-mono',
                          isCurrent ? 'cursor-default' : 'cursor-pointer',
                        )}
                        style={{ color: isCurrent ? 'var(--text-1)' : 'var(--text-2)' }}
                        title={entry.jobId}
                      >
                        {(() => {
                          // Status priority: live signals (current/amber) take
                          // precedence over the persisted terminal status.
                          // Past runs surface their `kanbanSnapshot.status` so
                          // failed/canceled/paused jobs are visually distinct
                          // from completed ones — pre-fix the slot was empty
                          // for every non-live row regardless of outcome, which
                          // let a `failed` job (status sealed correctly on the
                          // BE) read to the user as "완료" (such-pinning-milky
                          // RCA).
                          if (isCurrent) {
                            return (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--status-done-fg)' }}
                                aria-hidden
                              />
                            );
                          }
                          if (entry.live) {
                            return (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--amber-500)' }}
                                aria-label={t('tabs.liveJob')}
                                title={t('tabs.liveJob')}
                              />
                            );
                          }
                          const past = snapshot?.status;
                          if (past === 'failed') {
                            return (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--red-500)' }}
                                aria-label={t('tabs.failedJob', { defaultValue: 'Failed' })}
                                title={t('tabs.failedJob', { defaultValue: 'Failed' })}
                              />
                            );
                          }
                          if (past === 'canceled') {
                            return (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--text-3)' }}
                                aria-label={t('tabs.canceledJob', { defaultValue: 'Canceled' })}
                                title={t('tabs.canceledJob', { defaultValue: 'Canceled' })}
                              />
                            );
                          }
                          if (past === 'paused') {
                            return (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--amber-500)' }}
                                aria-label={t('tabs.pausedJob', { defaultValue: 'Paused' })}
                                title={t('tabs.pausedJob', { defaultValue: 'Paused' })}
                              />
                            );
                          }
                          return <span className="w-1.5 h-1.5 flex-shrink-0" aria-hidden />;
                        })()}
                        <span>{entry.jobId}</span>
                      </button>
                      {/* Always two flex slots after id so gap-2 is even whether a badge is missing */}
                      <span className="inline-flex shrink-0">
                        {hasTiming && (
                          <ElapsedTimeBadge
                            jobTiming={snapshot!.jobTiming}
                            completedTasks={snapshot!.completed}
                            inProgressTasks={snapshot!.inProgress}
                            compact
                            tickFromStore={isCurrent}
                          />
                        )}
                      </span>
                      <span className="inline-flex shrink-0">
                        {hasTokens && (
                          <TokenUsageBadge
                            jobId={entry.jobId}
                            tokenUsage={snapshot!.tokenUsage}
                            tokenUsageByModel={snapshot!.tokenUsageByModel}
                            estimatingTokenUsage={snapshot!.estimatingTokenUsage}
                            phaseTokenUsages={snapshot!.phaseTokenUsages}
                            completedTasks={snapshot!.completed}
                            inProgressTasks={snapshot!.inProgress}
                            compact
                          />
                        )}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 py-1.5 pl-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(entry.jobId);
                        }}
                        onMouseEnter={() => setHoveredCopyId(entry.jobId)}
                        onMouseLeave={() => setHoveredCopyId((prev) => (prev === entry.jobId ? null : prev))}
                        className="flex-shrink-0 p-1 rounded"
                        style={
                          hoveredCopyId === entry.jobId
                            ? { background: 'var(--bg-hover)', color: 'var(--text-1)' }
                            : { color: 'var(--text-3)' }
                        }
                        title={t('tabs.copyJobId')}
                        aria-label={t('tabs.copyJobId')}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(entry.jobId, entry.live, isCurrent);
                        }}
                        onMouseEnter={() => !entry.live && setHoveredDeleteId(entry.jobId)}
                        onMouseLeave={() => setHoveredDeleteId((prev) => (prev === entry.jobId ? null : prev))}
                        disabled={entry.live}
                        className={cn(
                          'flex-shrink-0 p-1 rounded',
                          'disabled:opacity-30 disabled:cursor-not-allowed',
                        )}
                        style={
                          hoveredDeleteId === entry.jobId && !entry.live
                            ? {
                                background: 'oklch(from var(--red-500) l c h / 0.16)',
                                color: 'var(--red-500)',
                              }
                            : { color: 'var(--text-3)' }
                        }
                        title={
                          entry.live
                            ? t('tabs.deleteJobIdBlocked')
                            : t('tabs.deleteJobId')
                        }
                        aria-label={t('tabs.deleteJobId')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
