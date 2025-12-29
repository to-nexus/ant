import { useState, useRef, useEffect } from 'react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

interface CreateItemFormProps {
  placeholder: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  isOpen: boolean;
}

export function CreateItemForm({ placeholder, onSubmit, onCancel, isOpen }: CreateItemFormProps) {
  const [itemName, setItemName] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const { showError } = useAlertModalContext();

  // Reset state when form opens/closes
  useEffect(() => {
    if (!isOpen) {
      setItemName('');
      setLoading(false);
    }
  }, [isOpen]);

  // Close form when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (formRef.current && !formRef.current.contains(event.target as Node)) {
        onCancel();
      }
    }

    // Add delay to prevent immediate closing from the button click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onCancel]);

  const handleSubmit = async () => {
    if (!itemName.trim()) return;

    try {
      setLoading(true);
      await onSubmit(itemName.trim());
      setItemName('');
      onCancel(); // Close form after successful creation
    } catch (error) {
      console.error('Failed to create item:', error);
      const anyErr = error as any;
      if (!anyErr?.silent) {
        showError('생성에 실패했습니다. 이름을 확인하고 다시 시도해주세요.', { title: '오류' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div ref={formRef} className="mb-4">
      <div className="relative">
        <input
          type="text"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          onKeyDown={handleKeyDown}
          disabled={loading}
          autoFocus
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !itemName.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl disabled:opacity-30 hover:scale-110 transition-transform"
          title="Create"
        >
          ✅
        </button>
      </div>
    </div>
  );
}
