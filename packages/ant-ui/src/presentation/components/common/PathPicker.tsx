/**
 * PathPicker - Reusable mini tree view for path selection.
 * 
 * Supports two modes:
 * - fileTree mode: shows actual file/directory tree
 * - canonicalDirs mode: shows only canonical directories
 * 
 * Features:
 * - Context label at top showing current action purpose
 * - Directory selection with highlight
 * - Dark/light mode support
 * - sessions/ exclusion
 */

import React, { useState } from 'react';
import { Folder, FolderOpen, Check, FolderCheck } from 'lucide-react';
import { FileIcon } from '@/shared/utils/file-icons';
import { cn } from '@/shared/utils/design-system';
import type { FileNode } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';

interface PathPickerProps {
  contextLabel: string;
  fileTree?: FileNode[];
  canonicalDirs?: string[];
  selectedPath: string | null;
  onSelect: (path: string, type: 'file' | 'directory') => void;
  selectableTypes?: ('file' | 'directory')[];
  excludePatterns?: string[];
  maxHeight?: string;
}

/**
 * Build a tree structure from flat canonical directory paths.
 */
function buildCanonicalTree(dirs: string[]): FileNode[] {
  const root: FileNode[] = [];
  const map = new Map<string, FileNode>();

  // Sort to ensure parents come before children
  const sorted = [...dirs].sort();

  for (const dir of sorted) {
    const parts = dir.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    const node: FileNode = {
      name,
      path: dir,
      type: 'directory',
      children: [],
    };

    map.set(dir, node);

    if (parentPath && map.has(parentPath)) {
      map.get(parentPath)!.children = map.get(parentPath)!.children || [];
      map.get(parentPath)!.children!.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

export function PathPicker({
  contextLabel,
  fileTree,
  canonicalDirs,
  selectedPath,
  onSelect,
  selectableTypes = ['directory'],
  excludePatterns = ['sessions/'],
  maxHeight = 'max-h-48',
}: PathPickerProps) {
  const { t } = useTranslation('common');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Build tree from either source
  const nodes = fileTree
    ? filterNodes(fileTree, excludePatterns)
    : canonicalDirs
    ? buildCanonicalTree(canonicalDirs)
    : [];

  const toggleDir = (path: string) => {
    const next = new Set(expandedDirs);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setExpandedDirs(next);
  };

  const renderNode = (node: FileNode, level: number): React.ReactElement | null => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = selectedPath === node.path;
    const isDir = node.type === 'directory';
    const canSelectDir = isDir && selectableTypes.includes('directory');
    const canSelectFile = !isDir && selectableTypes.includes('file');

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-2 py-1 px-2 rounded text-sm transition-colors',
            isSelected
              ? 'bg-blue-100 text-blue-900'
              : (isDir || canSelectFile)
              ? 'hover:bg-[color:var(--bg-hover)] text-[color:var(--text-2)] cursor-pointer'
              : 'text-[color:var(--text-4)] cursor-default'
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (isDir) {
              // Directory click: expand/collapse only
              toggleDir(node.path);
            } else if (canSelectFile) {
              // File click: select
              onSelect(node.path, 'file');
            }
          }}
        >
          {isDir ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
            )
          ) : (
            <FileIcon filePath={node.name} size={16} />
          )}
          <span className="flex-1 truncate">{node.name}</span>
          {/* Directory: explicit select button on the right */}
          {canSelectDir && (
            <button
              className={cn(
                'p-0.5 rounded transition-colors flex-shrink-0',
                isSelected
                  ? 'text-blue-600'
                  : 'text-[color:var(--text-4)] hover:text-blue-600 hover:bg-blue-50'
              )}
              title={t('pathPicker.selectFolder')}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node.path, 'directory');
              }}
            >
              {isSelected
                ? <Check className="w-4 h-4" />
                : <FolderCheck className="w-4 h-4" />
              }
            </button>
          )}
          {/* File selected indicator */}
          {!isDir && isSelected && (
            <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
          )}
        </div>
        {isDir && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border border-[color:var(--border-1)] rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-[color:var(--bg-canvas)] border-b border-[color:var(--border-1)]">
        <span className="text-xs font-medium text-[color:var(--text-3)] flex items-center gap-1">
          📍 {contextLabel}
        </span>
      </div>
      <div className={cn('overflow-y-auto p-1', maxHeight)}>
        {nodes.length === 0 ? (
          <div className="text-sm text-[color:var(--text-4)] text-center py-4">
            {t('label.noItems')}
          </div>
        ) : (
          nodes.map(node => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}

/**
 * Filter out nodes matching exclude patterns.
 */
function filterNodes(nodes: FileNode[], patterns: string[]): FileNode[] {
  return nodes
    .filter(node => !patterns.some(p => node.path === p.replace(/\/$/, '') || node.path.startsWith(p)))
    .map(node => ({
      ...node,
      children: node.children ? filterNodes(node.children, patterns) : undefined,
    }));
}
