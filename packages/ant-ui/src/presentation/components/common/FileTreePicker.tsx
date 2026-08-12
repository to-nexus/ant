/**
 * FileTreePicker — folder-hierarchy, multi-select file picker in a Modal.
 *
 * Unified picker for adding arbitrary workspace files to a RAC ref/context
 * slot. Replaces the flat file listing that both the action-tab wizard and the
 * chat `@ref:`/`@ctx:` mention used to show — a folder tree lets users pick
 * systematically (the flat list made "which folder is this in?" impossible).
 *
 * - Multi-select (`Set<string>`); a folder row's checkbox toggles every
 *   descendant file (folder-unit selection).
 * - `suggestedDirs` files are marked with ★ and their folders auto-expand.
 * - Domain isolation is the CALLER's responsibility: pass a `fileTree` already
 *   run through `pruneFileTreeForWorkspaceDomain` so `assets/<other-domain>`
 *   never shows (Asset Surface Boundary I6). Callers get that from the
 *   `useArtifactPickerTree` hook so every entry point prunes identically.
 * - Confirm REPLACES the field, so an already-selected path this tree cannot
 *   represent is carried through rather than deleted (`preserveHiddenSelections`).
 * - Single-select mode (`singleSelect`) mirrors the revise-target contract.
 */

import { useMemo, useState } from 'react';
import { Folder, FolderOpen, Check, Search, Minus } from 'lucide-react';
import { collectRepresentablePaths, preserveHiddenSelections } from '@/shared/utils/selectionDisplay';
import { Modal } from './Modal';
import { FileIcon } from '@/shared/utils/file-icons';
import { cn } from '@/shared/utils/design-system';
import type { FileNode } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';
import type { ModalAccent } from './Modal';

interface FileTreePickerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Small uppercase pill above the title (e.g. "REF" / "CONTEXT"). */
  eyebrow?: string;
  accent?: ModalAccent;
  /** Already domain-pruned workspace tree (caller runs the prune). */
  fileTree: FileNode[];
  /** Pre-checked paths (current slot selection). */
  initialSelected: string[];
  /** Slot candidate dirs — files under these get a ★ and auto-expand. */
  suggestedDirs?: string[];
  /** Which node types are selectable. Default: files only. */
  selectableTypes?: ('file' | 'directory')[];
  /** Paths whose subtree is never shown (e.g. sessions/). */
  excludePatterns?: string[];
  singleSelect?: boolean;
  onConfirm: (paths: string[]) => void;
}

function filterNodes(nodes: FileNode[], patterns: string[]): FileNode[] {
  return nodes
    .filter(node => !patterns.some(p => node.path === p.replace(/\/$/, '') || node.path.startsWith(p)))
    .map(node => ({
      ...node,
      children: node.children ? filterNodes(node.children, patterns) : undefined,
    }));
}

/** All file paths under a node (recursive). */
function collectFiles(node: FileNode): string[] {
  if (node.type === 'file') return [node.path];
  return (node.children ?? []).flatMap(collectFiles);
}

/** Does any file path in the subtree match the query? (keeps folders that contain matches visible) */
function subtreeMatches(node: FileNode, q: string): boolean {
  if (!q) return true;
  if (node.path.toLowerCase().includes(q)) return true;
  return (node.children ?? []).some(c => subtreeMatches(c, q));
}

