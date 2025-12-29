import { useState, useEffect, useRef } from 'react';
import { ChevronDown, LucideIcon, Settings, Play, Square, Loader2 } from 'lucide-react';
import { Button } from '@/presentation/components/common/button';
import { CreateItemForm } from './CreateItemForm';
import { textColors, cn } from '@/shared/utils/design-system';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

interface ItemDropdownProps {
  title: string;
  icon?: LucideIcon;
  emoji?: string;
  items: Array<{ name: string; path?: string }>;
  selectedItem: string | undefined;
  onSelect: (itemName: string) => void;
  onCreate: (itemName: string) => Promise<void>;
  onDelete?: (itemName: string) => Promise<void>;
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
  onItemCreated,
  placeholder = 'Select an item...',
  inputPlaceholder = 'Item name...',
  renderCreateForm,
  onSettingsClick,
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
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { showConfirm, showError } = useAlertModalContext();

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

    showConfirm(
      <>
        <p className="text-sm">
          정말 <strong>"{itemName}"</strong>을(를) 삭제할까요?
        </p>
        <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
          이 작업은 되돌릴 수 없습니다.
        </p>
      </>,
      {
        type: 'warning',
        title: 'Delete?',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: async () => {
          try {
            await onDelete(itemName);
            if (selectedItem === itemName) {
              onSelect('');
            }
            onItemCreated?.(); // Refresh list
          } catch (error) {
            console.error('Failed to delete item:', error);
            showError('삭제에 실패했습니다. 잠시 후 다시 시도해주세요.', { title: '오류' });
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
              + New
            </Button>
          )}
          {isCreating && (
            <Button 
              size="sm"
              variant="outline"
              onClick={handleCloseCreate}
            >
              Cancel
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
              placeholder: inputPlaceholder,
            })
          ) : (
            <CreateItemForm
              placeholder={inputPlaceholder}
              onSubmit={handleCreate}
              onCancel={handleCancelCreate}
              isOpen={isCreating}
            />
          )}
          {!isCreating && (
            <div className={cn('p-3 text-center text-sm', textColors.tertiary)}>
              No {title.toLowerCase()} found
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
            + New
          </Button>
        )}
        {isCreating && (
          <Button 
            size="sm"
            variant="outline"
            onClick={handleCloseCreate}
          >
            Cancel
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
            placeholder: inputPlaceholder,
          })
        ) : (
          <CreateItemForm
            placeholder={inputPlaceholder}
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
              {selectedItem || placeholder}
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
                    ? (isPlaying ? 'Stopping dev server...' : 'Starting dev server...')
                    : playButtonDisabled
                      ? 'Cannot start/stop dev server (task running or not available)'
                      : (isPlaying ? 'Stop dev server' : 'Start dev server')
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
                title={disabled ? disabledReason : "Settings"}
              >
                <Settings className="h-4 w-4 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200" />
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
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
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
                  {placeholder}
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
                      title={`Delete ${title.toLowerCase()}`}
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