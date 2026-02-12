/**
 * MemberPicker
 *
 * Popup-based member search/selection component.
 * - Shows a trigger button with selected member name or placeholder
 * - Opens a popover with search input + scrollable member list
 * - Rendered via Portal to avoid clipping
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, User, X } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import { useTranslation } from 'react-i18next';

interface MemberPickerProps {
  members: Array<{ userId: string; isSelf?: boolean }>;
  selectedUserId: string;
  onSelect: (userId: string) => void;
  /** Called when picker is dismissed without selection */
  onDismiss?: () => void;
  placeholder?: string;
  className?: string;
}

export function MemberPicker({
  members,
  selectedUserId,
  onSelect,
  onDismiss,
  placeholder,
  className,
}: MemberPickerProps) {
  const { t } = useTranslation('common');
  const effectivePlaceholder = placeholder || t('memberPicker.placeholder');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const filteredMembers = members.filter(m =>
    m.userId.toLowerCase().includes(search.toLowerCase())
  );

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 220),
    });
  }, []);

  const handleOpen = () => {
    updatePosition();
    setIsOpen(true);
    setSearch('');
    // Focus search input after render
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const handleClose = () => {
    setIsOpen(false);
    if (!selectedUserId) {
      onDismiss?.();
    }
  };

  const handleSelect = (userId: string) => {
    onSelect(userId);
    setIsOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, selectedUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        ref={triggerRef}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md border transition-colors',
          selectedUserId
            ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500',
          className
        )}
        onClick={handleOpen}
      >
        <User className="w-3.5 h-3.5" />
        <span className="truncate max-w-[120px]">{selectedUserId || effectivePlaceholder}</span>
        {selectedUserId && (
          <X
            className="w-3 h-3 ml-0.5 hover:text-red-500 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onSelect('');
              onDismiss?.();
            }}
          />
        )}
      </button>

      {isOpen && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('memberPicker.searchPlaceholder')}
              className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          {/* List */}
          <div className="max-h-[200px] overflow-y-auto py-1">
            {filteredMembers.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
                {search ? t('label.noSearchResults') : t('label.noMembers')}
              </p>
            ) : (
              filteredMembers.map(m => (
                <button
                  key={m.userId}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors',
                    m.userId === selectedUserId
                      ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  )}
                  onClick={() => handleSelect(m.userId)}
                >
                  <User className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="truncate">{m.userId}</span>
                  {m.userId === selectedUserId && (
                    <span className="ml-auto text-xs text-blue-500">{t('label.selected')}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
