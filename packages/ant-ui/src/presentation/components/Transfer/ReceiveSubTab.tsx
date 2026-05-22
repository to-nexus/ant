/**
 * ReceiveSubTab - Receive transfer requests sub-tab
 * 
 * Shows:
 * - Pending transfer requests grouped by sender+source, with file list and approve/reject
 * - Directory transfers can be expanded to show payload file tree
 * - Individual files can be excluded (opt-out) before approving
 * - Completed request history (approved/rejected/cancelled/expired)
 * - Empty state when no requests
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  fetchTransferRequests,
  fetchTransferPayloadFiles,
  fetchFileTree,
  resolveTransferRequest,
  type TransferRequest,
  type FileNode,
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Package, CheckCircle, XCircle, Ban, Timer, MessageCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { TransferFileList, guessPathType, countFilesInTree } from './TransferFileList';
import { Button } from '@/presentation/components/aurora';
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

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.earliestCreatedAt).getTime() - new Date(a.earliestCreatedAt).getTime()
  );
}

export function ReceiveSubTab() {
  const { t } = useTranslation('transfer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const receivedRequests = useStore((s) => s.receivedRequests);
  const setReceivedRequests = useStore((s) => s.setReceivedRequests);
  const setPendingCount = useStore((s) => s.setPendingTransferCount);
  const { showConfirm, showError } = useAlertModalContext();
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchTransferRequests('received').then(({ requests, pendingCount }) => {
      setReceivedRequests(requests);
      setPendingCount(pendingCount);
    }).catch(() => {});
  }, [setReceivedRequests, setPendingCount]);

  const filtered = receivedRequests.filter(r =>
    r.destination.projectId === selectedProject && r.destination.featureId === selectedFeature
  );
  const pendingRequests = filtered.filter(r => r.status === 'pending');
  const completedRequests = filtered.filter(r => r.status !== 'pending').slice(0, 20);
  const pendingGroups = groupPendingRequests(pendingRequests);

  const handleResolveGroup = useCallback(async (
    group: RequestGroup,
    action: 'approve' | 'reject',
    excludedPathsMap?: Map<string, Set<string>>,
  ) => {
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
            const reqExcludes = excludedPathsMap?.get(req.id);
            const excludeArr = reqExcludes && reqExcludes.size > 0
              ? Array.from(reqExcludes) : undefined;
            await resolveTransferRequest(req.id, action, excludeArr);
          }
          const { requests, pendingCount } = await fetchTransferRequests('received');
          setReceivedRequests(requests);
          setPendingCount(pendingCount);
          if (action === 'approve') {
            useStore.getState().refreshFileTree();
          }
        } catch (error: any) {
          showError(error.message || t('error.actionFailed', { action: actionLabel }), { title: t('common:error.title') });
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
  }, [t, showConfirm, showError, setReceivedRequests, setPendingCount]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[color:var(--text-4)]">
        <MessageCircle className="w-12 h-12 mb-3" />
        <p className="text-sm">{t('receive.empty')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {pendingGroups.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-[color:var(--text-2)] mb-2">
            {t('receive.pending')} ({pendingRequests.length})
          </h4>
          <div className="space-y-3">
            {pendingGroups.map(group => (
              <PendingGroupCard
                key={group.key}
                group={group}
                isLoading={group.requests.some(r => loadingIds.has(r.id))}
                onResolve={(action, excludedMap) => handleResolveGroup(group, action, excludedMap)}
              />
            ))}
          </div>
        </section>
      )}

      {completedRequests.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-[color:var(--text-2)] mb-2">{t('receive.processed')}</h4>
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
function PendingGroupCard({ group, isLoading, onResolve }: {
  group: RequestGroup;
  isLoading: boolean;
  onResolve: (action: 'approve' | 'reject', excludedMap?: Map<string, Set<string>>) => void;
}) {
  const { t } = useTranslation('transfer');
  const timeAgo = getTimeAgo(group.earliestCreatedAt, t);
  const expiresIn = getExpiresIn(group.latestExpiresAt, t);
  const fileCount = group.requests.length;

  const [payloadTreeMap, setPayloadTreeMap] = useState<Map<string, FileNode[]>>(new Map());
  const [excludedPathsMap, setExcludedPathsMap] = useState<Map<string, Set<string>>>(new Map());

  // Auto-load payload trees for directory-type requests
  useEffect(() => {
    for (const req of group.requests) {
      const pathType = guessPathType(req.source.path);
      if (pathType === 'directory' && !payloadTreeMap.has(req.id)) {
        fetchTransferPayloadFiles(req.id).then(({ files }) => {
          setPayloadTreeMap(prev => new Map(prev).set(req.id, files));
        }).catch(() => {});
      }
    }
  }, [group.requests]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExcludeFile = useCallback((requestId: string, filePath: string) => {
    setExcludedPathsMap(prev => {
      const next = new Map(prev);
      const existing = next.get(requestId) ?? new Set();
      const updated = new Set(existing);
      updated.add(filePath);
      next.set(requestId, updated);
      return next;
    });
  }, []);

  const handleRestoreFile = useCallback((requestId: string, filePath: string) => {
    setExcludedPathsMap(prev => {
      const next = new Map(prev);
      const existing = next.get(requestId);
      if (!existing) return prev;
      const updated = new Set(existing);
      updated.delete(filePath);
      next.set(requestId, updated);
      return next;
    });
  }, []);

  const totalExcluded = Array.from(excludedPathsMap.values())
    .reduce((sum, s) => sum + s.size, 0);

  return (
    <div className="border border-[color:var(--border-1)] rounded-lg bg-[color:var(--bg-surface)]/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[color:var(--border-1)]/50">
        <Package className="w-4.5 h-4.5 text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-[color:var(--text-1)]">
            from {group.sender.userId}
          </span>
          <span className="ml-2 text-xs text-[color:var(--text-3)]">
            {t('send.itemCount', { count: fileCount })}
          </span>
        </div>
        <span className="text-xs text-[color:var(--text-4)] shrink-0">
          {timeAgo} · {t('receive.expired')} {expiresIn}
        </span>
      </div>

      {/* Source info */}
      <div className="px-3 py-1.5 text-xs text-[color:var(--text-3)] bg-[color:var(--bg-canvas)]/30 border-b border-[color:var(--border-1)]/50">
        {group.source.projectId} / {group.source.featureId}
        {(group.source.projectId !== group.destination.projectId || group.source.featureId !== group.destination.featureId) && (
          <span> → {group.destination.projectId} / {group.destination.featureId}</span>
        )}
      </div>

      {/* File list — all requests merged into a single borderless list */}
      <div className="divide-y divide-gray-100">
        {group.requests.map(req => {
          const pathType = guessPathType(req.source.path);
          const payloadTree = payloadTreeMap.get(req.id);
          const reqExcluded = excludedPathsMap.get(req.id);
          const payloadFileCount = payloadTree ? countFilesInTree(payloadTree) : req.fileCount;

          return (
            <TransferFileList
              key={req.id}
              borderless
              items={[{
                path: req.source.path,
                type: pathType,
                fileCount: payloadFileCount ?? req.fileCount,
              }]}
              payloadTree={pathType === 'directory' ? payloadTree : undefined}
              onExcludeFile={(filePath) => handleExcludeFile(req.id, filePath)}
              onRestoreFile={(filePath) => handleRestoreFile(req.id, filePath)}
              excludedPaths={reqExcluded}
            />
          );
        })}
      </div>

      {/* Excluded count hint */}
      {totalExcluded > 0 && (
        <div className="px-3 py-1.5 text-xs text-amber-600 bg-amber-50 border-t border-[color:var(--border-1)]/50">
          {totalExcluded}개 파일 제외됨
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[color:var(--border-1)]/50 bg-[color:var(--bg-canvas)]/30">
        <Button
          size="sm"
          variant="primary"
          className="flex-1"
          onClick={() => onResolve('approve', excludedPathsMap)}
          disabled={isLoading}
        >
          <CheckCircle className="w-4 h-4 mr-1" />
          {t('action.approve')} ({fileCount})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => onResolve('reject')}
          disabled={isLoading}
        >
          <XCircle className="w-4 h-4 mr-1" />
          {t('action.reject')}
        </Button>
      </div>
    </div>
  );
}

