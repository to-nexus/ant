import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Package, Folder, FolderOpen, ArrowUpRight, ArrowDownLeft, Upload, X, Check, AlertCircle, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, renameFileOrDirectory, getDownloadUrl, fetchTransferRequests, FileNode } from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { Button } from '@/presentation/components/common/button';
import { textColors, cn } from '@/shared/utils/design-system';
import { useNotifyArtifactMutationBlocked } from '@/application/hooks/ui/useNotifyArtifactMutationBlocked';
import { FileIcon } from '@/shared/utils/file-icons';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { FileActionMenu } from './FileActionMenu';
import { isCanonicalDir, isStructuralCanonicalDir, getArtifactDirPolicy, validateFileForDir } from '@/shared/utils/canonical-dirs';
import { ApiError } from '@/infrastructure/http/api/client';
import { extractDroppedFiles } from '@/application/hooks/ui/useDropZone';
import { HintBadge } from '@/presentation/components/common/HintBadge';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { UploadConflictModal, type ConflictResolution } from '@/presentation/components/common/UploadConflictModal';
import { findConflicts, getAllExistingNames, applyPerFileResolutions, fileListToEntries } from '@/shared/utils/upload-utils';
import { UI_VISIBLE_TOP_LEVEL_DIRS, UI_VISIBLE_FILES, pruneFileTreeForWorkspaceDomain } from '@ant/shared';

const DRAG_EXPAND_DELAY_MS = 600;

