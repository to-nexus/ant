/**
 * ReceiveSubTab - Receive transfer requests sub-tab
 * 
 * Shows:
 * - Pending transfer requests grouped by sender+source, with file list and approve/reject
 * - Completed request history (approved/rejected/cancelled/expired)
 * - Empty state when no requests
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  fetchTransferRequests,
  resolveTransferRequest,
  type TransferRequest,
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Package, CheckCircle, XCircle, Ban, Timer, MessageCircle } from 'lucide-react';
import { TransferFileList, guessPathType } from './TransferFileList';
import { Button } from '../common/button';
import { cn } from '@/shared/utils/design-system';

/** Group key for pending requests from the same sender + source project/feature */
interface RequestGroup {
  key: string;
  sender: { orgId: string; userId: string };
  source: { projectId: string; featureId: string };
  destination: { projectId: string; featureId: string };
  requests: TransferRequest[];
  earliestCreatedAt: string;
  latestExpiresAt: string;
}

function groupPendingRequests(requests: TransferRequest[]): RequestGroup[] {
  const map = new Map<string, RequestGroup>();

  for (const req of requests) {
    const key = `${req.sender.userId}:${req.source.projectId}:${req.source.featureId}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        sender: req.sender,
        source: { projectId: req.source.projectId, featureId: req.source.featureId },
        destination: { projectId: req.destination.projectId, featureId: req.destination.featureId },
        requests: [],
        earliestCreatedAt: req.createdAt,
        latestExpiresAt: req.expiresAt,
      };
      map.set(key, group);
    }
    group.requests.push(req);
    if (req.createdAt < group.earliestCreatedAt) group.earliestCreatedAt = req.createdAt;
    if (req.expiresAt > group.latestExpiresAt) group.latestExpiresAt = req.expiresAt;
  }

  // Sort groups by earliest creation time (newest first)
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.earliestCreatedAt).getTime() - new Date(a.earliestCreatedAt).getTime()
  );
}

export function ReceiveSubTab() {
  const { t } = useTranslation('transfer');
  const receivedRequests = useStore((s) => s.receivedRequests);
  const setReceivedRequests = useStore((s) => s.setReceivedRequests);
  const setPendingCount = useStore((s) => s.setPendingTransferCount);
  const { showConfirm, showError } = useAlertModalContext();
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Load received requests
  useEffect(() => {
    fetchTransferRequests('received').then(({ requests, pendingCount }) => {
      setReceivedRequests(requests);
      setPendingCount(pendingCount);
    }).catch(() => {});
  }, [setReceivedRequests, setPendingCount]);

  const pendingRequests = receivedRequests.filter(r => r.status === 'pending');
  const completedRequests = receivedRequests.filter(r => r.status !== 'pending').slice(0, 20);
  const pendingGroups = groupPendingRequests(pendingRequests);

  const handleResolveGroup = async (group: RequestGroup, action: 'approve' | 'reject') => {
    const actionLabel = action === 'approve' ? t('action.approve') : t('action.reject');
    const count = group.requests.length;

    showConfirm(t('confirm.bulkAction', { action: actionLabel, count }), {
      type: action === 'approve' ? 'info' : 'warning',
      title: t('confirm.bulkTitle', { action: actionLabel }),
      confirmText: `${actionLabel} (${count})`,
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        const ids = group.requests.map(r => r.id);
        setLoadingIds(prev => new Set([...prev, ...ids]));
        try {
          for (const req of group.requests) {
            await resolveTransferRequest(req.id, action);
          }
          // Refresh
          const { requests, pendingCount } = await fetchTransferRequests('received');
          setReceivedRequests(requests);
          setPendingCount(pendingCount);
          if (action === 'approve') {
            useStore.getState().refreshFileTree();
          }
        } catch (error: any) {
          showError(error.message || t('error.actionFailed', { action: actionLabel }), { title: t('common:error.title') });
          // Refresh anyway to show partial results
          const { requests, pendingCount } = await fetchTransferRequests('received');
          setReceivedRequests(requests);
          setPendingCount(pendingCount);
        } finally {
          setLoadingIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
          });
        }
      },
    });
  };

  if (receivedRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500">
        <MessageCircle className="w-12 h-12 mb-3" />
        <p className="text-sm">{t('receive.empty')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Pending request groups */}
      {pendingGroups.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('receive.pending')} ({pendingRequests.length})
          </h4>
          <div className="space-y-3">
            {pendingGroups.map(group => (
              <PendingGroupCard
                key={group.key}
                group={group}
                isLoading={group.requests.some(r => loadingIds.has(r.id))}
                onApprove={() => handleResolveGroup(group, 'approve')}
                onReject={() => handleResolveGroup(group, 'reject')}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed history */}
      {completedRequests.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('receive.processed')}</h4>
          <div className="space-y-1">
            {completedRequests.map(req => (
              <CompletedRequestRow key={req.id} request={req} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Pending Group Card ───
function PendingGroupCard({ group, isLoading, onApprove, onReject }: {
  group: RequestGroup;
  isLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation('transfer');
  const timeAgo = getTimeAgo(group.earliestCreatedAt, t);
  const expiresIn = getExpiresIn(group.latestExpiresAt, t);
  const fileCount = group.requests.length;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800/50 overflow-hidden">
      {/* Header: icon + from sender + file count */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-gray-700/50">
        <Package className="w-4.5 h-4.5 text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            from {group.sender.userId}
          </span>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            {t('send.itemCount', { count: fileCount })}
          </span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          {timeAgo} · {t('receive.expired')} {expiresIn}
        </span>
      </div>

      {/* Source info */}
      <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-700/50">
        {group.source.projectId} / {group.source.featureId}
        {(group.source.projectId !== group.destination.projectId || group.source.featureId !== group.destination.featureId) && (
          <span> → {group.destination.projectId} / {group.destination.featureId}</span>
        )}
      </div>

      {/* File list */}
      <TransferFileList
        items={group.requests.map(req => ({
          path: req.source.path,
          type: guessPathType(req.source.path),
          fileCount: req.fileCount,
        }))}
      />

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/30">
        <Button
          size="sm"
          variant="default"
          className="flex-1"
          onClick={onApprove}
          disabled={isLoading}
        >
          <CheckCircle className="w-4 h-4 mr-1" />
          {t('action.approve')} ({fileCount})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={onReject}
          disabled={isLoading}
        >
          <XCircle className="w-4 h-4 mr-1" />
          {t('action.reject')}
        </Button>
      </div>
    </div>
  );
}

// ─── Completed Request Row ───
function CompletedRequestRow({ request }: { request: TransferRequest }) {
  const { t } = useTranslation('transfer');
  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    approved: { icon: <CheckCircle className="w-4 h-4" />, label: t('action.approved'), color: 'text-green-500' },
    rejected: { icon: <XCircle className="w-4 h-4" />, label: t('action.rejected'), color: 'text-red-500' },
    cancelled: { icon: <Ban className="w-4 h-4" />, label: t('action.cancelled'), color: 'text-gray-400' },
    expired: { icon: <Timer className="w-4 h-4" />, label: t('receive.expired'), color: 'text-gray-400' },
    completed: { icon: <CheckCircle className="w-4 h-4" />, label: t('action.completed'), color: 'text-green-500' },
  };

  const config = statusConfig[request.status] || statusConfig.completed;
  const timeAgo = getTimeAgo(request.createdAt, t);

  return (
    <div className="flex items-center justify-between text-sm py-2 px-3 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('shrink-0', config.color)}>{config.icon}</span>
        <span className="text-gray-700 dark:text-gray-300 truncate">
          {request.sender.userId} · {request.source.path}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn('text-xs', config.color)}>{config.label}</span>
        <span className="text-xs text-gray-400">{timeAgo}</span>
      </div>
    </div>
  );
}

// ─── Utilities ───
function getTimeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return t('common:time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common:time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('common:time.daysAgo', { count: days });
}

function getExpiresIn(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return t('receive.expired');
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return t('common:time.hours', { count: hours });
  const days = Math.floor(hours / 24);
  return `${t('common:time.days', { count: days })} ${t('common:time.hours', { count: hours % 24 })}`;
}