// ─── Completed Request Row (expandable for approved) ───
function CompletedRequestRow({ request }: { request: TransferRequest }) {
  const { t } = useTranslation('transfer');
  const [expanded, setExpanded] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    approved: { icon: <CheckCircle className="w-4 h-4" />, label: t('action.approved'), color: 'text-green-500' },
    rejected: { icon: <XCircle className="w-4 h-4" />, label: t('action.rejected'), color: 'text-red-500' },
    cancelled: { icon: <Ban className="w-4 h-4" />, label: t('action.cancelled'), color: 'text-gray-400' },
    expired: { icon: <Timer className="w-4 h-4" />, label: t('receive.expired'), color: 'text-gray-400' },
    completed: { icon: <CheckCircle className="w-4 h-4" />, label: t('action.completed'), color: 'text-green-500' },
  };

  const config = statusConfig[request.status] || statusConfig.completed;
  const timeAgo = getTimeAgo(request.createdAt, t);
  const isApproved = request.status === 'approved' || request.status === 'completed';
  const pathType = guessPathType(request.source.path);
  const canExpand = isApproved && pathType === 'directory';

  const handleToggle = useCallback(async () => {
    if (!canExpand) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!fileTree) {
      setLoading(true);
      try {
        const tree = await fetchFileTree(request.destination.projectId, request.destination.featureId);
        const destPath = request.destination.path.replace(/\/$/, '');
        const subtree = findSubtree(tree, destPath);
        setFileTree(subtree);
      } catch {
        setFileTree([]);
      } finally {
        setLoading(false);
      }
    }
  }, [canExpand, expanded, fileTree, request]);

  return (
    <div className="rounded hover:bg-[color:var(--bg-hover)]">
      <div
        className={cn('flex items-center justify-between text-sm py-2 px-3', canExpand && 'cursor-pointer')}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('shrink-0', config.color)}>{config.icon}</span>
          {canExpand && (
            <span className="shrink-0 text-gray-400">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          )}
          <span className="text-[color:var(--text-2)] truncate">
            {request.sender.userId} · {request.source.path}
          </span>
          {request.fileCount != null && request.fileCount > 0 && (
            <span className="text-xs text-[color:var(--text-4)] shrink-0">
              ({request.fileCount}개 파일)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn('text-xs', config.color)}>{config.label}</span>
          <span className="text-xs text-gray-400">{timeAgo}</span>
        </div>
      </div>
      {expanded && (
        <div className="pb-2 px-3">
          {loading ? (
            <div className="text-xs text-gray-400 py-2 pl-6">로딩 중...</div>
          ) : fileTree && fileTree.length > 0 ? (
            <TransferFileList
              borderless
              items={[{ path: request.destination.path, type: 'directory' }]}
              payloadTree={fileTree}
            />
          ) : (
            <div className="text-xs text-gray-400 py-2 pl-6">파일 정보를 불러올 수 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Find subtree matching destination path from a full project file tree */
function findSubtree(tree: FileNode[], destPath: string): FileNode[] {
  for (const node of tree) {
    if (node.path === destPath && node.children) return node.children;
    if (destPath.startsWith(node.path + '/') && node.children) {
      const deeper = findSubtree(node.children, destPath);
      if (deeper.length > 0) return deeper;
    }
  }
  return [];
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