export function FileTreePicker({
  isOpen,
  onClose,
  title,
  eyebrow,
  accent = 'violet',
  fileTree,
  initialSelected,
  suggestedDirs = [],
  selectableTypes = ['file'],
  excludePatterns = ['sessions/'],
  singleSelect = false,
  onConfirm,
}: FileTreePickerProps) {
  const { t } = useTranslation('common');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [query, setQuery] = useState('');

  const nodes = useMemo(() => filterNodes(fileTree, excludePatterns), [fileTree, excludePatterns]);

  // Auto-expand suggested dirs (and their ancestors) so candidates are visible.
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const dir of suggestedDirs) {
      const parts = dir.split('/');
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
    }
    return set;
  }, [suggestedDirs]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const q = query.trim().toLowerCase();
  const isSuggested = (path: string) => suggestedDirs.some(d => path === d || path.startsWith(d + '/'));

  const toggleDir = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const toggleFile = (path: string) => {
    setSelected(prev => {
      if (singleSelect) return prev.has(path) ? new Set() : new Set([path]);
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const toggleFolder = (node: FileNode) => {
    const files = collectFiles(node);
    if (files.length === 0) return;
    setSelected(prev => {
      const allSelected = files.every(f => prev.has(f));
      const next = new Set(prev);
      if (allSelected) files.forEach(f => next.delete(f));
      else files.forEach(f => next.add(f));
      return next;
    });
  };

  const renderNode = (node: FileNode, level: number): React.ReactElement | null => {
    if (q && !subtreeMatches(node, q)) return null;
    const isDir = node.type === 'directory';
    const canSelectFile = !isDir && selectableTypes.includes('file');
    const canSelectDir = isDir && selectableTypes.includes('directory');
    const open = expanded.has(node.path) || (!!q && isDir);

    let folderState: 'none' | 'all' | 'some' = 'none';
    if (isDir && !singleSelect) {
      const files = collectFiles(node);
      const sel = files.filter(f => selected.has(f)).length;
      folderState = sel === 0 ? 'none' : sel === files.length ? 'all' : 'some';
    }
    const fileSelected = !isDir && selected.has(node.path);

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-2 py-1 px-2 rounded text-sm transition-colors',
            fileSelected
              ? 'bg-[color:var(--select-fill-violet)] text-[color:var(--select-fg)]'
              : (isDir || canSelectFile)
              ? 'hover:bg-[color:var(--bg-hover)] text-[color:var(--text-2)] cursor-pointer'
              : 'text-[color:var(--text-4)] cursor-default',
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (isDir) toggleDir(node.path);
            else if (canSelectFile) toggleFile(node.path);
          }}
        >
          {/* Folder multi-select checkbox (multi mode only) */}
          {isDir && !singleSelect && collectFiles(node).length > 0 && (
            <button
              type="button"
              className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
              style={{
                borderColor: folderState === 'none' ? 'var(--border-2)' : 'var(--violet-500)',
                background: folderState === 'none' ? 'transparent' : 'var(--violet-500)',
                color: 'white',
              }}
              title={t('fileTreePicker.toggleFolder')}
              onClick={(e) => { e.stopPropagation(); toggleFolder(node); }}
            >
              {folderState === 'all' && <Check className="w-3 h-3" />}
              {folderState === 'some' && <Minus className="w-3 h-3" />}
            </button>
          )}
          {isDir ? (
            open
              ? <FolderOpen className="w-4 h-4 text-[color:var(--violet-500)] flex-shrink-0" />
              : <Folder className="w-4 h-4 text-[color:var(--violet-500)] flex-shrink-0" />
          ) : (
            <span className="flex-shrink-0"><FileIcon filePath={node.name} size={16} /></span>
          )}
          <span className="flex-1 truncate">{node.name}</span>
          {isSuggested(node.path) && (
            <span className="text-[10px] text-[color:var(--violet-500)] flex-shrink-0" title={t('fileTreePicker.suggested')}>★</span>
          )}
          {canSelectDir && (
            <button
              type="button"
              className="p-0.5 rounded flex-shrink-0 text-[color:var(--text-4)] hover:text-[color:var(--violet-600)]"
              title={t('fileTreePicker.selectFolder')}
              onClick={(e) => { e.stopPropagation(); toggleFile(node.path); }}
            >
              {selected.has(node.path) ? <Check className="w-4 h-4 text-[color:var(--violet-600)]" /> : <Folder className="w-4 h-4" />}
            </button>
          )}
          {canSelectFile && (
            <span className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center"
              style={{
                borderColor: fileSelected ? 'var(--violet-500)' : 'var(--border-2)',
                background: fileSelected ? 'var(--violet-500)' : 'transparent',
                color: 'white',
              }}>
              {fileSelected && <Check className="w-3 h-3" />}
            </span>
          )}
        </div>
        {isDir && open && node.children && (
          <div>{node.children.map(child => renderNode(child, level + 1))}</div>
        )}
      </div>
    );
  };

  const confirm = () => {
    onConfirm(
      singleSelect
        ? [...selected]
        : preserveHiddenSelections([...selected], initialSelected, collectRepresentablePaths(nodes)),
    );
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      accent={accent}
      size="lg"
      scrollable
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-[color:var(--text-3)]">
            {t('fileTreePicker.selectedCount', { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors"
            >
              {t('button.cancel')}
            </button>
            <button
              type="button"
              onClick={confirm}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-[color:var(--violet-600)] hover:bg-[color:var(--violet-700)] transition-colors"
            >
              {t('button.confirm')}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-[color:var(--border-1)] bg-[color:var(--bg-surface-2)]">
        <Search className="w-4 h-4 text-[color:var(--text-4)] flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('fileTreePicker.filterPlaceholder')}
          className="flex-1 bg-transparent outline-none text-sm text-[color:var(--text-1)] placeholder:text-[color:var(--text-4)]"
        />
      </div>
      <div className="aurora-scroll" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {nodes.length === 0
          ? <div className="text-sm text-[color:var(--text-4)] text-center py-6">{t('label.noItems')}</div>
          : nodes.map(node => renderNode(node, 0))}
      </div>
    </Modal>
  );
}
