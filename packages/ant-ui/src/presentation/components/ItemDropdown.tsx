import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LucideIcon, Settings, Play, Square, Loader2 } from 'lucide-react';
import type { ElementType } from 'react';
import { Button } from '@/presentation/components/common/button';
import { CreateItemForm } from './CreateItemForm';
import { textColors, cn } from '@/shared/utils/design-system';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';

interface ItemDropdownProps {
  title: string;
  icon?: LucideIcon;
  emoji?: string;
  items: Array<{ name: string; path?: string }>;
  selectedItem: string | undefined;
  onSelect: (itemName: string) => void;
  onCreate: (itemName: string) => Promise<void>;
  onDelete?: (itemName: string) => Promise<void>;
  /** Pre-check before showing delete confirmation. Return a string (reason) to block deletion, or null to allow. */
  canDelete?: (itemName: string) => string | null;
  onItemCreated?: () => void;
  placeholder?: string;
  inputPlaceholder?: string;
  renderCreateForm?: (props: {
    isOpen: boolean;
    onSubmit: (name: string) => Promise<void>;
    onCancel: () => void;
    placeholder: string;
  }) => React.ReactNode;
  onSettingsClick?: () => void;
  settingsIcon?: ElementType;  // Custom icon for settings button (default: Settings gear)
  onPlayClick?: () => void;
  onStopClick?: () => void;
  isPlaying?: boolean;
  playButtonDisabled?: boolean;  // ✅ Play 버튼 비활성화 여부
  playButtonLoading?: boolean;   // ✅ Play 버튼 로딩 중 여부
  disabled?: boolean;  // ✅ 작업 진행 중 선택 변경 불가
  disabledReason?: string;  // ✅ 비활성화 이유 (tooltip)
  canCreate?: boolean;  // ✅ + New 가능 여부
  createDisabledReason?: string; // ✅ + New 비활성화 이유
}

