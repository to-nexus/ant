
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
import { FileActionMenu } from '../FileActionMenu';
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
import { useFilePicker } from '@/application/hooks/ui/useFilePicker';
import { fileListToEntries, normalizeRelativePath } from '@/shared/utils/upload-utils';
import type { ArtifactDirPolicy, ArtifactPermissions } from '@ant/shared';

const DRAG_EXPAND_DELAY_MS = 600;

export interface ArtifactsSectionProps {
  title: string;
  nodes: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDirectory?: (dirPath: string, dirName: string) => void;
  /**
   * The one upload sink. Drop and the ⋯ menu's file/folder pickers all
   * arrive here as entries whose `relativePath` carries the folder
   * structure, already filtered against the directory's policy.
   */
  onUploadEntries?: (dirPath: string, entries: UploadFileEntry[]) => void;
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
  /**
   * When set, the section root itself is a writable directory: the header
   * gains a FileActionMenu (⋯) with create-file / create-folder / upload
   * targeting this path, and the inline create form can render at root.
   * Codespace mounts omit it (their root rows are fixed canonical domains);
   * the universal workspace passes `''` (the artifacts root).
   */
  rootDirPath?: string;
  /**
   * Per-directory policy resolver. Defaults to the canonical
   * `getArtifactDirPolicy`; the universal workspace passes its own table
   * (e.g. `plan` allows subdirs there) — codespace behavior is unchanged.
   */
  resolveDirPolicy?: (path: string) => ArtifactDirPolicy | null;
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
  onUploadEntries,
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
  rootDirPath,
  resolveDirPolicy = getArtifactDirPolicy,
}: ArtifactsSectionProps) {
  const { t } = useTranslation('artifacts');
  // `expandedDirs` is lifted to the zustand store so it survives transient
  // remounts of ArtifactsSection / ArtifactsPanel (e.g. when ExplorerPanel
  // briefly drops its children during a connectionStatus flicker). The five
  // mutation channels below all dispatch through ref-stable store actions
  // with no-op guards, so a parent re-render never wipes user expansion.
  const expandedDirs = useStore((s) => s.expandedArtifactDirs);
  const resetArtifactExpansion = useStore((s) => s.resetArtifactExpansion);
  const revealNewArtifactTopLevelDirs = useStore((s) => s.revealNewArtifactTopLevelDirs);
  const unionExpandedArtifactDirs = useStore((s) => s.unionExpandedArtifactDirs);
  const removeExpandedArtifactDirs = useStore((s) => s.removeExpandedArtifactDirs);
  const toggleExpandedArtifactDir = useStore((s) => s.toggleExpandedArtifactDir);
  const highlightedDirs = useStore((s) => s.highlightedArtifactDirs);
  const artifactUploadRequest = useStore((s) => s.artifactUploadRequest);
  const clearArtifactUploadRequest = useStore((s) => s.clearArtifactUploadRequest);
  const spotlightTarget = useStore((s) => s.spotlightTarget);
  const clearSpotlightTarget = useStore((s) => s.clearSpotlightTarget);
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);

  const [pickerNode, openPicker] = useFilePicker();

  /**
   * The single gate every upload passes — drop and picker alike. Entries the
   * directory's policy refuses (a sub-path where subdirs are banned, a
   * disallowed extension) are dropped with the same message the drop path has
   * always shown; a picker that bypassed this would be a hole, since
   * `webkitdirectory` makes the browser ignore `accept`.
   */
  const submitEntries = (dirPath: string, entries: UploadFileEntry[]) => {
    if (!onUploadEntries || entries.length === 0) return;
    const policy = resolveDirPolicy(dirPath);
    if (!policy) {
      onUploadEntries(dirPath, entries);
      return;
    }

    const valid: UploadFileEntry[] = [];
    let blocked = 0;
    for (const entry of entries) {
      const relPath = normalizeRelativePath(entry.relativePath);
      const name = relPath.split('/').pop() || relPath;
      if ((!policy.allowSubdirs && relPath.includes('/')) || !validateFileForDir(dirPath, name).valid) {
        blocked++;
        continue;
      }
      valid.push({ ...entry, relativePath: relPath });
    }

    if (blocked > 0) {
      if (valid.length === 0) {
        const allowed = policy.acceptedExtensions?.join(', ') || '';
        onDropError?.(t('error.invalidExtension', { dir: dirPath, allowed }));
        return;
      }
      onDropError?.(t('error.uploadPartialBlocked', { blocked, total: entries.length }));
    }
    if (valid.length > 0) onUploadEntries(dirPath, valid);
  };

  const pickAndUpload = (dirPath: string, directory: boolean) =>
    openPicker((files) => submitEntries(dirPath, fileListToEntries(files)), {
      directory,
      // Browsers ignore `accept` in folder mode — submitEntries filters instead.
      accept: directory ? undefined : resolveDirPolicy(dirPath)?.acceptedExtensions?.join(','),
    });

  /** May this directory receive an upload at all — the one owner of that predicate. */
  const canUploadTo = (path: string) =>
    !!onUploadEntries &&
    !isStructuralCanonicalDir(path) &&
    getNodePermissions?.(path)?.upload !== false;

  const canUploadFolderTo = (path: string) =>
    canUploadTo(path) && resolveDirPolicy(path)?.allowSubdirs !== false;

  const belongsToSpotlight = !spotlightTarget
    ? true
    : !sectionPrefix
      ? true
      : spotlightTarget.path === sectionPrefix ||
        spotlightTarget.path.startsWith(sectionPrefix + '/');

  // A request from outside the tree (the Actions panel's per-directory upload
  // button) opens THIS section's picker. `seq` is the trigger, so the same
  // directory can be asked for twice.
  useEffect(() => {
    const req = artifactUploadRequest;
    if (!req) return;
    const owned = !sectionPrefix || req.dirPath === sectionPrefix || req.dirPath.startsWith(sectionPrefix + '/');
    if (!owned) return;
    clearArtifactUploadRequest();
    if (canUploadTo(req.dirPath)) pickAndUpload(req.dirPath, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactUploadRequest?.seq]);

  // [trace] Diagnostic — observe ArtifactsSection mount/unmount in dev so the
  // unmount-trigger (connectionStatus flicker, conditional render churn, etc.)
  // can be pinpointed. Remove after Phase 3 fix lands.
  useEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[trace] ArtifactsSection mounted', Math.round(performance.now()));
      return () => {
        // eslint-disable-next-line no-console
        console.log('[trace] ArtifactsSection unmounted', Math.round(performance.now()));
      };
    }
  }, []);

  // Project / feature change → clear stale expand state from the previous
  // workspace. Uses a ref-based diff so the effect is a no-op on every other
  // re-render (and crucially on remounts where the deps haven't actually
  // changed — those must preserve the lifted state).
  const prevProjectRef = useRef(selectedProject);
  const prevFeatureRef = useRef(selectedFeature);
  useEffect(() => {
    if (
      prevProjectRef.current !== selectedProject ||
      prevFeatureRef.current !== selectedFeature
    ) {
      resetArtifactExpansion();
    }
    prevProjectRef.current = selectedProject;
    prevFeatureRef.current = selectedFeature;
  }, [selectedProject, selectedFeature, resetArtifactExpansion]);

  useEffect(() => {
    if (highlightedDirs.length === 0) return;
    const ancestors: string[] = [];
    for (const dir of highlightedDirs) {
      const parts = dir.split('/');
      for (let i = 1; i <= parts.length; i++) {
        ancestors.push(parts.slice(0, i).join('/'));
      }
    }
    unionExpandedArtifactDirs(ancestors);
  }, [highlightedDirs, unionExpandedArtifactDirs]);

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
    unionExpandedArtifactDirs(requiredDirs);

    requestAnimationFrame(() => {
      const el = document.querySelector('[data-spotlight-path]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [spotlightTarget, sectionPrefix, unionExpandedArtifactDirs]);

  // A root-level directory that appears mid-job (an agent's mkdir or
  // run_command output) must become visible without a browser refresh, while a
  // dir the user deliberately collapsed must stay collapsed. The store action
  // unions ONLY paths absent from `seenArtifactTopLevelDirs`, so a tick that
  // changes nothing is a no-op and every subscriber stays ref-stable. The
  // first populate still expands the whole top level, as before.
  //
  // Files are filtered out: only the universal root is free-form enough to hold
  // them, and a file path in the expanded set is a dead key.
  useEffect(() => {
    revealNewArtifactTopLevelDirs(
      nodes.filter((n) => n.type === 'directory').map((n) => n.path),
    );
  }, [nodes, revealNewArtifactTopLevelDirs]);

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

  const updateDragTarget = useCallback(
    (dirPath: string | null) => {
      if (dirPath === dragOverPathRef.current) return;
      dragOverPathRef.current = dirPath;
      setDragOverPath(dirPath);

      if (dragExpandTimerRef.current) {
        clearTimeout(dragExpandTimerRef.current);
        dragExpandTimerRef.current = null;
      }
      if (dirPath) {
        dragExpandTimerRef.current = setTimeout(() => {
          const current = useStore.getState().expandedArtifactDirs;
          if (current.has(dirPath)) return;
          autoExpandedRef.current.add(dirPath);
          unionExpandedArtifactDirs([dirPath]);
        }, DRAG_EXPAND_DELAY_MS);
      }
    },
    [unionExpandedArtifactDirs],
  );

  const clearDragState = useCallback(() => {
    dragOverPathRef.current = null;
    setDragOverPath(null);
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    if (autoExpandedRef.current.size > 0) {
      removeExpandedArtifactDirs(Array.from(autoExpandedRef.current));
      autoExpandedRef.current.clear();
    }
  }, [removeExpandedArtifactDirs]);

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
    if (expandedDirs.has(dirPath) && onMarkSeen) {
      // closing — mark direct unseen children seen before collapsing.
      const childUnseen = getDirectChildUnseen(dirPath);
      if (childUnseen.length > 0) {
        onMarkSeen(childUnseen);
      }
    }
    toggleExpandedArtifactDir(dirPath);
  };

  useEffect(() => {
    return () => {
      if (!onMarkSeen) return;
      // Read the latest expanded set from the store at unmount time. The
      // local `expandedDirs` capture would be stale because this effect runs
      // exactly once (deps=[]) — and after lifting, the store is the SSOT.
      const latest = useStore.getState().expandedArtifactDirs;
      const allChildUnseen: string[] = [];
      latest.forEach((dirPath) => {
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
    // Per-row permission gating (unified-tree mode). When
    // `getNodePermissions` is not supplied (legacy per-domain mount),
    // every gate defaults to `true` so behavior is unchanged.
    const rowPerms = getNodePermissions?.(node.path);
    const allowCreate = rowPerms?.create !== false;
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
        resolveDirPolicy(node.path)?.allowSubdirs !== false
          ? () => {
              setCreateType('directory');
              setShowCreateForm(isCreatingInThisDir ? null : node.path);
              setNewFileName('');
            }
          : undefined,
      onUpload: isDirectory && canUploadTo(node.path) ? () => pickAndUpload(node.path, false) : undefined,
      onUploadFolder:
        isDirectory && canUploadFolderTo(node.path) ? () => pickAndUpload(node.path, true) : undefined,
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
        data-drop-dir={isDirectory && onUploadEntries ? node.path : undefined}
        data-drop-blocked={isDirectory && onUploadEntries && isStructural ? '' : undefined}
        data-spotlight-path={isSpotlighted ? node.path : undefined}
      >
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

  // Root-writable mode (rootDirPath) shares the drop-dir plumbing with the
  // legacy per-domain mount (sectionPrefix). Note rootDirPath may be '' —
  // presence checks below must not be truthiness checks.
  const rootDropDir = sectionPrefix ?? rootDirPath;
  const rootDropEnabled = rootDropDir !== undefined && !!onUploadEntries;
  const rootIsDragTarget = rootDropEnabled && dragOverPath === rootDropDir;

  const isCreatingAtRoot = rootDirPath !== undefined && showCreateForm === rootDirPath;
  const rootPath = rootDirPath as string;
  const rootMenu =
    rootDirPath !== undefined ? (
      <FileActionMenu
        nodePath={rootDirPath}
        nodeType="directory"
        isSessionPath={false}
        onCreateFile={
          onCreateFile
            ? () => {
                setCreateType('file');
                setShowCreateForm(isCreatingAtRoot ? null : rootDirPath);
                setNewFileName('');
              }
            : undefined
        }
        onCreateDirectory={
          onCreateDirectory
            ? () => {
                setCreateType('directory');
                setShowCreateForm(isCreatingAtRoot ? null : rootDirPath);
                setNewFileName('');
              }
            : undefined
        }
        onUpload={canUploadTo(rootPath) ? () => pickAndUpload(rootPath, false) : undefined}
        onUploadFolder={
          canUploadFolderTo(rootPath) ? () => pickAndUpload(rootPath, true) : undefined
        }
      />
    ) : undefined;

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
      expanded={belongsToSpotlight}
      collapsedLabel={collapsedLabel}
      collapsedAction={collapsedAction}
      action={
        rootMenu ? (
          <>
            {headerAction}
            {rootMenu}
          </>
        ) : (
          headerAction
        )
      }
      fill
    >
      {pickerNode}
      <div
        style={{ ...dropWrapperStyle, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        data-drop-dir={rootDropEnabled ? rootDropDir : undefined}
        data-drop-blocked={rootDropEnabled && rootIsStructural ? '' : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (onUploadEntries) {
            const target = (e.target as HTMLElement).closest('[data-drop-dir]');
            updateDragTarget(target?.getAttribute('data-drop-dir') ?? null);
          }
        }}
        onDragLeave={
          onUploadEntries
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
          if (!onUploadEntries) {
            onDropError?.(t('error.dropBlockedSection'));
            return;
          }
          const target = (e.target as HTMLElement).closest('[data-drop-dir]');
          if (target?.hasAttribute('data-drop-blocked')) {
            onDropError?.(t('error.dropBlockedCanonical'));
            return;
          }
          const dirPath = target?.getAttribute('data-drop-dir');
          if (dirPath != null) {
            submitEntries(dirPath, await extractDroppedFiles(e.dataTransfer));
          }
        }}
      >
        {isCreatingAtRoot && renderInlineCreateForm(rootDirPath!, 8)}
        {nodes.length === 0 ? (
          <div className={cn('text-sm p-2 text-center', textColors.tertiary)}>
            {t('panel.emptySection', { title: title.toLowerCase() })}
          </div>
        ) : (
          <RowList ariaLabel={title} fill>
            {nodes.map((node) => renderNode(node, 0))}
          </RowList>
        )}
      </div>
    </SectionShell>
  );
}
