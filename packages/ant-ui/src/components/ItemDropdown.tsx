import { useState, useEffect, useRef } from 'react';
import { ChevronDown, LucideIcon, Settings } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { CreateItemForm } from './CreateItemForm';

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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              {Icon && <Icon className="h-5 w-5" />}
              {emoji && <span>{emoji}</span>}
              {title}
            </CardTitle>
            {!isCreating && (
              <Button 
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
        </CardHeader>
        <CardContent>
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
            <div className="p-4 text-center text-gray-500">
              No {title.toLowerCase()} found
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {Icon && <Icon className="h-5 w-5" />}
            {emoji && <span>{emoji}</span>}
            {title}
          </CardTitle>
          {!isCreating && (
            <Button 
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
      </CardHeader>
      <CardContent>
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
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className="truncate">
              {selectedItem || placeholder}
            </span>
          </Button>
          
          {/* Right side icons container */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            {/* Settings button - only show when item is selected and callback is provided */}
            {selectedItem && onSettingsClick && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSettingsClick();
                }}
                className="p-1 hover:bg-gray-100 rounded transition-colors pointer-events-auto"
                title="Settings"
              >
                <Settings className="h-4 w-4 text-gray-600 hover:text-gray-800" />
              </button>
            )}
            <ChevronDown 
              className={`h-4 w-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} 
            />
          </div>
          
          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.name}
                  className={`flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors ${
                    selectedItem === item.name ? 'bg-primary-50 text-primary-600 font-medium' : 'text-gray-700'
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
                      className="ml-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded"
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
      </CardContent>
    </Card>
  );
}