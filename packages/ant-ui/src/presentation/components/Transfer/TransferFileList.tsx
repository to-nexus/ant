/**
 * TransferFileList - Shared file/directory list component for Transfer tab.
 * Used by both SendSubTab (with remove button) and ReceiveSubTab (with exclude/restore).
 * Supports expanding directories to show their contents as a tree.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { File, Folder, FolderOpen, X, ChevronRight, ChevronDown, Undo2 } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import type { FileNode } from '@/infrastructure/http/api';

export interface TransferFileItem {
  path: string;
  type: 'file' | 'directory';
  /** Pre-computed file count for directories (from backend, e.g., in TransferRequest) */
  fileCount?: number;
}

interface TransferFileListProps {
  items: TransferFileItem[];
  /** Source file tree for resolving folder contents (send side) */
  fileTree?: FileNode[];
  /** Payload file tree for resolving folder contents (receive side) */
  payloadTree?: FileNode[];
  /** Shows a remove button per top-level item (send side) */
  onRemove?: (path: string) => void;
  /** Exclude a specific file path from the transfer (receive side) */
  onExcludeFile?: (path: string) => void;
  /** Restore a previously excluded file (receive side) */
  onRestoreFile?: (path: string) => void;
  /** Set of excluded file paths for visual indication */
  excludedPaths?: Set<string>;
  /** Removes outer border/rounded styling for embedding inside a card */
  borderless?: boolean;
}

export function TransferFileList({
  items, fileTree, payloadTree, onRemove,
  onExcludeFile, onRestoreFile, excludedPaths, borderless,
}: TransferFileListProps) {
  const { t } = useTranslation('transfer');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((p: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  const tree = payloadTree ?? fileTree;

  return (
    <div className={cn(
      'divide-y divide-gray-100 dark:divide-gray-700/50',
      borderless ? '' : 'rounded-lg border border-gray-200 dark:border-gray-700',
    )}>
      {items.map(item => {
        const dirFileCount = item.type === 'directory'
          ? (item.fileCount ?? (tree ? countFilesUnderPath(tree, item.path) : 0))
          : 0;
        const isExpanded = expandedPaths.has(item.path);
        const childNodes = item.type === 'directory' && isExpanded && tree
          ? findChildren(tree, item.path, payloadTree)
          : null;

        return (
          <div key={item.path}>
            {/* Top-level item row */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 group">
              {item.type === 'directory' && tree ? (
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-400"
                  onClick={() => toggleExpand(item.path)}
                >
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />}
                </button>
              ) : (
                <span className="w-4" />
              )}
              {item.type === 'directory'
                ? (isExpanded
                  ? <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  : <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />)
                : <File className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />}
              <span
                className={cn(
                  'text-sm truncate flex-1',
                  item.type === 'directory' && tree ? 'cursor-pointer' : '',
                  'text-gray-700 dark:text-gray-300',
                )}
                onClick={() => item.type === 'directory' && tree && toggleExpand(item.path)}
              >
                {item.path}
                {item.type === 'directory' && dirFileCount > 0 && !isExpanded && (
                  <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                    ({dirFileCount}개 파일)
                  </span>
                )}
              </span>
              {onRemove && (
                <button
                  className="shrink-0 p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 opacity-0 group-hover:opacity-100 transition-all"
                  onClick={() => onRemove(item.path)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Expanded children */}
            {childNodes && childNodes.length > 0 && (
              <div className="bg-gray-50/50 dark:bg-gray-800/30">
                {renderTreeNodes(
                  childNodes, 1, expandedPaths, toggleExpand,
                  onExcludeFile, onRestoreFile, excludedPaths,
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Recursively render file tree nodes with indentation.
 */
function renderTreeNodes(
  nodes: FileNode[],
  depth: number,
  expandedPaths: Set<string>,
  toggleExpand: (p: string) => void,
  onExcludeFile?: (path: string) => void,
  onRestoreFile?: (path: string) => void,
  excludedPaths?: Set<string>,
): React.ReactNode[] {
  return nodes.map(node => {
    const isExcluded = excludedPaths?.has(node.path);
    const isDir = node.type === 'directory';
    const isExpanded = expandedPaths.has(node.path);
    const paddingLeft = depth * 16 + 8;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-1.5 py-1 pr-2.5 group',
            isExcluded && 'opacity-40',
          )}
          style={{ paddingLeft }}
        >
          {isDir ? (
            <button
              className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-400"
              onClick={() => toggleExpand(node.path)}
            >
              {isExpanded
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          {isDir
            ? (isExpanded
              ? <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              : <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />)
            : <File className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />}
          <span
            className={cn(
              'text-xs truncate flex-1',
              isExcluded
                ? 'line-through text-gray-400 dark:text-gray-600'
                : 'text-gray-600 dark:text-gray-400',
              isDir ? 'cursor-pointer font-medium' : '',
            )}
            onClick={() => isDir && toggleExpand(node.path)}
          >
            {node.name}
          </span>

          {onExcludeFile && !isExcluded && (
            <button
              className="shrink-0 p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 opacity-0 group-hover:opacity-100 transition-all"
              onClick={() => onExcludeFile(node.path)}
              title={t('action.exclude')}
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {onRestoreFile && isExcluded && (
            <button
              className="shrink-0 p-0.5 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/50 opacity-100 transition-all"
              onClick={() => onRestoreFile(node.path)}
              title={t('action.restore')}
            >
              <Undo2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Recursively render sub-children if expanded */}
        {isDir && isExpanded && node.children && node.children.length > 0 && (
          renderTreeNodes(
            node.children, depth + 1, expandedPaths, toggleExpand,
            onExcludeFile, onRestoreFile, excludedPaths,
          )
        )}
      </div>
    );
  });
}

/**
 * Find children of a directory item from the tree.
 * For payloadTree (receive), paths are payload-relative so we use root nodes directly.
 * For fileTree (send), we find the matching node by path and return its children.
 */
function findChildren(
  tree: FileNode[],
  itemPath: string,
  isPayloadTree?: FileNode[],
): FileNode[] {
  if (isPayloadTree) {
    return tree;
  }
  const node = findNode(tree, itemPath);
  return node?.children ?? [];
}

function findNode(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === targetPath) return n;
    if (n.children) {
      const found = findNode(n.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Count all files recursively under a given path in the file tree.
 */
export function countFilesUnderPath(tree: FileNode[], targetPath: string): number {
  const countFiles = (node: FileNode): number => {
    if (node.type === 'file') return 1;
    if (!node.children) return 0;
    return node.children.reduce((sum, child) => sum + countFiles(child), 0);
  };

  const node = findNode(tree, targetPath);
  if (!node) return 0;
  return countFiles(node);
}

/**
 * Count all files in a flat tree (for payloadTree where root = folder contents).
 */
export function countFilesInTree(tree: FileNode[]): number {
  let count = 0;
  for (const node of tree) {
    if (node.type === 'file') count++;
    else if (node.children) count += countFilesInTree(node.children);
  }
  return count;
}

/**
 * Guess if a path is a directory or file based on naming conventions.
 */
export function guessPathType(p: string): 'file' | 'directory' {
  if (p.endsWith('/')) return 'directory';
  const last = p.split('/').pop() || '';
  return last.includes('.') ? 'file' : 'directory';
}
