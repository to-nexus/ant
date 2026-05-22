/**
 * FileActionMenu
 * 
 * Unified "⋯" (MoreHorizontal) dropdown menu for file/directory actions.
 * Replaces inline hover buttons to reduce UI clutter.
 * 
 * Menu items vary by context:
 * - File: Send / Download / --- / Delete
 * - Directory: Create File / Create Folder / Upload / --- / Send / Download / --- / Delete
 * - sessions/ paths: Download / --- / Delete (no Send)
 * 
 * The dropdown is rendered via React Portal (document.body) so it is never
 * clipped by parent containers with overflow-y-auto / max-h constraints.
 * Menu opens to the LEFT of the trigger button (right-aligned to button).
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { MoreHorizontal, ArrowUpRight, Download, FileText, FolderPlus, Upload, Trash2, CheckCircle, Pencil } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { cn } from '@/shared/utils/design-system';

interface FileActionMenuProps {
  nodePath: string;
  nodeType: 'file' | 'directory';
  nodeName?: string;
  isSessionPath: boolean;
  isProtectedDir?: boolean;
  isClearableDir?: boolean;
  onSend?: (path: string, type: 'file' | 'directory') => void;
  onDownload?: (path: string) => void;
  onCreateFile?: () => void;
  onCreateDirectory?: () => void;
  onUpload?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onClearContents?: () => void;
  onMarkAllSeen?: () => void;
  /** Called when the dropdown opens or closes, so parent can highlight the active row */
  onOpenChange?: (isOpen: boolean) => void;
}

export function FileActionMenu({
  nodePath,
  nodeType,
  nodeName: _nodeName,
  isSessionPath,
  isProtectedDir,
  isClearableDir,
  onSend,
  onDownload,
  onCreateFile,
  onCreateDirectory,
  onUpload,
  onRename,
  onDelete,
  onClearContents,
  onMarkAllSeen,
  onOpenChange,
}: FileActionMenuProps) {
  const { t } = useTranslation('artifacts');
  const [isOpen, setIsOpen] = useState(false);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const setOpenState = useCallback((open: boolean) => {
    setIsOpen(open);
    onOpenChangeRef.current?.(open);
  }, []);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Build menu items (memoized so updatePosition can reference it)
  const menuItems = useMemo(() => {
    const items: Array<{
      icon: React.ElementType;
      label: string;
      onClick: () => void;
      variant?: 'danger';
    } | 'separator'> = [];

    // Directory creation actions
    if (nodeType === 'directory') {
      if (onCreateFile) {
        items.push({ icon: FileText, label: t('actions.createFile'), onClick: onCreateFile });
      }
      if (onCreateDirectory) {
        items.push({ icon: FolderPlus, label: t('actions.createDirectory'), onClick: onCreateDirectory });
      }
      if (onUpload) {
        items.push({ icon: Upload, label: t('actions.upload'), onClick: onUpload });
      }
      if (items.length > 0) {
        items.push('separator');
      }
    }

    // Rename (files & directories)
    if (onRename) {
      items.push({ icon: Pencil, label: t('actions.rename'), onClick: onRename });
    }

    // Mark all as seen (directories with unseen files)
    if (onMarkAllSeen) {
      items.push({ icon: CheckCircle, label: t('actions.markAllSeen'), onClick: onMarkAllSeen });
      items.push('separator');
    }

    // Send (not for sessions)
    if (!isSessionPath && onSend) {
      items.push({
        icon: ArrowUpRight,
        label: t('actions.send'),
        onClick: () => onSend(nodePath, nodeType),
      });
    }

    // Download
    if (onDownload) {
      items.push({
        icon: Download,
        label: t('actions.download'),
        onClick: () => onDownload(nodePath),
      });
    }

    // Delete
    if (!isProtectedDir) {
      if (isClearableDir && onClearContents) {
        if (items.length > 0 && items[items.length - 1] !== 'separator') {
          items.push('separator');
        }
        items.push({
          icon: Trash2,
          label: t('actions.clearContents'),
          onClick: onClearContents,
          variant: 'danger',
        });
      } else if (onDelete) {
        if (items.length > 0 && items[items.length - 1] !== 'separator') {
          items.push('separator');
        }
        items.push({
          icon: Trash2,
          label: t('actions.delete'),
          onClick: onDelete,
          variant: 'danger',
        });
      }
    }

    return items;
  }, [t, nodeType, nodePath, isSessionPath, isProtectedDir, isClearableDir, onCreateFile, onCreateDirectory, onUpload, onRename, onSend, onDownload, onDelete, onClearContents, onMarkAllSeen]);

  // Compute position: menu opens to the RIGHT of the trigger button, top-aligned.
  // If menu would overflow viewport bottom, flip vertically (bottom-align to button).
  // If menu would overflow viewport right, flip horizontally (left of button).
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const GAP = 4;

    // Horizontal
    const MENU_WIDTH = 172;
    let left = rect.right + GAP;
    if (left + MENU_WIDTH > window.innerWidth - 8) {
      left = rect.left - MENU_WIDTH - GAP;
    }
    if (left < 8) left = 8;

    // Vertical: estimate menu height from items
    // Each action item ~32px, separator ~9px, container py-1 ~8px
    const estimatedHeight = menuItems.reduce((h, item) => h + (item === 'separator' ? 9 : 32), 8);
    let top = rect.top;

    if (top + estimatedHeight > window.innerHeight - 8) {
      // Flip: bottom of menu aligns with bottom of button
      top = rect.bottom - estimatedHeight;
      if (top < 8) top = 8;
    }

    setMenuPos({ top, left });
  }, [menuItems]);

  // Close on outside click or scroll.
  // Scroll listener is deferred by one animation frame to avoid catching
  // layout-triggered scroll events caused by the portal mount / CSS changes.
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpenState(false);
      }
    };

    const handleScroll = (e: Event) => {
      if (triggerRef.current && e.target instanceof Node &&
          (e.target as Node).contains(triggerRef.current)) {
        setOpenState(false);
      }
    };
    const handleResize = () => setOpenState(false);
    
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleResize);

    const rafId = requestAnimationFrame(() => {
      document.addEventListener('scroll', handleScroll, true);
    });

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, setOpenState]);

  if (menuItems.length === 0) return null;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      updatePosition();
    }
    setOpenState(!isOpen);
  };

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0 text-[color:var(--text-3)] hover:text-gray-700 hover:bg-[color:var(--bg-active)]"
        onClick={handleToggle}
      >
        <MoreHorizontal className="w-4 h-4" />
      </Button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[172px] rounded-md border border-[color:var(--border-1)] bg-[color:var(--bg-surface)] shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {menuItems.map((item, index) => {
            if (item === 'separator') {
              return (
                <div
                  key={`sep-${index}`}
                  className="my-1 border-t border-[color:var(--border-1)]"
                />
              );
            }

            const Icon = item.icon;
            const isDanger = item.variant === 'danger';

            return (
              <button
                key={item.label}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors',
                  isDanger
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)]'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenState(false);
                  item.onClick();
                }}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
