import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Folder, FolderOpen, ArrowLeftRight, Upload, X, Check, AlertCircle, AlertTriangle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, renameFileOrDirectory, getDownloadUrl, fetchTransferRequests, FileNode } from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { Button } from '@/presentation/components/aurora';
import { textColors, cn } from '@/shared/utils/design-system';
import { useNotifyArtifactMutationBlocked } from '@/application/hooks/ui/useNotifyArtifactMutationBlocked';
import { FileIcon } from '@/shared/utils/file-icons';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { FileActionMenu } from './FileActionMenu';
import { SectionShell, type SectionAccent } from './layout/Explorer/SectionShell';
import { RowList } from './layout/Explorer/RowList';
import { isCanonicalDir, isStructuralCanonicalDir, getArtifactDirPolicy, validateFileForDir } from '@/shared/utils/canonical-dirs';
import { ApiError } from '@/infrastructure/http/api/client';
import { extractDroppedFiles } from '@/application/hooks/ui/useDropZone';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { UploadConflictModal, type ConflictResolution } from '@/presentation/components/common/UploadConflictModal';
import { findConflicts, getAllExistingNames, applyPerFileResolutions, fileListToEntries } from '@/shared/utils/upload-utils';
import { UI_VISIBLE_TOP_LEVEL_DIRS, UI_VISIBLE_FILES, pruneFileTreeForWorkspaceDomain } from '@ant/shared';

const DRAG_EXPAND_DELAY_MS = 600;

/**
 * Top-level folder accent palette — ported from handoff `b3-explorer.jsx`
 * (`PROJECT_DOTS` + `DOMAIN_ACCENT`, L21–L37). The handoff used 4 raw oklch
 * literals (violet / pink / orange / cool); here we map each ant-ui
 * UI-visible top-level domain onto the aurora-tokens.css palette that is
 * actually defined for the build target (violet / pink / amber / teal).
 *
 * Spec §R2: domain hint chip removed — top-level folders are
 * distinguished by folder-icon accent color only. Nested children
 * inherit no accent (see `DirectoryView.renderNode`).
 */
const DOMAIN_ACCENT: Record<string, string> = {
  plan: 'var(--violet-500)',
  system: 'var(--pink-500)',
  spec: 'var(--amber-500)',
  ui: 'var(--pink-500)',
  'game-art': 'var(--amber-500)',
  data: 'var(--teal-500)',
  assets: 'var(--teal-500)',
  meta: 'var(--violet-500)',
  sessions: 'var(--teal-500)',
  // Legacy domain — kept so existing fixtures continue to render with the
  // pink accent the prior in-file map used.
  architecture: 'var(--pink-500)',
  visual: 'var(--amber-500)',
};

/**
 * Maps a top-level artifact domain onto the SectionShell `accent` palette
 * (handoff Explorer SectionShell only supports violet/pink/orange/cool).
 * SectionShell internally translates these to `--violet-500` / `--pink-500`
 * / `--orange-500` / `--teal-500`. `amber` (used by `DOMAIN_ACCENT` for the
 * folder-icon tint) maps to `orange`; `teal` to `cool`.
 */
const DOMAIN_SECTION_ACCENT: Record<string, SectionAccent> = {
  plan: 'violet',
  system: 'pink',
  spec: 'orange',
  ui: 'pink',
  'game-art': 'orange',
  data: 'cool',
  assets: 'cool',
  meta: 'violet',
  sessions: 'cool',
  architecture: 'pink',
  visual: 'orange',
};

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
            className="text-xs font-medium text-blue-600 hover:underline"
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

/**
 * TransferTinyButton — chrome-less header action button mirroring the
 * handoff TinyButton pattern (b3-explorer.jsx L78–L103). Hovers reveal
 * an orange-600 foreground over `var(--bg-hover)`; rest state is fully
 * transparent so the section header chrome stays quiet.
 */
