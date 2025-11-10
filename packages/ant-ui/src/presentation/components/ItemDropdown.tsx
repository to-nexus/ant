import { useState, useEffect, useRef } from 'react';
import { ChevronDown, LucideIcon, Settings, Play, Square } from 'lucide-react';
import { Button } from '@/presentation/components/common/button';
import { CreateItemForm } from './CreateItemForm';
import { textColors, cn } from '@/shared/utils/design-system';

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
  disabled?: boolean;  // ✅ 작업 진행 중 선택 변경 불가
  disabledReason?: string;  // ✅ 비활성화 이유 (tooltip)
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
  disabled = false,
  disabledReason,
}: ItemDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    // Auto-select the newly created item
    onSelect(itemName);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
  };

  const handleOpenCreate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCreating(true);
  };

  const handleCloseCreate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCreating(false);
  };

  const handleDelete = async (itemName: string) => {
    if (!onDelete) return;
    
    if (!confirm(`Are you sure you want to delete "${itemName}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      await onDelete(itemName);
      if (selectedItem === itemName) {
        onSelect('');
      }
      onItemCreated?.(); // Refresh list
    } catch (error) {
      console.error('Failed to delete item:', error);
      alert('Failed to delete item. Please try again.');
    }
  };

  if (items.length === 0) {
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
                  console.log('[ItemDropdown] Play/Stop button clicked');
                  console.log('[ItemDropdown] isPlaying:', isPlaying);
                  console.log('[ItemDropdown] onPlayClick:', !!onPlayClick);
                  console.log('[ItemDropdown] onStopClick:', !!onStopClick);
                  
                  e.stopPropagation();
                  if (isPlaying && onStopClick) {
                    console.log('[ItemDropdown] Calling onStopClick');
                    onStopClick();
                  } else if (!isPlaying && onPlayClick) {
                    console.log('[ItemDropdown] Calling onPlayClick');
                    onPlayClick();
                  }
                }}
                className={`p-1 hover:bg-gray-50 dark:hover:bg-[#30363d] rounded transition-colors pointer-events-auto ${
                  isPlaying 
                    ? 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300' 
                    : 'text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300'
                }`}
                title={isPlaying ? 'Stop dev server' : 'Start dev server'}
              >
                {isPlaying ? (
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
                    onSelect('');
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