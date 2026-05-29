
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { Button } from '@/presentation/components/aurora';
import { textColors, cn } from '@/shared/utils/design-system';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { SectionShell } from '../layout/Explorer/SectionShell';
import { RowList } from '../layout/Explorer/RowList';
import { ArtifactRow } from '../layout/Explorer/ArtifactRow';
import {
  isCanonicalDir,
  isStructuralCanonicalDir,
  getArtifactDirPolicy,
  validateFileForDir,
  DOMAIN_ACCENT_MAP,
  getDomainAccentColor,
  type SectionAccent,
} from '@/shared/utils/canonical-dirs';
import { extractDroppedFiles } from '@/application/hooks/ui/useDropZone';
import type { ArtifactPermissions } from '@ant/shared';

const DRAG_EXPAND_DELAY_MS = 600;

export interface ArtifactsSectionProps {
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
  unseenArtifacts?: string[];
  onMarkSeen?: (paths: string[]) => void;
  fileIndicators?: Record<string, React.ReactNode>;
  sectionPrefix?: string;
  collapsedLabel?: string;
  collapsedAction?: React.ReactNode;
  /**
   * Optional node rendered in the SectionShell header's right-aligned
   * `action` slot when the section is expanded — i.e. on the SAME line
   * as the eyebrow title. Used to host the Transfer toolbar inline with
   * the Artifacts header (directive: 헤더와 Transfer 버튼 동일 라인).
   */
  headerAction?: React.ReactNode;
  /** When returns true, mutation is blocked and a warning was shown — do not open delete confirm. */
  notifyArtifactMutationBlocked?: () => boolean;
  /**
   * Optional explicit accent for the SectionShell header. When omitted,
   * falls back to `DOMAIN_ACCENT_MAP[sectionPrefix]` (legacy per-domain
   * mount) or `'violet'`. The unified Artifacts mount in ArtifactsPanel
   * passes `accent="orange"` to match the handoff B3 chip color.
   */
  accent?: SectionAccent;
  /**
   * Resolves per-row mutation permissions in unified-tree mode. The
   * row's top-level path segment identifies the owning domain; the
   * returned ArtifactPermissions gates each FileActionMenu trigger
   * (create/upload/rename/delete/send/download) — `false` collapses
   * the corresponding menu entry just like the panel-level pre-gating
   * used to.
   */
  getNodePermissions?: (path: string) => ArtifactPermissions | undefined;
}

/**
 * Single-level artifact section — one domain root = one SectionShell.
 *
 * Composes a SectionShell wrapping (drop wrapper + RowList + inline
 * create form) as children. Children recursion (the intrinsically
 * recursive file tree) stays inside this component; each individual
 * row is delegated to <ArtifactRow />.
 */