function TransferTinyButton({
  isNarrow,
  title,
  label,
  onClick,
}: {
  isNarrow: boolean;
  title: string;
  label: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        height: 22,
        padding: isNarrow ? 0 : '0 8px',
        width: isNarrow ? 22 : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        background: hover ? 'var(--bg-hover)' : 'transparent',
        color: hover ? 'var(--orange-600)' : 'var(--text-3)',
        border: 'none',
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        flexShrink: 0,
        transition: 'all var(--dur-fast)',
      }}
    >
      <ArrowLeftRight size={12} />
      {!isNarrow && <span>{label}</span>}
    </button>
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
  fileIndicators?: Record<string, React.ReactNode>;
  sectionPrefix?: string;
  /** When returns true, mutation is blocked and a warning was shown — do not open delete confirm. */
  notifyArtifactMutationBlocked?: () => boolean;
}

function DirectoryView({ title, nodes, onFileSelect, selectedFile, onCreateFile, onCreateDirectory, onUploadFiles, onDropFiles, onRename, onDelete, onSend, onDownload, onDropError, isSessionSection, unseenArtifacts = [], onMarkSeen, fileIndicators, sectionPrefix, notifyArtifactMutationBlocked }: DirectoryViewProps) {
  const { t } = useTranslation('artifacts');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['plan', 'architecture', 'visual', 'assets', 'meta']));
  const highlightedDirs = useStore(s => s.highlightedArtifactDirs);
  const spotlightTarget = useStore(s => s.spotlightTarget);
  const clearSpotlightTarget = useStore(s => s.clearSpotlightTarget);

  // Spotlight relevance: when a spotlight target exists, this section is
  // "relevant" only if the target path belongs to this domain. Used both
  // as initial SectionShell expanded state and as part of the SectionShell
  // remount key so that switching spotlight targets re-applies the
  // expanded initial value.
  const belongsToSpotlight = !spotlightTarget
    ? true
    : !sectionPrefix
      ? true
      : spotlightTarget.path === sectionPrefix
        || spotlightTarget.path.startsWith(sectionPrefix + '/');

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
      return;
    }
    const targetPath = spotlightTarget.path;
    const belongsToThisSection = !sectionPrefix || targetPath.startsWith(sectionPrefix + '/') || targetPath === sectionPrefix;

    if (!belongsToThisSection) {
      // SectionShell remounts (key includes belongsToSpotlight) and collapses
      // via its `expanded={false}` initial when this section is off-target.
      setExpandedDirs(new Set());
      return;
    }

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
  // Per-row hover state — drives the violet wash + 3-dot reveal, mirrors
  // handoff `b3-explorer.jsx::FileTree` `activePath`.
  const [activePath, setActivePath] = useState<string | null>(null);
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
          className="flex-1 px-2 py-1 text-xs border border-[color:var(--border-2)] rounded bg-[color:var(--bg-surface)] text-[color:var(--text-1)]"
          autoFocus
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-green-600"
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
          className="h-6 w-6 p-0 text-red-600"
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
    const unseenCount = isDirectory ? getUnseenCount(node.path) : 0;
    // Top-level folder accent — only the section's domain root carries
    // an accent (`plan` / `system` / `spec` / `ui` / …); nested children
    // inherit no accent so the visual hierarchy stays subtle.
    // Mirrors handoff `b3-explorer.jsx::FileTree::renderNode` L750–L760.
    const topLevelKey = node.path.split('/')[0];
    const accentColor = currentLevel === 0 ? DOMAIN_ACCENT[topLevelKey] : undefined;
    const folderIconColor = accentColor ?? 'var(--text-3)';
    const isStructural = isDirectory && isStructuralCanonicalDir(node.path);
    const isDragTarget = isDirectory && dragOverPath === node.path;
    const isRenaming = renamingPath === node.path;
    const isHover = activePath === node.path;
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
          onMouseEnter={() => setActivePath(node.path)}
          onMouseLeave={() => setActivePath(prev => (prev === node.path ? null : prev))}
          className={cn(
            'flex items-center justify-between group',
            // Drag/menu/highlight visual state — Aurora violet/amber tokens applied inline; cn() palette literals fully purged (R7).
            isHighlighted && 'artifact-highlight',
            isSpotlighted && 'artifact-spotlight'
          )}
          style={(() => {
            // Base row style — selection, hover, layout (lowest precedence).
            const base: React.CSSProperties = {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: `4px 10px 4px ${10 + currentLevel * 14}px`,
              borderRadius: isSelected ? '0 var(--r-sm) var(--r-sm) 0' : 'var(--r-sm)',
              cursor: 'pointer',
              background: isSelected
                ? 'oklch(from var(--violet-300) l c h / 0.20)'
                : isHover
                  ? 'var(--bg-hover)'
                  : 'transparent',
              borderLeft: isSelected ? '2px solid var(--violet-500)' : '2px solid transparent',
              transition: 'background var(--dur-fast)',
              minHeight: 22,
            };
            // Highlight (lower than menu/drag — applied first so later overrides win).
            if (isHighlighted) {
              base.boxShadow = 'inset 0 0 0 1px var(--violet-300)';
            }
            // Menu-active state (overrides highlight; defers to drag below).
            if (isMenuActive && !isDragTarget) {
              if (isSelected) {
                base.boxShadow = 'inset 0 0 0 1px var(--violet-400)';
              } else {
                base.background = 'oklch(from var(--amber-500) l c h / 0.18)';
                base.boxShadow = 'inset 0 0 0 1px oklch(from var(--amber-500) l c h / 0.45)';
              }
            }
            // Drag-target state (highest precedence — overrides menu/highlight).
            if (isDragTarget && !isStructural) {
              base.background = 'oklch(from var(--violet-200) l c h / 0.30)';
              base.outline = '2px dashed var(--violet-400)';
              base.outlineOffset = '-2px';
            }
            return base;
          })()}
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
                <FolderOpen
                  size={12}
                  style={{ color: folderIconColor, flexShrink: 0 }}
                />
              ) : (
                <Folder
                  size={12}
                  style={{ color: folderIconColor, flexShrink: 0 }}
                />
              )
            ) : (
              <FileIcon filePath={node.name} size={12} />
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
                className="flex-1 min-w-0 px-1 py-0 text-sm rounded bg-[color:var(--bg-surface)] text-[color:var(--text-1)] outline-none"
                style={{ border: '1px solid var(--violet-400)' }}
                autoFocus
              />
            ) : (
              <>
                <span
                  className="font-mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11.5,
                    color: isSelected ? 'var(--violet-700)' : 'var(--text-2)',
                    fontWeight: isSelected ? 600 : isUnseen ? 700 : (currentLevel === 0 ? 600 : 500),
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.name}
                </span>
                {!isDirectory && fileIndicators?.[node.name]}
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
                  style={{
                    paddingTop: 2,
                    paddingBottom: 2,
                    paddingLeft: `${10 + (currentLevel + 1) * 14 + 18}px`,
                    fontSize: 10,
                    fontStyle: 'italic',
                    color: 'var(--text-4)',
                  }}
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

  // Hidden upload input — kept outside SectionShell so the action menu
  // (which lives in SectionShell's `action` slot) can still trigger it.
  const hiddenUploadInput = sectionPrefix && onUploadFiles && !rootIsStructural ? (
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
  ) : null;

  // Domain-root action menu (sessions/ is system-internal — never exposed).
  const headerAction = sectionPrefix && !isSessionSection ? (
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
  ) : null;

  // Drop wrapper — RowList provides only scroll/flex; drop chrome (dashed
  // border, tinted background, data-drop-* attrs, drag handlers) lives on
  // an outer wrapper so the visual surface mirrors handoff's chrome-less
  // explorer rows while still preserving the existing drag/drop policy.
  const dropWrapperStyle: React.CSSProperties = rootIsDragTarget
    ? rootIsStructural
      ? {
          border: '2px dashed var(--red-500)',
          borderRadius: 'var(--r-md)',
          transition: 'border-color var(--dur-fast), background var(--dur-fast)',
        }
      : {
          border: '2px dashed var(--violet-400)',
          borderRadius: 'var(--r-md)',
          background: 'oklch(from var(--violet-200) l c h / 0.18)',
          transition: 'border-color var(--dur-fast), background var(--dur-fast)',
        }
    : {
        border: '2px solid transparent',
        borderRadius: 'var(--r-md)',
        transition: 'border-color var(--dur-fast), background var(--dur-fast)',
      };

  return (
    <SectionShell
      // Remount when spotlight relevance flips so the new `expanded`
      // initial takes effect (SectionShell owns open/closed state
      // internally; the remount is the only safe way to overwrite it).
      key={`section-${sectionPrefix ?? 'root'}-${String(belongsToSpotlight)}`}
      eyebrow={title}
      accent={DOMAIN_SECTION_ACCENT[sectionPrefix ?? ''] ?? 'violet'}
      count={null}
      expanded={belongsToSpotlight}
      action={headerAction}
    >
      {hiddenUploadInput}
      <div
        style={dropWrapperStyle}
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
          <RowList ariaLabel={title} maxHeight={384}>
            {nodes.map((node) => renderNode(node, 0))}
          </RowList>
        )}
      </div>
    </SectionShell>
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

  const transferButton = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <TransferTinyButton
        isNarrow={isNarrow}
        title={t('panel.transfer')}
        label={t('panel.transfer')}
        onClick={() => openTransferTab({ subTab: pendingTransferCount > 0 ? 'receive' : 'send' })}
      />
      {pendingTransferCount > 0 && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            openTransferTab({ subTab: 'receive' });
          }}
          title={t('panel.transferPending', { count: pendingTransferCount, defaultValue: `${pendingTransferCount} pending` })}
          aria-label={`${pendingTransferCount} pending`}
          style={{
            minWidth: 16,
            height: 16,
            padding: '0 5px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--red-500)',
            color: 'var(--text-on-brand)',
            fontSize: 10,
            fontWeight: 800,
            borderRadius: 999,
            cursor: 'pointer',
            boxShadow: '0 0 10px color-mix(in srgb, var(--red-500) 45%, transparent)',
          }}
        >
          {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
        </span>
      )}
    </div>
  );

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <SectionShell
        eyebrow={t('panel.title')}
        accent="violet"
        count={null}
        action={transferButton}
      >
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
      </SectionShell>

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
                  ? 'border-[color:var(--status-done-fg)] bg-[color:var(--bg-surface)]'
                  : 'border-[color:var(--violet-500)] bg-[color:var(--bg-surface)]',
              )}
              onClick={uploadState.completed ? dismissUpload : undefined}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  'flex items-center gap-2 text-xs font-medium truncate',
                  uploadState.completed
                    ? 'text-[color:var(--status-done-fg)]'
                    : 'text-[color:var(--violet-700)]',
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
                  className="flex-shrink-0 ml-2 p-1 rounded-md hover:bg-[color:var(--bg-active)] text-[color:var(--text-4)] hover:text-[color:var(--text-3)] transition-colors"
                  title={uploadState.completed ? t('upload.dismiss') : t('upload.cancel')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div
                className="w-full h-2 rounded-full overflow-hidden"
                style={{
                  background: uploadState.completed
                    ? 'oklch(from var(--status-done-fg) l c h / 0.15)'
                    : 'var(--violet-100)',
                }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: uploadState.total > 0 ? `${Math.round((uploadState.loaded / uploadState.total) * 100)}%` : '0%',
                    background: uploadState.completed ? 'var(--status-done-fg)' : 'var(--violet-500)',
                  }}
                />
              </div>
              {uploadState.total > 0 && !uploadState.completed && (
                <div className="text-[10px] text-[color:var(--violet-500)] text-right font-medium">
                  {Math.round((uploadState.loaded / uploadState.total) * 100)}%
                </div>
              )}
            </div>
          )}
          {dropError && (
            <div
              className="relative rounded-xl border bg-[color:var(--bg-surface)] shadow-lg p-3 cursor-pointer transition-colors overflow-hidden"
              style={{ borderColor: 'var(--status-error-fg)' }}
              onClick={() => setDropError(null)}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-[color:var(--status-error-fg)]">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {dropError}
              </span>
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: 'oklch(from var(--status-error-fg) l c h / 0.15)' }}
              >
                <div
                  className="h-full"
                  style={{ background: 'var(--status-error-fg)', animation: 'shrink-progress 3000ms linear forwards' }}
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