export function ItemDropdown({
  title,
  icon: Icon,
  emoji,
  items,
  selectedItem,
  onSelect,
  onCreate,
  onDelete,
  canDelete,
  onItemCreated,
  placeholder,
  inputPlaceholder,
  renderCreateForm,
  onSettingsClick,
  settingsIcon: SettingsIcon = Settings,
  onPlayClick,
  onStopClick,
  isPlaying = false,
  playButtonDisabled = false,  // ✅ 기본값: 활성화
  playButtonLoading = false,   // ✅ 기본값: 로딩 아님
  disabled = false,
  disabledReason,
  canCreate = true,
  createDisabledReason,
}: ItemDropdownProps) {
  const { t } = useTranslation('explorer');
  const resolvedPlaceholder = placeholder || t('item.selectPlaceholder');
  const resolvedInputPlaceholder = inputPlaceholder || t('item.inputPlaceholder');
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { showConfirm, showInfo } = useAlertModalContext();
  const { toast } = useToastContext();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      
      // Close dropdown if clicked outside
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreate = async (itemName: string) => {
    await onCreate(itemName);
    setIsCreating(false);
    setIsOpen(false);
    onItemCreated?.();
    // ✅ Don't auto-select - let parent component handle it to avoid Git timing issues
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
  };

  const handleOpenCreate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || !canCreate) return;
    setIsCreating(true);
  };

  const handleCloseCreate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCreating(false);
  };

  const handleDelete = async (itemName: string) => {
    if (!onDelete) return;

    // Pre-check: block deletion if canDelete returns a reason (e.g. running job)
    if (canDelete) {
      const blockReason = canDelete(itemName);
      if (blockReason) {
        showInfo(blockReason, { type: 'warning', title: t('item.deleteTitle') });
        return;
      }
    }

    showConfirm(
      <>
        <p className="text-sm">
          {t('item.deleteConfirm', { name: itemName })}
        </p>
        <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
          {t('item.deleteWarning')}
        </p>
      </>,
      {
        type: 'warning',
        title: t('item.deleteTitle'),
        confirmText: t('common:button.delete'),
        cancelText: t('common:button.cancel'),
        onConfirm: async () => {
          try {
            await onDelete(itemName);
            if (selectedItem === itemName) {
              onSelect('');
            }
            onItemCreated?.(); // Refresh list
            toast.success(t('item.deleteSuccess', { name: itemName }));
          } catch (error) {
            console.error('Failed to delete item:', error);
            toast.error(t('item.deleteFailed'));
          }
        }
      }
    );
  };

  if (items.length === 0) {
    const createDisabled = disabled || !canCreate;
    return (
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            {Icon && <Icon className="h-4 w-4" />}
            {emoji && <span>{emoji}</span>}
            {title}
          </h3>
          {!isCreating && (
            <Button 
              variant="ghost"
              size="sm" 
              onClick={handleOpenCreate}
              disabled={createDisabled}
              title={createDisabled ? (createDisabledReason || disabledReason || undefined) : undefined}
            >
              {t('feature.new')}
            </Button>
          )}
          {isCreating && (
            <Button 
              size="sm"
              variant="outline"
              onClick={handleCloseCreate}
            >
              {t('common:button.cancel')}
            </Button>
          )}
        </div>

        {/* Content */}
        <div>
          {renderCreateForm ? (
            renderCreateForm({
              isOpen: isCreating,
              onSubmit: handleCreate,
              onCancel: handleCancelCreate,
              placeholder: resolvedInputPlaceholder,
            })
          ) : (
            <CreateItemForm
              placeholder={resolvedInputPlaceholder}
              onSubmit={handleCreate}
              onCancel={handleCancelCreate}
              isOpen={isCreating}
            />
          )}
          {!isCreating && (
            <div className={cn('p-3 text-center text-sm', textColors.tertiary)}>
              {t('item.noItemsFound', { title: title.toLowerCase() })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const createDisabled = disabled || !canCreate;
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          {Icon && <Icon className="h-4 w-4" />}
          {emoji && <span>{emoji}</span>}
          {title}
        </h3>
        {!isCreating && (
          <Button 
            variant="ghost"
            size="sm" 
            onClick={handleOpenCreate}
            disabled={createDisabled}
            title={createDisabled ? (createDisabledReason || disabledReason || undefined) : undefined}
          >
            {t('feature.new')}
          </Button>
        )}
        {isCreating && (
          <Button 
            size="sm"
            variant="outline"
            onClick={handleCloseCreate}
          >
            {t('common:button.cancel')}
          </Button>
        )}
      </div>

      {/* Content */}
      <div>
        {renderCreateForm ? (
          renderCreateForm({
            isOpen: isCreating,
            onSubmit: handleCreate,
            onCancel: handleCancelCreate,
            placeholder: resolvedInputPlaceholder,
          })
        ) : (
          <CreateItemForm
            placeholder={resolvedInputPlaceholder}
            onSubmit={handleCreate}
            onCancel={handleCancelCreate}
            isOpen={isCreating}
          />
        )}
        
        <div className="relative" ref={dropdownRef}>
          <Button
            variant="outline"
            className="w-full !justify-start text-left pr-10"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
          >
            <span className="truncate">
              {selectedItem || resolvedPlaceholder}
            </span>
          </Button>
          
          {/* Right side icons container */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            {/* Play/Stop button - only show when item is selected and callback is provided */}
            {selectedItem && (onPlayClick || onStopClick) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (playButtonDisabled || playButtonLoading) return;  // ✅ 비활성화 또는 로딩 중이면 무시
                  if (isPlaying && onStopClick) {
                    onStopClick();
                  } else if (!isPlaying && onPlayClick) {
                    onPlayClick();
                  }
                }}
                disabled={playButtonDisabled || playButtonLoading}  // ✅ 버튼 비활성화
                className={`p-1 rounded transition-colors pointer-events-auto ${
                  playButtonDisabled || playButtonLoading
                    ? 'opacity-50 cursor-not-allowed text-gray-400 dark:text-gray-600'  // ✅ 비활성화 스타일
                    : isPlaying 
                      ? 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:bg-gray-50 dark:hover:bg-[#30363d]' 
                      : 'text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 hover:bg-gray-50 dark:hover:bg-[#30363d]'
                }`}
                title={
                  playButtonLoading 
                    ? (isPlaying ? t('dropdown.stoppingPreview') : t('dropdown.startingPreview'))
                    : playButtonDisabled
                      ? t('dropdown.cannotStartStop')
                      : (isPlaying ? t('dropdown.stopDevServer') : t('dropdown.startDevServer'))
                }
              >
                {playButtonLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
            )}
            {/* Settings button - only show when item is selected and callback is provided */}
            {selectedItem && onSettingsClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) {
                    onSettingsClick();
                  }
                }}
                disabled={disabled}
                className="p-1 hover:bg-gray-50 dark:hover:bg-[#30363d] rounded transition-colors pointer-events-auto disabled:opacity-50 disabled:cursor-not-allowed"
                title={disabled ? disabledReason : t('item.settings')}
              >
                <SettingsIcon className="h-4 w-4 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200" />
              </button>
            )}
            <ChevronDown 
              className={cn(
                'h-4 w-4 transition-transform',
                textColors.secondary,
                isOpen ? 'transform rotate-180' : ''
              )} 
            />
          </div>
          
          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-md shadow-lg z-10 overflow-y-auto" style={{ maxHeight: 'min(calc(100vh - 200px), 400px)' }}>
              {/* Deselect option at the top */}
              <div
                className={`flex items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-[#30363d] transition-colors border-b border-gray-200 dark:border-[#30363d] ${
                  !selectedItem 
                    ? 'bg-primary-50 dark:bg-primary-900 text-primary-600 dark:text-primary-300 font-medium' 
                    : 'text-gray-500 dark:text-gray-500 italic'
                }`}
              >
                <button
                  className="flex-1 text-left"
                  onClick={() => {
                    onSelect(null as any);  // ✅ Pass null to deselect (cast needed for type compatibility)
                    setIsOpen(false);
                  }}
                >
                  {resolvedPlaceholder}
                </button>
              </div>
              
              {/* Existing items */}
              {items.map((item) => (
                <div
                  key={item.name}
                  className={`flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-[#30363d] transition-colors ${
                    selectedItem === item.name 
                      ? 'bg-primary-50 dark:bg-primary-900 text-primary-600 dark:text-primary-300 font-medium' 
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <button
                    className="flex-1 text-left"
                    onClick={() => {
                      onSelect(item.name);
                      setIsOpen(false);
                    }}
                  >
                    {item.name}
                  </button>
                  {onDelete && (
                    <button
                      className="ml-2 text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 px-2 py-1 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.name);
                      }}
                      title={t('item.deleteItem', { title: title.toLowerCase() })}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}