function FigmaIcon({ className, muted }: { className?: string; muted?: boolean }) {
  if (muted) {
    return (
      <svg className={className} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="currentColor" />
        <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="currentColor" />
        <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="currentColor" />
        <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="currentColor" />
        <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
      <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
      <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
      <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
      <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
    </svg>
  );
}

interface FigmaStatusIndicatorProps {
  isPopulated: boolean | null;
  bridgeConnected: boolean;
  figmaDesktopReachable: boolean;
  onOpenSettings: () => void;
  t: (key: string) => string;
}

function FigmaStatusIndicator({ isPopulated, bridgeConnected, figmaDesktopReachable, onOpenSettings, t }: FigmaStatusIndicatorProps) {
  if (isPopulated === null) return null;

  if (!isPopulated) {
    return (
      <Tooltip content={t('panel.figmaEmpty')} placement="right">
        <span className="inline-flex items-center flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        </span>
      </Tooltip>
    );
  }

  const isFullyConnected = bridgeConnected && figmaDesktopReachable;

  if (isFullyConnected) {
    return (
      <Tooltip content={t('panel.figmaConnected')} placement="right">
        <span className="inline-flex items-center gap-0.5 flex-shrink-0">
          <FigmaIcon className="w-3.5 h-3.5" />
          <Check className="w-2.5 h-2.5 text-green-500" />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      content={
        <div className="space-y-1.5">
          <div>{t('panel.figmaNotConnected')}</div>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t('panel.goToAccountSettings')}
          </button>
        </div>
      }
      placement="right"
    >
      <span className="inline-flex items-center gap-0.5 flex-shrink-0">
        <FigmaIcon className="w-3.5 h-3.5" />
        <X className="w-2.5 h-2.5 text-red-400" />
      </span>
    </Tooltip>
  );
}

function TemplateStatusIndicator({ reason, contentLength, threshold, t }: {
  reason?: string;
  contentLength?: number;
  threshold?: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  let tooltipContent: string;
  if (reason === 'marker_and_short_content' && contentLength !== undefined && threshold !== undefined) {
    tooltipContent = t('panel.templateReasonMarker', { contentLength, threshold });
  } else if (reason === 'file_empty') {
    tooltipContent = t('panel.templateReasonEmpty');
  } else {
    tooltipContent = t('panel.templateFile');
  }

  return (
    <Tooltip content={tooltipContent} placement="right">
      <span className="inline-flex items-center flex-shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
      </span>
    </Tooltip>
  );
}

interface DirectoryViewProps {
  title: string;
  nodes: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDirectory?: (dirPath: string, dirName: string) => void;
  onUploadFiles?: (dirPath: string, files: FileList) => void;
  onDropFiles?: (dirPath: string, entries: UploadFileEntry[]) => void;
  onRename?: (oldPath: string, newName: string) => void;
  onDelete?: (filePath: string) => void;
  onSend?: (path: string, type: 'file' | 'directory') => void;
  onDownload?: (path: string) => void;
  onDropError?: (message: string) => void;
  isSessionSection?: boolean;
  unseenArtifacts?: string[];
  onMarkSeen?: (paths: string[]) => void;
  isNarrow?: boolean;
  nodeHints?: Record<string, { label: string; tooltip: string; colorScheme?: 'gray' | 'purple' | 'amber' | 'blue' }>;
  fileIndicators?: Record<string, React.ReactNode>;
  sectionPrefix?: string;
  /** When returns true, mutation is blocked and a warning was shown — do not open delete confirm. */
  notifyArtifactMutationBlocked?: () => boolean;
}

function DirectoryView({ title, nodes, onFileSelect, selectedFile, onCreateFile, onCreateDirectory, onUploadFiles, onDropFiles, onRename, onDelete, onSend, onDownload, onDropError, isSessionSection, unseenArtifacts = [], onMarkSeen, isNarrow, nodeHints, fileIndicators, sectionPrefix, notifyArtifactMutationBlocked }: DirectoryViewProps) {
  const { t } = useTranslation('artifacts');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['plan', 'architecture', 'visual', 'assets', 'meta']));
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const highlightedDirs = useStore(s => s.highlightedArtifactDirs);
  const spotlightTarget = useStore(s => s.spotlightTarget);
  const clearSpotlightTarget = useStore(s => s.clearSpotlightTarget);

  useEffect(() => {
    if (highlightedDirs.length === 0) return;
    setExpandedDirs(prev => {
      const next = new Set(prev);
      for (const dir of highlightedDirs) {
        const parts = dir.split('/');
        for (let i = 1; i <= parts.length; i++) {
          next.add(parts.slice(0, i).join('/'));
        }
      }
      return next;
    });
  }, [highlightedDirs]);

  useEffect(() => {
    if (!spotlightTarget) {
      setExpandedDirs(new Set(nodes.map(n => n.path)));
      setSectionCollapsed(false);
      return;
    }
    const targetPath = spotlightTarget.path;
    const belongsToThisSection = !sectionPrefix || targetPath.startsWith(sectionPrefix + '/') || targetPath === sectionPrefix;

    if (!belongsToThisSection) {
      setSectionCollapsed(true);
      setExpandedDirs(new Set());
      return;
    }

    setSectionCollapsed(false);
    const parts = targetPath.split('/');
    const depth = spotlightTarget.type === 'file' ? parts.length - 1 : parts.length;
    const requiredDirs = new Set<string>();
    for (let i = 1; i <= depth; i++) {
      requiredDirs.add(parts.slice(0, i).join('/'));
    }
    setExpandedDirs(requiredDirs);

    requestAnimationFrame(() => {
      const el = document.querySelector('[data-spotlight-path]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [spotlightTarget, sectionPrefix]);
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [newFileName, setNewFileName] = useState('');
  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const { showConfirm } = useAlertModalContext();

  // Per-folder drag state — container-level approach using data-drop-dir attribute
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const dragOverPathRef = useRef<string | null>(null);
  const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandedRef = useRef<Set<string>>(new Set());

  const updateDragTarget = useCallback((dirPath: string | null) => {
    if (dirPath === dragOverPathRef.current) return;
    dragOverPathRef.current = dirPath;
    setDragOverPath(dirPath);

    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    if (dirPath) {
      dragExpandTimerRef.current = setTimeout(() => {
        setExpandedDirs(prev => {
          if (prev.has(dirPath)) return prev;
          const next = new Set(prev);
          next.add(dirPath);
          autoExpandedRef.current.add(dirPath);
          return next;
        });
      }, DRAG_EXPAND_DELAY_MS);
    }
  }, []);

  const clearDragState = useCallback(() => {
    dragOverPathRef.current = null;
    setDragOverPath(null);
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    if (autoExpandedRef.current.size > 0) {
      setExpandedDirs(prev => {
        const next = new Set(prev);
        autoExpandedRef.current.forEach(p => next.delete(p));
        return next;
      });
      autoExpandedRef.current.clear();
    }
  }, []);

  // Keep a ref to unseenArtifacts so cleanup can read the latest value
  const unseenRef = useRef(unseenArtifacts);
  unseenRef.current = unseenArtifacts;

  // Helper: get direct-child unseen file paths under a directory
  const getDirectChildUnseen = useCallback((dirPath: string): string[] => {
    return unseenRef.current.filter(p => {
      if (!p.startsWith(dirPath + '/')) return false;
      const remainder = p.slice(dirPath.length + 1);
      return !remainder.includes('/'); // direct children only
    });
  }, []);

  const toggleDirectory = (dirPath: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(dirPath)) {
      // COLLAPSING: mark direct child files as seen (user already saw them)
      if (onMarkSeen) {
        const childUnseen = getDirectChildUnseen(dirPath);
        if (childUnseen.length > 0) {
          onMarkSeen(childUnseen);
        }
      }
      newExpanded.delete(dirPath);
    } else {
      // EXPANDING: red dots remain visible — user sees them first
      newExpanded.add(dirPath);
    }
    setExpandedDirs(newExpanded);
  };

  // Cleanup on unmount: mark expanded directories' direct children as seen
  useEffect(() => {
    return () => {
      if (!onMarkSeen) return;
      const allChildUnseen: string[] = [];
      expandedDirs.forEach(dirPath => {
        const children = unseenRef.current.filter(p => {
          if (!p.startsWith(dirPath + '/')) return false;
          const remainder = p.slice(dirPath.length + 1);
          return !remainder.includes('/');
        });
        allChildUnseen.push(...children);
      });
      if (allChildUnseen.length > 0) {
        onMarkSeen(allChildUnseen);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: count unseen files under a directory path
  const getUnseenCount = (dirPath: string): number => {
    return unseenArtifacts.filter(p => p.startsWith(dirPath + '/') || p === dirPath).length;
  };

  // ───────── Domain-root (section-level) policy ─────────
  // sectionPrefix 가 'plan' / 'architecture' 같은 도메인 루트를 가리킨다.
  // 헤더 액션 메뉴와 컨테이너 fallback drop 둘 다 이 정책으로 분기한다.
  const rootIsStructural = sectionPrefix ? isStructuralCanonicalDir(sectionPrefix) : false;
  const rootIsClearable = sectionPrefix ? isCanonicalDir(sectionPrefix) : false;
  const rootAllowSubdirs = sectionPrefix
    ? getArtifactDirPolicy(sectionPrefix)?.allowSubdirs !== false
    : false;
  const isRootCreating = sectionPrefix !== undefined && showCreateForm === sectionPrefix;

  // Inline create-form renderer — shared between child rows and domain-root header.
  // paddingLeft is the only thing that differs (child rows indent by depth;
  // domain-root form sits flush at the container top).
  const renderInlineCreateForm = (dirPath: string, paddingLeft: number) => (
    <div className="mt-1 mb-2" style={{ paddingLeft: `${paddingLeft}px` }}>
      <div className="flex items-center gap-2">
        <span className={cn('text-xs', textColors.tertiary)}>
          {createType === 'directory' ? '📁' : '📄'}
        </span>
        <input
          type="text"
          placeholder={createType === 'directory' ? "folder-name" : "filename.md"}
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFileName.trim()) {
              if (createType === 'directory') {
                onCreateDirectory?.(dirPath, newFileName.trim());
              } else {
                onCreateFile?.(dirPath, newFileName.trim());
              }
              setNewFileName('');
              setShowCreateForm(null);
            }
            if (e.key === 'Escape') {
              setShowCreateForm(null);
              setNewFileName('');
            }
          }}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          autoFocus
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-green-600 dark:text-green-400"
          onClick={() => {
            if (newFileName.trim()) {
              if (createType === 'directory') {
                onCreateDirectory?.(dirPath, newFileName.trim());
              } else {
                onCreateFile?.(dirPath, newFileName.trim());
              }
              setNewFileName('');
              setShowCreateForm(null);
            }
          }}
        >
          ✓
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-red-600 dark:text-red-400"
          onClick={() => {
            setShowCreateForm(null);
            setNewFileName('');
          }}
        >
          ✕
        </Button>
      </div>
    </div>
  );

  const renderNode = (node: FileNode, currentLevel: number) => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.type === 'file' && selectedFile === node.path;
    const isCreatingInThisDir = showCreateForm === node.path;
    const isDirectory = node.type === 'directory';
    const isMenuActive = activeMenuPath === node.path;
    const isUnseen = node.type === 'file' && unseenArtifacts.includes(node.path);
    const hint = isDirectory && nodeHints ? nodeHints[node.name] : undefined;
    const unseenCount = isDirectory ? getUnseenCount(node.path) : 0;
    const isStructural = isDirectory && isStructuralCanonicalDir(node.path);
    const isDragTarget = isDirectory && dragOverPath === node.path;
    const isRenaming = renamingPath === node.path;
    const isHighlighted = highlightedDirs.some(d => node.path === d || node.path.endsWith('/' + d));
    const isSpotlighted = spotlightTarget?.path === node.path;

    return (
      <div
        key={node.path}
        data-drop-dir={isDirectory && onDropFiles ? node.path : undefined}
        data-drop-blocked={isDirectory && onDropFiles && isStructural ? '' : undefined}
        data-spotlight-path={isSpotlighted ? node.path : undefined}
      >
        <div
          className={cn(
            'flex items-center justify-between group py-1.5 px-2 rounded transition-colors',
            isSelected 
              ? 'bg-blue-100 dark:bg-blue-900 border-l-2 border-blue-500 dark:border-blue-400 font-medium text-blue-900 dark:text-blue-100' 
              : isDragTarget && !isStructural
                ? 'bg-blue-50 dark:bg-blue-900/30 outline-2 outline-dashed outline-blue-400 dark:outline-blue-500'
                : isDirectory && isExpanded
                  ? 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800',
            isMenuActive && !isDragTarget && (isSelected
              ? 'ring-1 ring-blue-400 dark:ring-blue-500'
              : 'bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-300 dark:ring-amber-600'),
            isHighlighted && 'artifact-highlight ring-1 ring-blue-300 dark:ring-blue-600',
            isSpotlighted && 'artifact-spotlight'
          )}
          style={{ paddingLeft: `${currentLevel * 12 + 8}px` }}
        >
          <div 
            className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
            onClick={() => {
              if (isSpotlighted) clearSpotlightTarget();
              if (node.type === 'directory') {
                toggleDirectory(node.path);
              } else {
                if (selectedFile === node.path) {
                  onFileSelect('');
                } else {
                  onFileSelect(node.path);
                }
              }
            }}
          >
            {node.type === 'directory' ? (
              isExpanded ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
              )
            ) : (
              <FileIcon filePath={node.name} size={16} />
            )}
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameValue.trim() && renameValue.trim() !== node.name) {
                    onRename?.(node.path, renameValue.trim());
                    setRenamingPath(null);
                  } else if (e.key === 'Enter') {
                    setRenamingPath(null);
                  }
                  if (e.key === 'Escape') setRenamingPath(null);
                }}
                onBlur={() => {
                  if (renameValue.trim() && renameValue.trim() !== node.name) {
                    onRename?.(node.path, renameValue.trim());
                  }
                  setRenamingPath(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 px-1 py-0 text-sm border border-blue-400 dark:border-blue-500 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
                autoFocus
              />
            ) : (
              <>
                <span className={cn('text-sm truncate', textColors.primary, isUnseen && 'font-semibold')}>{node.name}</span>
                {hint && (
                  <HintBadge
                    label={hint.label}
                    tooltip={hint.tooltip}
                    isCompact={isNarrow}
                    colorScheme={hint.colorScheme}
                    placement="right"
                  />
                )}
                {!isDirectory && fileIndicators?.[node.name]}
                {isDirectory && unseenCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white flex-shrink-0">
                    {unseenCount > 99 ? '99+' : unseenCount}
                  </span>
                )}
                {isUnseen && (
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                )}
              </>
            )}
          </div>
          
          {/* Hidden file input for uploads */}
          {node.type === 'directory' && onUploadFiles && (
            <input
              type="file"
              multiple
              className="hidden"
              id={`upload-${node.path}`}
              accept={getArtifactDirPolicy(node.path)?.acceptedExtensions?.join(',') || undefined}
              onChange={(e) => {
                if (e.target.files && onUploadFiles) {
                  onUploadFiles(node.path, e.target.files);
                  e.target.value = '';
                }
              }}
            />
          )}
          <div className={cn("flex items-center gap-1 transition-opacity", isMenuActive ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
            {(() => {
              const isSession = isSessionSection || node.path.startsWith('sessions');
              const isClearable = node.type === 'directory' && isCanonicalDir(node.path);
              const isProtected = false;

              return (
                <FileActionMenu
                  nodePath={node.path}
                  nodeType={node.type as 'file' | 'directory'}
                  nodeName={node.name}
                  isSessionPath={isSession}
                  isProtectedDir={isProtected}
                  isClearableDir={isClearable}
                  onSend={onSend}
                  onDownload={onDownload}
                  onMarkAllSeen={isDirectory && unseenCount > 0 && onMarkSeen ? () => {
                    const allUnseen = unseenArtifacts.filter(p => p.startsWith(node.path + '/') || p === node.path);
                    if (allUnseen.length > 0) {
                      onMarkSeen(allUnseen);
                    }
                  } : undefined}
                  onCreateFile={node.type === 'directory' && onCreateFile && !isStructural ? () => {
                    setCreateType('file');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  } : undefined}
                  onCreateDirectory={node.type === 'directory' && onCreateDirectory && !isStructural && getArtifactDirPolicy(node.path)?.allowSubdirs !== false ? () => {
                    setCreateType('directory');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  } : undefined}
                  onUpload={node.type === 'directory' && onUploadFiles && !isStructural ? () => {
                    document.getElementById(`upload-${node.path}`)?.click();
                  } : undefined}
                  onRename={onRename && !isClearable ? () => {
                    setRenamingPath(node.path);
                    setRenameValue(node.name);
                  } : undefined}
                  onDelete={onDelete && !isClearable ? () => {
                    if (notifyArtifactMutationBlocked?.()) return;
                    showConfirm(t('confirm.deleteItem', { type: node.type, name: node.name }), {
                      type: 'warning',
                      title: t('confirm.deleteTitle'),
                      confirmText: t('confirm.deleteType', { type: node.type }),
                      cancelText: t('common:button.cancel'),
                      onConfirm: () => onDelete(node.path)
                    });
                  } : undefined}
                  onClearContents={isClearable && onDelete ? () => {
                    if (notifyArtifactMutationBlocked?.()) return;
                    showConfirm(t('confirm.clearContentsDetail', { name: node.name }), {
                      type: 'warning',
                      title: t('confirm.clearContentsTitle'),
                      confirmText: t('confirm.clearAll'),
                      cancelText: t('common:button.cancel'),
                      onConfirm: () => onDelete(node.path)
                    });
                  } : undefined}
                  onOpenChange={(open) => setActiveMenuPath(open ? node.path : null)}
                />
              );
            })()}
          </div>
        </div>
        
        {isCreatingInThisDir && renderInlineCreateForm(node.path, (currentLevel + 1) * 12 + 8)}

        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.length > 0
              ? node.children.map((child) => renderNode(child, currentLevel + 1))
              : (
                <div
                  className={cn('py-1 text-[11px] italic', textColors.tertiary)}
                  style={{ paddingLeft: `${(currentLevel + 1) * 12 + 8}px` }}
                >
                  {t(`panel.dirAccepted.${node.name}`, { defaultValue: '' }) || t('panel.emptyDir')}
                </div>
              )
            }
          </div>
        )}
      </div>
    );
  };

  const rootDropEnabled = !!(sectionPrefix && onDropFiles);
  const rootIsDragTarget = rootDropEnabled && dragOverPath === sectionPrefix;

  return (
    <div>
      <div className="flex items-center mb-2 gap-1">
        <button
          type="button"
          onClick={() => setSectionCollapsed(prev => !prev)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {sectionCollapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
          <span className="font-medium text-sm text-gray-700 dark:text-gray-300">{title}</span>
        </button>
        {/* Hidden upload input for the domain-root header menu */}
        {sectionPrefix && onUploadFiles && !rootIsStructural && (
          <input
            type="file"
            multiple
            className="hidden"
            id={`upload-${sectionPrefix}`}
            accept={getArtifactDirPolicy(sectionPrefix)?.acceptedExtensions?.join(',') || undefined}
            onChange={(e) => {
              if (e.target.files && onUploadFiles) {
                onUploadFiles(sectionPrefix, e.target.files);
                e.target.value = '';
              }
            }}
          />
        )}
        {/* sessions/ is system-internal — never expose section-level mutation menu */}
        {!sectionCollapsed && sectionPrefix && !isSessionSection && (
          <FileActionMenu
            nodePath={sectionPrefix}
            nodeType="directory"
            nodeName={sectionPrefix}
            isSessionPath={false}
            isClearableDir={rootIsClearable}
            onUpload={onUploadFiles && !rootIsStructural ? () => {
              document.getElementById(`upload-${sectionPrefix}`)?.click();
            } : undefined}
            onCreateFile={onCreateFile && !rootIsStructural ? () => {
              setCreateType('file');
              setShowCreateForm(showCreateForm === sectionPrefix ? null : sectionPrefix);
              setNewFileName('');
            } : undefined}
            onCreateDirectory={onCreateDirectory && !rootIsStructural && rootAllowSubdirs ? () => {
              setCreateType('directory');
              setShowCreateForm(showCreateForm === sectionPrefix ? null : sectionPrefix);
              setNewFileName('');
            } : undefined}
            onClearContents={rootIsClearable && onDelete ? () => {
              if (notifyArtifactMutationBlocked?.()) return;
              showConfirm(t('confirm.clearContentsDetail', { name: sectionPrefix }), {
                type: 'warning',
                title: t('confirm.clearContentsTitle'),
                confirmText: t('confirm.clearAll'),
                cancelText: t('common:button.cancel'),
                onConfirm: () => onDelete(sectionPrefix)
              });
            } : undefined}
            onOpenChange={(open) => setActiveMenuPath(open ? sectionPrefix : null)}
          />
        )}
      </div>
      {sectionCollapsed ? null : <div
        className={cn(
          'rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 max-h-96 overflow-y-auto scrollbar-hide border-2 transition-colors',
          rootIsDragTarget
            ? rootIsStructural
              ? 'border-dashed border-red-400 dark:border-red-500'
              : 'border-dashed border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20'
            : 'border-transparent ring-1 ring-gray-200 dark:ring-gray-700',
        )}
        data-drop-dir={rootDropEnabled ? sectionPrefix : undefined}
        data-drop-blocked={rootDropEnabled && rootIsStructural ? '' : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (onDropFiles) {
            const target = (e.target as HTMLElement).closest('[data-drop-dir]');
            updateDragTarget(target?.getAttribute('data-drop-dir') ?? null);
          }
        }}
        onDragLeave={onDropFiles ? (e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const { clientX, clientY } = e;
          if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
            clearDragState();
          }
        } : undefined}
        onDrop={async (e) => {
          e.preventDefault();
          clearDragState();
          if (!onDropFiles) {
            onDropError?.(t('error.dropBlockedSection'));
            return;
          }
          const target = (e.target as HTMLElement).closest('[data-drop-dir]');
          if (target?.hasAttribute('data-drop-blocked')) {
            onDropError?.(t('error.dropBlockedCanonical'));
            return;
          }
          const dirPath = target?.getAttribute('data-drop-dir');
          if (dirPath) {
            const entries = await extractDroppedFiles(e.dataTransfer);
            if (entries.length > 0) {
              // Validate entries against artifact dir policy
              const policy = getArtifactDirPolicy(dirPath);
              if (policy) {
                const valid: typeof entries = [];
                const blocked: typeof entries = [];
                for (const entry of entries) {
                  const relPath = entry.relativePath.replace(/\\/g, '/');
                  if (!policy.allowSubdirs && relPath.includes('/')) {
                    blocked.push(entry);
                    continue;
                  }
                  if (!validateFileForDir(dirPath, relPath.split('/').pop() || relPath).valid) {
                    blocked.push(entry);
                    continue;
                  }
                  valid.push(entry);
                }
                if (blocked.length > 0) {
                  if (valid.length === 0) {
                    const allowed = policy.acceptedExtensions?.join(', ') || '';
                    onDropError?.(t('error.invalidExtension', { dir: dirPath, allowed }));
                    return;
                  }
                  onDropError?.(t('error.uploadPartialBlocked', { blocked: blocked.length, total: entries.length }));
                }
                if (valid.length > 0) onDropFiles(dirPath, valid);
              } else {
                onDropFiles(dirPath, entries);
              }
            }
          }
        }}
      >
        {/* Domain-root inline create form (shown when "..." menu's Create File/Folder is clicked on the section header) */}
        {isRootCreating && sectionPrefix && renderInlineCreateForm(sectionPrefix, 8)}
        {nodes.length === 0 ? (
          <div className={cn('text-sm p-2 text-center', textColors.tertiary)}>
            No files in {title.toLowerCase()}
          </div>
        ) : (
          nodes.map((node) => renderNode(node, 0))
        )}
      </div>}
    </div>
  );
}

