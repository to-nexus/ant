/**
 * SendSubTab - Send artifact transfer sub-tab
 *
 * Layout:
 * 1. 보낼 항목: [Project / Feature] 한줄 + 보낼 내용 목록 + 추가하기
 * 2. 받는 곳: [나|다른사람(멤버이름)] 토글 → Project/Feature 한줄 (경로는 소스와 동일하게 자동 지정)
 * 3. [복사|이동] [전송하기 (N)] 한줄
 * 4. 보낸 요청 히스토리
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { PathPicker } from '../common/PathPicker';
import { MemberPicker } from '../common/MemberPicker';
import {
  transferArtifact,
  requestTransfer,
  fetchTransferRequests,
  cancelTransferRequest,
  deleteTransferRequest,
  fetchOrgMembers,
  fetchMemberProjects,
  fetchMemberFeatures,
  fetchFileTree,
  type FileNode,
  type TransferRequest,
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { Clock, CheckCircle, XCircle, Ban, Timer, ArrowRight, Plus, ChevronDown, AlertTriangle, X } from 'lucide-react';
import { TransferFileList, countFilesUnderPath } from './TransferFileList';
import { Button } from '../common/button';
import { cn } from '@/shared/utils/design-system';
import { normalizePaths } from '@/shared/utils/path-utils';

export function SendSubTab() {
  const { t } = useTranslation('transfer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const preselected = useStore((s) => s.sendPreselectedSource);
  const clearPreselected = useStore((s) => s.clearSendPreselectedSource);
  const sendTarget = useStore((s) => s.sendTarget);
  const setSendTarget = useStore((s) => s.setSendTarget);
  const sentRequests = useStore((s) => s.sentRequests);
  const setSentRequests = useStore((s) => s.setSentRequests);
  const { showError } = useAlertModalContext();
  const { toast } = useToastContext();

  // Source state
  const [srcProjectId, setSrcProjectId] = useState(preselected?.projectId || selectedProject || '');
  const [srcFeatureId, setSrcFeatureId] = useState(preselected?.featureId || selectedFeature || '');
  const [srcPaths, setSrcPaths] = useState<Array<{ path: string; type: 'file' | 'directory' }>>(
    preselected ? [{ path: preselected.path, type: preselected.type }] : []
  );
  const [srcFileTree, setSrcFileTree] = useState<FileNode[]>([]);
  const [isAddingPath, setIsAddingPath] = useState(false);

  // Destination state (self)
  const [destProjectId, setDestProjectId] = useState('');
  const [destFeatureId, setDestFeatureId] = useState('');
  const [destFeatures, setDestFeatures] = useState<Array<{ featureId: string }>>([]);

  // Destination state (other)
  const [members, setMembers] = useState<Array<{ userId: string; isSelf: boolean }>>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [otherProjects, setOtherProjects] = useState<Array<{ projectId: string }>>([]);
  const [otherFeatures, setOtherFeatures] = useState<Array<{ featureId: string }>>([]);
  const [otherProjectId, setOtherProjectId] = useState('');
  const [otherFeatureId, setOtherFeatureId] = useState('');

  // Transfer mode
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [isLoading, setIsLoading] = useState(false);

  // Validation states for "other" destination
  const [otherUserNotFound, setOtherUserNotFound] = useState(false);
  const [otherProjectsLoaded, setOtherProjectsLoaded] = useState(false);
  const [otherFeaturesLoaded, setOtherFeaturesLoaded] = useState(false);

  // Self projects
  const [selfProjects, setSelfProjects] = useState<Array<{ projectId: string }>>([]);
  const [selfUserId, setSelfUserId] = useState('');

  // Sync preselected source
  useEffect(() => {
    if (preselected) {
      if (preselected.projectId !== srcProjectId || preselected.featureId !== srcFeatureId) {
        setSrcProjectId(preselected.projectId);
        setSrcFeatureId(preselected.featureId);
        setSrcPaths([{ path: preselected.path, type: preselected.type }]);
      } else {
        setSrcPaths(prev => normalizePaths([...prev, { path: preselected.path, type: preselected.type }]));
      }
      clearPreselected();
    }
  }, [preselected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync source project/feature when global selection changes
  useEffect(() => {
    if (!preselected) {
      setSrcProjectId(selectedProject || '');
      setSrcFeatureId(selectedFeature || '');
      setSrcPaths([]);
    }
  }, [selectedProject, selectedFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load org members + self projects
  useEffect(() => {
    fetchOrgMembers().then(({ members: m }) => {
      setMembers(m);
      const self = m.find(mb => mb.isSelf);
      if (self) {
        setSelfUserId(self.userId);
        fetchMemberProjects(self.userId).then(({ projects }) => {
          setSelfProjects(projects);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Load source file tree (only show artifact dirs: inputs, outputs)
  useEffect(() => {
    if (!srcProjectId || !srcFeatureId) { setSrcFileTree([]); return; }
    fetchFileTree(srcProjectId, srcFeatureId).then(tree => {
      setSrcFileTree(filterArtifactDirs(tree || []));
    }).catch(() => setSrcFileTree([]));
  }, [srcProjectId, srcFeatureId]);

  // Load dest features
  useEffect(() => {
    if (!destProjectId || !selfUserId) { setDestFeatures([]); return; }
    fetchMemberFeatures(selfUserId, destProjectId).then(({ features }) => {
      setDestFeatures(features);
    }).catch(() => setDestFeatures([]));
  }, [destProjectId, selfUserId]);

  // Load other user's projects
  useEffect(() => {
    if (!targetUserId) {
      setOtherProjects([]);
      setOtherUserNotFound(false);
      setOtherProjectsLoaded(false);
      return;
    }
    setOtherUserNotFound(false);
    setOtherProjectsLoaded(false);
    fetchMemberProjects(targetUserId).then(({ projects }) => {
      setOtherProjects(projects);
      setOtherProjectsLoaded(true);
    }).catch(() => {
      setOtherProjects([]);
      setOtherUserNotFound(true);
      setOtherProjectsLoaded(true);
    });
  }, [targetUserId]);

  // Load other user's features
  useEffect(() => {
    if (!targetUserId || !otherProjectId) {
      setOtherFeatures([]);
      setOtherFeaturesLoaded(false);
      return;
    }
    setOtherFeaturesLoaded(false);
    fetchMemberFeatures(targetUserId, otherProjectId).then(({ features }) => {
      setOtherFeatures(features);
      setOtherFeaturesLoaded(true);
    }).catch(() => {
      setOtherFeatures([]);
      setOtherFeaturesLoaded(true);
    });
  }, [targetUserId, otherProjectId]);

  // Load sent requests history
  useEffect(() => {
    fetchTransferRequests('sent').then(({ requests }) => {
      setSentRequests(requests);
    }).catch(() => {});
  }, [setSentRequests]);

  const handleAddPath = (path: string) => {
    const findType = (nodes: FileNode[], target: string): 'file' | 'directory' => {
      for (const n of nodes) {
        if (n.path === target) return n.type as 'file' | 'directory';
        if (n.children) { const f = findType(n.children, target); if (f) return f; }
      }
      return 'file';
    };
    const type = findType(srcFileTree, path);
    // Skip empty directories (no files to send)
    if (type === 'directory' && countFilesUnderPath(srcFileTree, path) === 0) {
      return;
    }
    setSrcPaths(prev => normalizePaths([...prev, { path, type }]));
  };

  const handleRemovePath = (path: string) => {
    setSrcPaths(prev => prev.filter(p => p.path !== path));
  };

  const handleMemberSelect = (userId: string) => {
    setTargetUserId(userId);
    setOtherProjectId(''); setOtherFeatureId('');
    setOtherUserNotFound(false);
    setOtherProjectsLoaded(false);
    setOtherFeaturesLoaded(false);
    if (userId) {
      setSendTarget('other');
    }
  };

  const handleMemberDismiss = () => {
    // If no member selected, revert to "나"
    if (!targetUserId) {
      setSendTarget('self');
    }
  };

  const handleTransfer = async () => {
    if (srcPaths.length === 0) {
      showError(t('error.noItems'), { title: t('error.title') });
      return;
    }
    setIsLoading(true);
    try {
      if (sendTarget === 'self') {
        if (!destProjectId || !destFeatureId) {
          showError(t('error.noDestination'), { title: t('error.title') });
          setIsLoading(false); return;
        }
        for (const item of srcPaths) {
          await transferArtifact({
            source: { projectId: srcProjectId, featureId: srcFeatureId, path: item.path },
            destination: { projectId: destProjectId, featureId: destFeatureId, path: item.path },
            mode,
          });
        }
        setSrcPaths([]);
        useStore.getState().refreshFileTree();
        const modeLabel = mode === 'copy' ? t('mode.copy') : t('mode.move');
        toast.success(t('success.selfTransfer', { count: srcPaths.length, mode: modeLabel, project: destProjectId, feature: destFeatureId }));
      } else {
        // Use source path as destination path (same relative location)
        if (!targetUserId) {
          showError(t('error.noRecipient'), { title: t('error.title') });
          setIsLoading(false); return;
        }
        if (otherUserNotFound) {
          showError(t('error.noWorkspace'), { title: t('error.cannotTransfer') });
          setIsLoading(false); return;
        }
        if (!otherProjectId) {
          showError(otherProjects.length === 0
            ? t('error.noRecipientProject')
            : t('error.selectRecipientProject'),
            { title: t('error.title') });
          setIsLoading(false); return;
        }
        if (!otherFeatureId) {
          showError(otherFeatures.length === 0
            ? t('error.noFeatureInProject')
            : t('error.selectRecipientFeature'),
            { title: t('error.title') });
          setIsLoading(false); return;
        }
        for (const item of srcPaths) {
          await requestTransfer({
            recipient: { userId: targetUserId },
            source: { projectId: srcProjectId, featureId: srcFeatureId, path: item.path },
            destination: { projectId: otherProjectId, featureId: otherFeatureId, path: item.path },
          });
        }
        setSrcPaths([]);
        const { requests } = await fetchTransferRequests('sent');
        setSentRequests(requests);
      }
    } catch (error: any) {
      showError(error.message || t('error.transferFailed'), { title: t('error.title') });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (requestId: string) => {
    try {
      await cancelTransferRequest(requestId);
      const { requests } = await fetchTransferRequests('sent');
      setSentRequests(requests);
    } catch (error: any) {
      showError(error.message, { title: t('error.cancelFailed') });
    }
  };

  const handleDelete = async (requestId: string) => {
    try {
      await deleteTransferRequest(requestId);
      setSentRequests(sentRequests.filter(r => r.id !== requestId));
    } catch (error: any) {
      showError(error.message, { title: t('error.deleteFailed') });
    }
  };

  const otherMembers = members.filter(m => !m.isSelf);

  return (
    <div className="p-4 space-y-4">
      {/* ── 1. Source ── */}
      <section>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('send.title')}</h4>
        {/* Project / Feature — fixed (determined by current selection) */}
        <div className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-medium truncate max-w-[200px]" title={srcProjectId}>
            {srcProjectId || '—'}
          </span>
          <span className="text-gray-400 dark:text-gray-500">/</span>
          <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-medium truncate max-w-[200px]" title={srcFeatureId}>
            {srcFeatureId || '—'}
          </span>
        </div>

        {/* Selected items + add button */}
        {srcProjectId && srcFeatureId && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('send.itemCount', { count: srcPaths.length })}
              </span>
              <button
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors',
                  isAddingPath
                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                    : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50'
                )}
                onClick={() => setIsAddingPath(!isAddingPath)}
              >
                <Plus className="w-3.5 h-3.5" />
                {t('send.addButton')}
              </button>
            </div>

            {/* PathPicker: appears right below the add button, above the list */}
            {isAddingPath && (
              <div className="mb-2">
                <PathPicker
                  contextLabel={t('send.addDialog')}
                  fileTree={srcFileTree}
                  selectedPath=""
                  onSelect={handleAddPath}
                  selectableTypes={['file', 'directory']}
                  excludePatterns={['sessions/']}
                />
              </div>
            )}

            <TransferFileList
              items={srcPaths}
              fileTree={srcFileTree}
              onRemove={handleRemovePath}
            />

            {srcPaths.length === 0 && !isAddingPath && (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                {t('send.emptyHint')}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── 2. Destination ── */}
      <section>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('send.destination')}</h4>

        {/* Target toggle: 나 / 다른 사람(멤버 이름) */}
        <div className="flex items-center gap-2 mb-3">
          <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            <button
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                sendTarget === 'self'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
              onClick={() => { setSendTarget('self'); }}
            >
              {t('send.self')}
            </button>
            <button
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                sendTarget === 'other'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
              onClick={() => { setSendTarget('other'); setMode('copy'); }}
            >
              {t('send.others')}
            </button>
          </div>
          {sendTarget === 'other' && (
            <MemberPicker
              members={otherMembers}
              selectedUserId={targetUserId}
              onSelect={handleMemberSelect}
              onDismiss={handleMemberDismiss}
              placeholder={t('send.selectMember')}
            />
          )}
        </div>

        {sendTarget === 'self' ? (
          <div className="space-y-2">
            <InlineProjectFeature
              projectValue={destProjectId}
              featureValue={destFeatureId}
              projectOptions={selfProjects.map(p => p.projectId)}
              featureOptions={destFeatures.map(f => f.featureId)}
              onProjectChange={(v) => { setDestProjectId(v); setDestFeatureId(''); }}
              onFeatureChange={(v) => { setDestFeatureId(v); }}
              disableFeature={!destProjectId}
            />
            {destProjectId && destFeatures.length === 0 && (
              <InlineWarning message={t('error.noFeatureInProject')} />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Workspace not found warning */}
            {otherUserNotFound && targetUserId && (
              <InlineWarning message={t('error.noWorkspace')} />
            )}

            {!otherUserNotFound && (
              <>
                <InlineProjectFeature
                  projectValue={otherProjectId}
                  featureValue={otherFeatureId}
                  projectOptions={otherProjects.map(p => p.projectId)}
                  featureOptions={otherFeatures.map(f => f.featureId)}
                  onProjectChange={(v) => { setOtherProjectId(v); setOtherFeatureId(''); setOtherFeaturesLoaded(false); }}
                  onFeatureChange={(v) => { setOtherFeatureId(v); }}
                  disableProject={!targetUserId}
                  disableFeature={!otherProjectId}
                />

                {/* No projects warning */}
                {targetUserId && otherProjectsLoaded && otherProjects.length === 0 && !otherUserNotFound && (
                  <InlineWarning message={t('error.noRecipientProject')} />
                )}

                {/* No features warning */}
                {otherProjectId && otherFeaturesLoaded && otherFeatures.length === 0 && (
                  <InlineWarning message={t('error.noFeatureInProject')} />
                )}

              </>
            )}
          </div>
        )}
      </section>

      {/* ── 3. Transfer summary + [mode toggle] [button] ── */}
      <section className="space-y-2">
        {srcPaths.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {t('send.itemCount', { count: srcPaths.length })}
            </span>
            <ArrowRight className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {sendTarget === 'self'
                ? (destProjectId && destFeatureId ? `${destProjectId}/${destFeatureId}/` : t('send.destinationNotSelected'))
                : (targetUserId
                    ? `${targetUserId}/${otherProjectId || '…'}/${otherFeatureId || '…'}/`
                    : t('send.destinationNotSelected'))
              }
              <span className="text-gray-400 dark:text-gray-500">{t('send.samePath')}</span>
            </span>
          </div>
        )}

        {/* Split button: [전송하기 ▾] with mode dropdown + inline hint */}
        <div className="flex items-center gap-3">
          <SplitTransferButton
            mode={mode}
            onModeChange={setMode}
            onClick={handleTransfer}
            disabled={
              isLoading ||
              srcPaths.length === 0 ||
              (sendTarget === 'other' && (otherUserNotFound || !targetUserId || !otherProjectId || !otherFeatureId))
            }
            isLoading={isLoading}
            itemCount={srcPaths.length}
            modeLocked={sendTarget === 'other'}
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {sendTarget === 'self'
              ? t('confirm.selfTransferHint')
              : t('confirm.otherTransferHint')}
          </span>
        </div>
      </section>

      {/* ── 4. Sent requests history (filtered by current source project/feature) ── */}
      {sentRequests.filter(r =>
        r.source.projectId === srcProjectId && r.source.featureId === srcFeatureId
      ).length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('send.history')}</h4>
          <div className="space-y-2">
            {sentRequests
              .filter(r => r.source.projectId === srcProjectId && r.source.featureId === srcFeatureId)
              .map(req => (
                <SentRequestCard key={req.id} request={req} onCancel={handleCancel} onDelete={handleDelete} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Inline Project / Feature row ───
function InlineProjectFeature({
  projectValue, featureValue,
  projectOptions, featureOptions,
  onProjectChange, onFeatureChange,
  disableProject, disableFeature,
}: {
  projectValue: string;
  featureValue: string;
  projectOptions: string[];
  featureOptions: string[];
  onProjectChange: (v: string) => void;
  onFeatureChange: (v: string) => void;
  disableProject?: boolean;
  disableFeature?: boolean;
}) {
  const { t } = useTranslation('transfer');
  return (
    <div className="flex items-center gap-1.5 max-w-[420px]">
      <select
        value={projectValue}
        onChange={(e) => onProjectChange(e.target.value)}
        disabled={disableProject || projectOptions.length === 0}
        className={cn(
          'flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
          (disableProject || projectOptions.length === 0) && 'opacity-50 cursor-not-allowed'
        )}
      >
        <option value="">
          {disableProject ? '—' : projectOptions.length === 0 ? t('send.noProject') : t('send.selectProject')}
        </option>
        {projectOptions.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <span className="text-gray-400 dark:text-gray-500 text-sm">/</span>
      <select
        value={featureValue}
        onChange={(e) => onFeatureChange(e.target.value)}
        disabled={disableFeature || featureOptions.length === 0}
        className={cn(
          'flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
          (disableFeature || featureOptions.length === 0) && 'opacity-50 cursor-not-allowed'
        )}
      >
        <option value="">
          {disableFeature ? '—' : featureOptions.length === 0 ? t('send.noFeature') : t('send.selectFeature')}
        </option>
        {featureOptions.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
    </div>
  );
}

// ─── Sent request card ───
function SentRequestCard({ request, onCancel, onDelete }: {
  request: TransferRequest;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation('transfer');
  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-4 h-4 text-yellow-500" />,
    approved: <CheckCircle className="w-4 h-4 text-green-500" />,
    rejected: <XCircle className="w-4 h-4 text-red-500" />,
    cancelled: <Ban className="w-4 h-4 text-gray-400" />,
    expired: <Timer className="w-4 h-4 text-gray-400" />,
  };
  const timeAgo = getTimeAgo(request.createdAt, t);
  const isCompleted = request.status !== 'pending';

  return (
    <div className="group flex items-center justify-between text-sm py-2 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      <div className="flex items-center gap-2 min-w-0">
        {statusIcons[request.status] || null}
        <div className="flex flex-col min-w-0">
          <span className="text-gray-700 dark:text-gray-300 truncate">
            {request.source.path}
            {request.fileCount != null && request.fileCount > 0 && (
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                ({request.fileCount}개 파일)
              </span>
            )}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
            → {request.recipient.userId} / {request.destination.path}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-gray-400">{timeAgo}</span>
        {request.status === 'pending' && (
          <button className="text-xs text-red-500 hover:text-red-600 hover:underline"
            onClick={() => onCancel(request.id)}>{t('action.cancel')}</button>
        )}
        {isCompleted && (
          <button
            className="p-0.5 rounded text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDelete(request.id)}
            title={t('send.removeFromHistory')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Split Transfer Button (git merge style) ───
function SplitTransferButton({
  mode, onModeChange, onClick, disabled, isLoading, itemCount, modeLocked,
}: {
  mode: 'copy' | 'move';
  onModeChange: (m: 'copy' | 'move') => void;
  onClick: () => void;
  disabled: boolean;
  isLoading: boolean;
  itemCount: number;
  modeLocked?: boolean;
}) {
  const { t } = useTranslation('transfer');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.right - 160 });
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setIsDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isDropdownOpen]);

  const modeLabel = mode === 'copy' ? t('mode.copy') : t('mode.move');
  const buttonLabel = isLoading
    ? t('action.transferring')
    : `${modeLabel} ${t('action.transfer')}${itemCount > 0 ? ` (${itemCount})` : ''}`;

  const options: Array<{ value: 'copy' | 'move'; label: string; desc: string }> = [
    { value: 'copy', label: t('mode.copyTransfer'), desc: t('mode.copyDesc') },
    { value: 'move', label: t('mode.moveTransfer'), desc: t('mode.moveDesc') },
  ];

  // When modeLocked, render a simple button without dropdown
  if (modeLocked) {
    return (
      <Button
        size="sm"
        onClick={onClick}
        disabled={disabled}
      >
        {buttonLabel}
      </Button>
    );
  }

  return (
    <div className="inline-flex">
      {/* Main button */}
      <Button
        size="sm"
        onClick={onClick}
        disabled={disabled}
        className="rounded-r-none border-r-0"
      >
        {buttonLabel}
      </Button>
      {/* Dropdown trigger */}
      <Button
        ref={triggerRef}
        size="sm"
        disabled={disabled}
        className="rounded-l-none px-1.5"
        onClick={() => { updatePos(); setIsDropdownOpen(!isDropdownOpen); }}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </Button>

      {isDropdownOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1 animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ top: pos.top, left: pos.left }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              className={cn(
                'flex flex-col w-full px-3 py-2 text-left transition-colors',
                mode === opt.value
                  ? 'bg-blue-50 dark:bg-blue-950/50'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              )}
              onClick={() => { onModeChange(opt.value); setIsDropdownOpen(false); }}
            >
              <span className={cn(
                'text-sm font-medium',
                mode === opt.value
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300'
              )}>
                {opt.label}
                {mode === opt.value && <span className="ml-1.5 text-xs text-blue-500">✓</span>}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function getTimeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return t('common:time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common:time.hoursAgo', { count: hours });
  return t('common:time.daysAgo', { count: Math.floor(hours / 24) });
}

// ─── Inline Warning Banner ───
function InlineWarning({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <span className="text-xs text-amber-700 dark:text-amber-400">{message}</span>
    </div>
  );
}

/**
 * Filter file tree to only include artifact directories (inputs, outputs).
 * Excludes sessions and any non-canonical top-level entries (e.g., stray project dirs).
 * This matches ArtifactsPanel's filtering logic.
 */
const ALLOWED_TOP_LEVEL = new Set(['inputs', 'outputs']);

function filterArtifactDirs(tree: FileNode[]): FileNode[] {
  return tree.filter(node => ALLOWED_TOP_LEVEL.has(node.name));
}

