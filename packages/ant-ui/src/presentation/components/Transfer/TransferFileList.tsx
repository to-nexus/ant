/**
 * TransferFileList - Shared file/directory list component for Transfer tab.
 * Used by both SendSubTab (with remove button) and ReceiveSubTab (read-only).
 */

import { File, Folder, X } from 'lucide-react';
import type { FileNode } from '@/infrastructure/http/api';

export interface TransferFileItem {
  path: string;
  type: 'file' | 'directory';
  /** Pre-computed file count for directories (from backend, e.g., in TransferRequest) */
  fileCount?: number;
}

interface TransferFileListProps {
  items: TransferFileItem[];
  /** If provided, enables counting files from the tree for directories */
  fileTree?: FileNode[];
  /** If provided, shows a remove button per item */
  onRemove?: (path: string) => void;
}

export function TransferFileList({ items, fileTree, onRemove }: TransferFileListProps) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
      {items.map(item => {
        const dirFileCount = item.type === 'directory'
          ? (item.fileCount ?? (fileTree ? countFilesUnderPath(fileTree, item.path) : 0))
          : 0;

        return (
          <div key={item.path} className="flex items-center gap-2 px-2.5 py-1.5 group">
            {item.type === 'directory'
              ? <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              : <File className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />}
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">
              {item.path}
              {item.type === 'directory' && dirFileCount > 0 && (
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
        );
      })}
    </div>
  );
}

/**
 * Count all files recursively under a given path in the file tree.
 */
export function countFilesUnderPath(tree: FileNode[], targetPath: string): number {
  const findNode = (nodes: FileNode[], path: string): FileNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.children) {
        const found = findNode(n.children, path);
        if (found) return found;
      }
    }
    return null;
  };

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
 * Guess if a path is a directory or file based on naming conventions.
 */
export function guessPathType(p: string): 'file' | 'directory' {
  if (p.endsWith('/')) return 'directory';
  const last = p.split('/').pop() || '';
  return last.includes('.') ? 'file' : 'directory';
}