export function ArtifactsPanel({ explorerWidth }: { explorerWidth: number }) {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileTree = useStore((state) => state.fileTree);
  const selectFile = useStore((state) => state.selectFile);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const isSessionRestoring = useStore((state) => state.isSessionRestoring);
  const openTransferTab = useStore((state) => state.openTransferTab);
  const pendingTransferCount = useStore((state) => state.pendingTransferCount);
  const setPendingTransferCount = useStore((state) => state.setPendingTransferCount);
  const unseenArtifacts = useStore((state) => state.unseenArtifacts) as string[];
  const markArtifactsSeen = useStore((state) => state.markArtifactsSeen);
  const bridgeConnected = useStore((state) => state.bridgeConnected);
  const figmaDesktopReachable = useStore((state) => state.figmaDesktopReachable);
  const setAccountConfigScrollTarget = useStore((state) => state.setAccountConfigScrollTarget);
  
  const notifyArtifactMutationBlocked = useNotifyArtifactMutationBlocked();
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('artifacts');

  // Hide button labels when explorer is narrow
  const isNarrow = explorerWidth < 260;

  // Drop error notification (shown in the same bottom-center area as upload progress)
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDropError = useCallback((message: string) => {
    if (dropErrorTimerRef.current) clearTimeout(dropErrorTimerRef.current);
    setDropError(message);
    dropErrorTimerRef.current = setTimeout(() => setDropError(null), 3000);
  }, []);

  // Figma config state — from Zustand store (updated by SSE fileTree handler + direct save)
  const figmaPopulated = useStore((state) => state.figmaPopulated);
  const refreshFigmaPopulated = useStore((state) => state.refreshFigmaPopulated);
  const workspaceDomain = useStore((state) => state.actionMetadata?.domain);

  useEffect(() => {
    refreshFigmaPopulated();
  }, [selectedProject, selectedFeature]);

  // Refresh file tree after session restore completes.
  // connectionStatus-based refresh is handled by useFileTree hook (FeatureDetails);
  // this effect only covers post-session-restore refresh (e.g. after Git branch switch).
  useEffect(() => {
    if (!selectedProject || !selectedFeature) return;
    if (connectionStatus !== 'connected') return;
    if (isSessionRestoring) return;

    refreshFileTree();
  }, [selectedProject, selectedFeature, isSessionRestoring, refreshFileTree]);

  // Fetch pending transfer count when connection is ready and session restore is complete
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    if (!selectedProject || !selectedFeature) return;
    if (isSessionRestoring) return;
    fetchTransferRequests('received')
      .then(({ pendingCount }) => setPendingTransferCount(pendingCount))
      .catch(() => {});
  }, [connectionStatus, selectedProject, selectedFeature, isSessionRestoring, setPendingTransferCount]);

  // Note: Real-time file tree updates are now handled by the unified SSE connection in the store

  const format422Error = (error: ApiError, dirPath: string): string => {
    if (error.code === 'INVALID_EXTENSION' && error.allowed)
      return t('error.invalidExtension', { dir: dirPath, allowed: error.allowed.join(', ') });
    if (error.code === 'SUBDIRS_NOT_ALLOWED')
      return t('error.subdirsNotAllowed', { dir: dirPath });
    return error.message;
  };

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, dirPath), { title: t('common:error.title') });
      } else {
        console.error('Failed to create file:', error);
        showError(t('error.fileCreateFailed'), { title: t('common:error.title') });
      }
    }
  };

  const handleCreateDirectory = async (dirPath: string, dirName: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    try {
      const fullPath = `${dirPath}/${dirName}`;
      await createDirectory(selectedProject, selectedFeature, fullPath);
      await refreshFileTree();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, dirPath), { title: t('common:error.title') });
      } else {
        console.error('Failed to create directory:', error);
        showError(t('error.dirCreateFailed'), { title: t('common:error.title') });
      }
    }
  };

  const handleDelete = async (itemPath: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await deleteFileOrDirectory(selectedProject, selectedFeature, itemPath);

      const staleUnseen = unseenArtifacts.filter(
        p => p === itemPath || p.startsWith(itemPath + '/')
      );
      if (staleUnseen.length > 0) {
        markArtifactsSeen(staleUnseen);
      }

      await refreshFileTree({ force: false });
      if (selectedFile === itemPath) {
        selectFile('');
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError(t('error.deleteFailed'), { title: t('common:error.title') });
    }
  };

  const handleRename = async (oldPath: string, newName: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;

    if (oldPath === newPath) return;

    try {
      await renameFileOrDirectory(selectedProject, selectedFeature, oldPath, newPath);
      await refreshFileTree();
      if (selectedFile === oldPath) {
        selectFile(newPath);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, parentDir), { title: t('common:error.title') });
      } else {
        console.error('Failed to rename:', error);
        showError(t('error.renameFailed'), { title: t('common:error.title') });
      }
    }
  };

  const handleFileSelect = (path: string) => {
    // DirectoryView uses '' to mean deselect
    selectFile(path);
    if (path && path.length > 0) {
      openMainPanelTab('fileEdit');
      // Mark file as seen if it's in the unseen list
      if (unseenArtifacts?.includes(path)) {
        markArtifactsSeen([path]);
      }
    }
  };

  const handleSend = (path: string, type: 'file' | 'directory') => {
    if (!selectedProject || !selectedFeature) return;
    openTransferTab({
      subTab: 'send',
      preselectedSource: {
        projectId: selectedProject,
        featureId: selectedFeature,
        path,
        type,
      },
    });
  };

  const handleDownload = (path: string) => {
    if (!selectedProject || !selectedFeature) return;
    const url = getDownloadUrl(selectedProject, selectedFeature, path);
    window.open(url, '_blank');
  };

  // ── Upload state (progress + cancel) ─────────────────────────────
  const [uploadState, setUploadState] = useState<{
    loaded: number;
    total: number;
    fileCount: number;
    targetDir: string;
    completed?: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Upload conflict modal state ────────────────────────────────
  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    conflictingFiles: string[];
    dirPath: string;
    entries: UploadFileEntry[];
  }>({ isOpen: false, conflictingFiles: [], dirPath: '', entries: [] });

  const dismissUpload = useCallback(() => {
    if (lingerTimerRef.current) { clearTimeout(lingerTimerRef.current); lingerTimerRef.current = null; }
    setUploadState(null);
  }, []);

  const doUpload = useCallback(async (
    dirPath: string,
    files: UploadFileEntry[],
  ) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    const count = files.length;
    const controller = new AbortController();
    abortRef.current = controller;
    dismissUpload();
    setUploadState({ loaded: 0, total: 0, fileCount: count, targetDir: dirPath });

    try {
      await uploadFiles(selectedProject, selectedFeature, dirPath, files, {
        onProgress: (loaded, total) => setUploadState(prev => prev ? { ...prev, loaded, total } : prev),
        signal: controller.signal,
      });
      await refreshFileTree();
      setUploadState(prev => prev ? { ...prev, loaded: prev.total, completed: true } : prev);
      lingerTimerRef.current = setTimeout(dismissUpload, 3000);
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        console.log('[Upload] Cancelled by user');
      } else if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, dirPath), { title: t('common:error.title') });
      } else {
        console.error('Failed to upload files:', error);
        showError(t('error.uploadFailed'), { title: t('common:error.title') });
      }
      setUploadState(null);
    } finally {
      abortRef.current = null;
    }
  }, [selectedProject, selectedFeature, refreshFileTree, showError, t, dismissUpload, notifyArtifactMutationBlocked]);

  const checkConflictsAndUpload = useCallback((
    dirPath: string,
    entries: UploadFileEntry[],
  ) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!fileTree) {
      doUpload(dirPath, entries);
      return;
    }
    const conflicts = findConflicts(fileTree, dirPath, entries);
    if (conflicts.length === 0) {
      doUpload(dirPath, entries);
      return;
    }
    setConflictModal({ isOpen: true, conflictingFiles: conflicts, dirPath, entries });
  }, [fileTree, doUpload, notifyArtifactMutationBlocked]);

  const handleConflictResolve = useCallback((resolution: ConflictResolution) => {
    const { dirPath, entries } = conflictModal;
    setConflictModal(prev => ({ ...prev, isOpen: false }));

    if (resolution === 'cancel') return;

    const existingNames = fileTree ? getAllExistingNames(fileTree, dirPath) : [];
    const finalEntries = applyPerFileResolutions(entries, resolution.perFile, existingNames);
    doUpload(dirPath, finalEntries);
  }, [conflictModal, doUpload, fileTree]);

  const handleUploadFiles = useCallback((dirPath: string, files: FileList) => {
    checkConflictsAndUpload(dirPath, fileListToEntries(files));
  }, [checkConflictsAndUpload]);

  const handleDropFiles = useCallback((dirPath: string, entries: UploadFileEntry[]) => {
    checkConflictsAndUpload(dirPath, entries);
  }, [checkConflictsAndUpload]);

  const handleCancelUpload = useCallback(() => {
    if (uploadState?.completed) {
      dismissUpload();
    } else {
      abortRef.current?.abort();
    }
  }, [uploadState?.completed, dismissUpload]);

  const prunedFileTree = useMemo(
    () => (fileTree?.length ? pruneFileTreeForWorkspaceDomain(fileTree, workspaceDomain) : fileTree),
    [fileTree, workspaceDomain],
  );

  // Don't show if no feature is selected (must be after all hooks — prunedFileTree useMemo above)
  if (!selectedProject || !selectedFeature) {
    return null;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Domain-grouped top-level views.
  // Each visibility tag (`ui:plan` / `ui:architecture` / `ui:visual` /
  // `ui:assets` / `ui:meta`) is rendered as its own DirectoryView, plus
  // a fixed `sessions/` section. The grouping is pulled from the
  // canonical SSOT (`UI_VISIBLE_TOP_LEVEL_DIRS`) so adding a new
  // top-level dir auto-renders here once tagged.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const topLevelByName = new Map(prunedFileTree?.map(n => [n.name, n]) ?? []);
  const visibleTopLevelDirs = UI_VISIBLE_TOP_LEVEL_DIRS;

  const planNode = topLevelByName.get('plan');
  const planTemplateFiles = planNode?.children
    ?.filter(n => n.type === 'file' && n.meta?.isTemplate) || [];

  const sessionsNodes = topLevelByName.get('sessions')?.children || [];

  const dirHints: Record<string, { label: string; tooltip: string; colorScheme?: 'gray' | 'purple' | 'amber' | 'blue' }> = {
    plan: { label: t('panel.dirHint.plan'), tooltip: t('panel.dirHintTooltip.plan'), colorScheme: 'amber' },
    architecture: { label: t('panel.dirHint.architecture'), tooltip: t('panel.dirHintTooltip.architecture'), colorScheme: 'blue' },
    visual: { label: t('panel.dirHint.visual'), tooltip: t('panel.dirHintTooltip.visual'), colorScheme: 'blue' },
    assets: { label: t('panel.dirHint.assets'), tooltip: t('panel.dirHintTooltip.assets'), colorScheme: 'purple' },
    meta: { label: t('panel.dirHint.meta'), tooltip: t('panel.dirHintTooltip.meta'), colorScheme: 'gray' },
  };

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <h3 className="flex items-center justify-between text-sm font-semibold text-gray-900 dark:text-white">
        <span className="flex items-center gap-2 min-w-0">
          <Package className="h-4 w-4 shrink-0" />
          <span className="truncate">{t('panel.title')}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <button
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            onClick={() => openTransferTab({ subTab: 'send' })}
            title={t('panel.send')}
          >
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            {!isNarrow && <span>{t('panel.send')}</span>}
          </button>
          <button
            className="relative inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            onClick={() => openTransferTab({ subTab: 'receive' })}
            title={t('panel.receive')}
          >
            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />
            {!isNarrow && <span>{t('panel.receive')}</span>}
            {pendingTransferCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
              </span>
            )}
          </button>
        </span>
      </h3>
      <div className="space-y-3">
        {visibleTopLevelDirs.map(({ name }) => {
          const dirNode = topLevelByName.get(name);
          const childNodes = dirNode?.children || [];
          // figma.json is a top-level UI-visible file at the workspace root —
          // when present it's surfaced inside its own dir node so panels stay
          // domain-grouped instead of dropping a loose file into the tree.
          const visibleFilesUnderRoot = childNodes.filter(
            c => c.type === 'file' || UI_VISIBLE_FILES.includes(c.name) || true,
          );
          // Plan section gets the template-status indicators.
          const fileIndicators =
            name === 'plan'
              ? Object.fromEntries(
                  planTemplateFiles.map(n => [
                    n.name,
                    <TemplateStatusIndicator
                      key={n.name}
                      reason={n.meta?.templateReason ?? undefined}
                      contentLength={n.meta?.templateContentLength}
                      threshold={n.meta?.templateThreshold}
                      t={t}
                    />,
                  ]),
                )
              : name === 'visual'
                ? {
                    'figma.json': (
                      <FigmaStatusIndicator
                        isPopulated={figmaPopulated}
                        bridgeConnected={bridgeConnected === true}
                        figmaDesktopReachable={figmaDesktopReachable}
                        onOpenSettings={() => {
                          openMainPanelTab('accountConfig');
                          setAccountConfigScrollTarget('figma');
                        }}
                        t={t}
                      />
                    ),
                  }
                : undefined;

          return (
            <DirectoryView
              key={name}
              title={t(`panel.${name}`, name)}
              nodes={visibleFilesUnderRoot}
              sectionPrefix={name}
              onFileSelect={handleFileSelect}
              selectedFile={selectedFile}
              onCreateFile={handleCreateFile}
              onCreateDirectory={handleCreateDirectory}
              onUploadFiles={handleUploadFiles}
              onDropFiles={handleDropFiles}
              onRename={handleRename}
              onDelete={handleDelete}
              onSend={handleSend}
              onDownload={handleDownload}
              isNarrow={isNarrow}
              nodeHints={dirHints[name] ? { [name]: dirHints[name] } : undefined}
              onDropError={showDropError}
              unseenArtifacts={unseenArtifacts}
              onMarkSeen={markArtifactsSeen}
              notifyArtifactMutationBlocked={notifyArtifactMutationBlocked}
              fileIndicators={fileIndicators}
            />
          );
        })}
        <DirectoryView
          title={t('panel.sessions')}
          nodes={sessionsNodes}
          sectionPrefix="sessions"
          onFileSelect={selectFile}
          selectedFile={selectedFile}
          onCreateFile={undefined}
          onCreateDirectory={undefined}
          onUploadFiles={undefined}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onDropError={showDropError}
          isSessionSection={true}
          notifyArtifactMutationBlocked={notifyArtifactMutationBlocked}
        />

      </div>

      {/* Upload conflict modal */}
      <UploadConflictModal
        isOpen={conflictModal.isOpen}
        onClose={() => setConflictModal(prev => ({ ...prev, isOpen: false }))}
        conflictingFiles={conflictModal.conflictingFiles}
        onResolve={handleConflictResolve}
      />

      {/* Upload progress toast – fixed bottom-center via portal */}
      {/* Bottom-center portal: upload progress OR drop error */}
      {(uploadState || dropError) && createPortal(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-80 flex flex-col gap-2">
          {uploadState && (
            <div
              className={cn(
                'rounded-xl border shadow-lg p-3 space-y-2 cursor-pointer transition-colors',
                uploadState.completed
                  ? 'border-green-200 dark:border-green-700 bg-white dark:bg-gray-900'
                  : 'border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900',
              )}
              onClick={uploadState.completed ? dismissUpload : undefined}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  'flex items-center gap-2 text-xs font-medium truncate',
                  uploadState.completed
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-blue-700 dark:text-blue-300',
                )}>
                  {uploadState.completed
                    ? <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    : <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                  }
                  {uploadState.completed
                    ? t('upload.complete', { count: uploadState.fileCount })
                    : t('upload.uploading', { count: uploadState.fileCount, dir: uploadState.targetDir })
                  }
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCancelUpload(); }}
                  className="flex-shrink-0 ml-2 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title={uploadState.completed ? t('upload.dismiss') : t('upload.cancel')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className={cn(
                'w-full h-2 rounded-full overflow-hidden',
                uploadState.completed ? 'bg-green-100 dark:bg-green-900' : 'bg-blue-100 dark:bg-blue-900',
              )}>
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-200',
                    uploadState.completed ? 'bg-green-500 dark:bg-green-400' : 'bg-blue-500 dark:bg-blue-400',
                  )}
                  style={{ width: uploadState.total > 0 ? `${Math.round((uploadState.loaded / uploadState.total) * 100)}%` : '0%' }}
                />
              </div>
              {uploadState.total > 0 && !uploadState.completed && (
                <div className="text-[10px] text-blue-500 dark:text-blue-400 text-right font-medium">
                  {Math.round((uploadState.loaded / uploadState.total) * 100)}%
                </div>
              )}
            </div>
          )}
          {dropError && (
            <div
              className="relative rounded-xl border border-red-200 dark:border-red-700 bg-white dark:bg-gray-900 shadow-lg p-3 cursor-pointer transition-colors overflow-hidden"
              onClick={() => setDropError(null)}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {dropError}
              </span>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-100 dark:bg-red-900/50">
                <div
                  className="h-full bg-red-500 dark:bg-red-400"
                  style={{ animation: 'shrink-progress 3000ms linear forwards' }}
                />
              </div>
              <style>{`@keyframes shrink-progress{from{width:100%}to{width:0%}}`}</style>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}