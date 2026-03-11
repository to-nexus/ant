/**
 * Modal Component
 * 
 * Common modal component for dialogs, forms, etc.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

let modalStack: number[] = [];
let nextModalId = 0;

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** If provided, called instead of onClose when backdrop is clicked */
  onBackdropClick?: () => void;
}

export function Modal({ isOpen, onClose, title, children, size = 'md', onBackdropClick }: ModalProps) {
  const { t } = useTranslation('common');
  const modalRef = useRef<HTMLDivElement>(null);
  const modalId = useRef(nextModalId++).current;

  // Track modal in stack (topmost = last)
  useEffect(() => {
    if (isOpen) {
      modalStack.push(modalId);
      return () => {
        modalStack = modalStack.filter(id => id !== modalId);
      };
    }
  }, [isOpen, modalId]);

  // Close on ESC key — only if this is the topmost modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && modalStack[modalStack.length - 1] === modalId) {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, modalId]);
  
  // Track where mousedown started to prevent text-drag from triggering backdrop close
  const mouseDownTarget = useRef<EventTarget | null>(null);
  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTarget.current = e.target;
  };
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) {
      (onBackdropClick ?? onClose)();
    }
    mouseDownTarget.current = null;
  };
  
  if (!isOpen) return null;
  
  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };
  
  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={handleMouseDown}
      onClick={handleBackdropClick}
    >
      <div 
        ref={modalRef}
        className={`relative w-full ${sizeClasses[size]} mx-4 bg-white dark:bg-gray-800 rounded-lg shadow-2xl animate-fadeIn`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={t('modal.closeModal')}
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
        
        {/* Content */}
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