export function ArtifactsSection({
  title,
  nodes,
  onFileSelect,
  selectedFile,
  onCreateFile,
  onCreateDirectory,
  onUploadFiles,
  onDropFiles,
  onRename,
  onDelete,
  onSend,
  onDownload,
  onDropError,
  unseenArtifacts = [],
  onMarkSeen,
  fileIndicators,
  sectionPrefix,
  collapsedLabel,
  collapsedAction,
  headerAction,
  notifyArtifactMutationBlocked,
  accent,
  getNodePermissions,
}: ArtifactsSectionProps) {
  const { t } = useTranslation('artifacts');
  // Initial expanded set is empty; the spotlight effect below runs on mount
  // and overwrites this within the first render cycle (either to the full
  // set of `nodes` paths when no spotlight, or to the required ancestor
  // chain when a spotlight target belongs to this section). Hardcoding
  // legacy single-tree top-level domain names here would leak section-foreign
  // paths into per-domain mounts (spec §5 T3 / G1).
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set<string>());
  const highlightedDirs = useStore((s) => s.highlightedArtifactDirs);
  const spotlightTarget = useStore((s) => s.spotlightTarget);
  const clearSpotlightTarget = useStore((s) => s.clearSpotlightTarget);

  const belongsToSpotlight = !spotlightTarget
    ? true
    : !sectionPrefix
      ? true
      : spotlightTarget.path === sectionPrefix ||
        spotlightTarget.path.startsWith(sectionPrefix + '/');

  useEffect(() => {
    if (highlightedDirs.length === 0) return;
    setExpandedDirs((prev) => {
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

  // Spotlight effect — reacts to `spotlightTarget` set transitions only.
  // Unions ancestor paths into `expandedDirs` (preserves user-expanded dirs)
  // and scrolls the spotlight target into view. `nodes` is intentionally
  // NOT in deps: data ref churn from the parent must not reset UI state.
  useEffect(() => {
    if (!spotlightTarget) return;
    const targetPath = spotlightTarget.path;
    const belongsToThisSection =
      !sectionPrefix || targetPath.startsWith(sectionPrefix + '/') || targetPath === sectionPrefix;
    if (!belongsToThisSection) return;

    const parts = targetPath.split('/');
    const depth = spotlightTarget.type === 'file' ? parts.length - 1 : parts.length;
    const requiredDirs: string[] = [];
    for (let i = 1; i <= depth; i++) {
      requiredDirs.push(parts.slice(0, i).join('/'));
    }
    setExpandedDirs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const d of requiredDirs) {
        if (!next.has(d)) {
          next.add(d);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    requestAnimationFrame(() => {
      const el = document.querySelector('[data-spotlight-path]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [spotlightTarget, sectionPrefix]);

  // First-populate effect — when nodes transition from empty to populated,
  // union the top-level paths into `expandedDirs` exactly once so the
  // canonical domain roots are open by default. Guarded by a ref so later
  // `nodes` ref changes (parent re-renders, fileTree refreshes) cannot
  // re-run the default and clobber user toggles.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (nodes.length === 0) return;
    initializedRef.current = true;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const n of nodes) next.add(n.path);
      return next;
    });
  }, [nodes]);

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
        setExpandedDirs((prev) => {
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
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        autoExpandedRef.current.forEach((p) => next.delete(p));
        return next;
      });
      autoExpandedRef.current.clear();
    }
  }, []);

  // Keep a ref to unseenArtifacts so cleanup can read the latest value
  const unseenRef = useRef(unseenArtifacts);
  unseenRef.current = unseenArtifacts;

  const getDirectChildUnseen = useCallback((dirPath: string): string[] => {
    return unseenRef.current.filter((p) => {
      if (!p.startsWith(dirPath + '/')) return false;
      const remainder = p.slice(dirPath.length + 1);
      return !remainder.includes('/');
    });
  }, []);

  const toggleDirectory = (dirPath: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(dirPath)) {
      if (onMarkSeen) {
        const childUnseen = getDirectChildUnseen(dirPath);
        if (childUnseen.length > 0) {
          onMarkSeen(childUnseen);
        }
      }
      newExpanded.delete(dirPath);
    } else {
      newExpanded.add(dirPath);
    }
    setExpandedDirs(newExpanded);
  };

  useEffect(() => {
    return () => {
      if (!onMarkSeen) return;
      const allChildUnseen: string[] = [];
      expandedDirs.forEach((dirPath) => {
        const children = unseenRef.current.filter((p) => {
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

  const getUnseenCount = (dirPath: string): number => {
    return unseenArtifacts.filter((p) => p.startsWith(dirPath + '/') || p === dirPath).length;
  };

  // ───────── Domain-root (section-level) policy ─────────
  // Header kebab menu is removed (reference b3-explorer has no section-level
  // ⋯ menu). Mutation entry points for the section root live exclusively on
  // each row's hover-revealed FileActionMenu; drag-and-drop upload onto the
  // section drop-zone is still supported below.
  const rootIsStructural = sectionPrefix ? isStructuralCanonicalDir(sectionPrefix) : false;

  const renderInlineCreateForm = (dirPath: string, paddingLeft: number) => (
    <div className="mt-1 mb-2" style={{ paddingLeft: `${paddingLeft}px` }}>
      <div className="flex items-center gap-2">
        <span className={cn('text-xs', textColors.tertiary)}>
          {createType === 'directory' ? '📁' : '📄'}
        </span>
        <input
          type="text"
          placeholder={createType === 'directory' ? 'folder-name' : 'filename.md'}
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

  const renderNode = (node: FileNode, currentLevel: number): React.ReactNode => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.type === 'file' && selectedFile === node.path;
    const isCreatingInThisDir = showCreateForm === node.path;
    const isDirectory = node.type === 'directory';
    const isMenuActive = activeMenuPath === node.path;
    const isUnseen = node.type === 'file' && unseenArtifacts.includes(node.path);
    const unseenCount = isDirectory ? getUnseenCount(node.path) : 0;
    const topLevelKey = node.path.split('/')[0];
    const accentColor = currentLevel === 0 ? getDomainAccentColor(topLevelKey) : undefined;
    const isStructural = isDirectory && isStructuralCanonicalDir(node.path);
    const isDragTarget = isDirectory && dragOverPath === node.path;
    const isRenaming = renamingPath === node.path;
    const isHighlighted = highlightedDirs.some(
      (d) => node.path === d || node.path.endsWith('/' + d),
    );
    const isSpotlighted = spotlightTarget?.path === node.path;

    const isSession = node.path.startsWith('sessions');
    const isClearable = isDirectory && isCanonicalDir(node.path);
    const uploadInputId = isDirectory && onUploadFiles ? `upload-${node.path}` : undefined;

    // Per-row permission gating (unified-tree mode). When
    // `getNodePermissions` is not supplied (legacy per-domain mount),
    // every gate defaults to `true` so behavior is unchanged.
    const rowPerms = getNodePermissions?.(node.path);
    const allowCreate = rowPerms?.create !== false;
    const allowUpload = rowPerms?.upload !== false;
    const allowRename = rowPerms?.rename !== false;
    const allowSend = rowPerms?.send !== false;
    const allowDelete = rowPerms?.delete !== false;
    const allowDownload = rowPerms?.download !== false;

    const menuProps = {
      isSessionPath: isSession,
      isClearableDir: isClearable,
      isProtectedDir: false,
      onSend: allowSend ? onSend : undefined,
      onDownload: allowDownload ? onDownload : undefined,
      onMarkAllSeen:
        isDirectory && unseenCount > 0 && onMarkSeen
          ? () => {
              const allUnseen = unseenArtifacts.filter(
                (p) => p.startsWith(node.path + '/') || p === node.path,
              );
              if (allUnseen.length > 0) {
                onMarkSeen(allUnseen);
              }
            }
          : undefined,
      onCreateFile:
        isDirectory && onCreateFile && !isStructural && allowCreate
          ? () => {
              setCreateType('file');
              setShowCreateForm(isCreatingInThisDir ? null : node.path);
              setNewFileName('');
            }
          : undefined,
      onCreateDirectory:
        isDirectory &&
        onCreateDirectory &&
        !isStructural &&
        allowCreate &&
        getArtifactDirPolicy(node.path)?.allowSubdirs !== false
          ? () => {
              setCreateType('directory');
              setShowCreateForm(isCreatingInThisDir ? null : node.path);
              setNewFileName('');
            }
          : undefined,
      onUpload:
        isDirectory && onUploadFiles && !isStructural && allowUpload
          ? () => document.getElementById(`upload-${node.path}`)?.click()
          : undefined,
      onRename:
        onRename && !isClearable && allowRename
          ? () => {
              setRenamingPath(node.path);
              setRenameValue(node.name);
            }
          : undefined,
      onDelete:
        onDelete && !isClearable && allowDelete
          ? () => {
              if (notifyArtifactMutationBlocked?.()) return;
              showConfirm(t('confirm.deleteItem', { type: node.type, name: node.name }), {
                type: 'warning',
                title: t('confirm.deleteTitle'),
                confirmText: t('confirm.deleteType', { type: node.type }),
                cancelText: t('common:button.cancel'),
                onConfirm: () => onDelete(node.path),
              });
            }
          : undefined,
      onClearContents:
        isClearable && onDelete && allowDelete
          ? () => {
              if (notifyArtifactMutationBlocked?.()) return;
              showConfirm(t('confirm.clearContentsDetail', { name: node.name }), {
                type: 'warning',
                title: t('confirm.clearContentsTitle'),
                confirmText: t('confirm.clearAll'),
                cancelText: t('common:button.cancel'),
                onConfirm: () => onDelete(node.path),
              });
            }
          : undefined,
    };

    return (
      <div
        key={node.path}
        data-drop-dir={isDirectory && onDropFiles ? node.path : undefined}
        data-drop-blocked={isDirectory && onDropFiles && isStructural ? '' : undefined}
        data-spotlight-path={isSpotlighted ? node.path : undefined}
      >
        {/* Hidden file input for uploads — kept adjacent to the row so the
            FileActionMenu's onUpload click handler can resolve it by id. */}
        {isDirectory && onUploadFiles && (
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

        <ArtifactRow
          node={node}
          level={currentLevel}
          isSelected={isSelected}
          isMenuActive={isMenuActive}
          isDragTarget={isDragTarget}
          isStructural={isStructural}
          isHighlighted={isHighlighted}
          isSpotlighted={isSpotlighted}
          isUnseen={isUnseen}
          unseenCount={unseenCount}
          accentColor={accentColor}
          fileIndicator={!isDirectory ? fileIndicators?.[node.name] : undefined}
          isRenaming={isRenaming}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameSubmit={() => {
            onRename?.(node.path, renameValue.trim());
            setRenamingPath(null);
          }}
          onRenameCancel={() => setRenamingPath(null)}
          onActivate={() => {
            if (isSpotlighted) clearSpotlightTarget();
            if (isDirectory) {
              toggleDirectory(node.path);
            } else {
              if (selectedFile === node.path) {
                onFileSelect('');
              } else {
                onFileSelect(node.path);
              }
            }
          }}
          uploadInputId={uploadInputId}
          onMenuOpenChange={(open) => setActiveMenuPath(open ? node.path : null)}
          menuProps={menuProps}
        />

        {isCreatingInThisDir && renderInlineCreateForm(node.path, (currentLevel + 1) * 12 + 8)}

        {isDirectory && isExpanded && node.children && (
          <div>
            {node.children.length > 0 ? (
              node.children.map((child) => renderNode(child, currentLevel + 1))
            ) : (
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
                {t('panel.emptyDir')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const rootDropEnabled = !!(sectionPrefix && onDropFiles);
  const rootIsDragTarget = rootDropEnabled && dragOverPath === sectionPrefix;

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
      key={`section-${sectionPrefix ?? 'root'}-${String(belongsToSpotlight)}`}
      eyebrow={title}
      accent={accent ?? DOMAIN_ACCENT_MAP[sectionPrefix ?? ''] ?? 'violet'}
      count={null}
      expanded={belongsToSpotlight}
      collapsedLabel={collapsedLabel}
      collapsedAction={collapsedAction}
      action={headerAction}
    >
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
        onDragLeave={
          onDropFiles
            ? (e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const { clientX, clientY } = e;
                if (
                  clientX <= rect.left ||
                  clientX >= rect.right ||
                  clientY <= rect.top ||
                  clientY >= rect.bottom
                ) {
                  clearDragState();
                }
              }
            : undefined
        }
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
                  if (
                    !validateFileForDir(dirPath, relPath.split('/').pop() || relPath).valid
                  ) {
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
                  onDropError?.(
                    t('error.uploadPartialBlocked', {
                      blocked: blocked.length,
                      total: entries.length,
                    }),
                  );
                }
                if (valid.length > 0) onDropFiles(dirPath, valid);
              } else {
                onDropFiles(dirPath, entries);
              }
            }
          }
        }}
      >
        {nodes.length === 0 ? (
          <div className={cn('text-sm p-2 text-center', textColors.tertiary)}>
            {t('panel.emptySection', { title: title.toLowerCase() })}
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
