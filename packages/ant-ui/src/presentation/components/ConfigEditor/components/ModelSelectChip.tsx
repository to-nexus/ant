import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AvailableModel } from '../hooks/useAvailableModels';

const PROVIDER_ICON: Record<string, string> = {
  anthropic: '⬡',
  google: '◈',
  openai: '◉',
};

interface ModelSelectChipProps {
  value: string;
  models: AvailableModel[];
  onChange: (modelId: string) => void;
  placeholder?: string;
  inheritedModel?: {
    id: string;
    displayName: string;
    provider: string;
  };
  showAsCustom?: boolean;
}

interface DropdownPosition {
  top: number;
  left: number;
  direction: 'down' | 'up';
}

export function ModelSelectChip({
  value,
  models,
  onChange,
  placeholder,
  inheritedModel,
  showAsCustom,
}: ModelSelectChipProps) {
  const { t } = useTranslation('config');
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0, direction: 'down' });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction = spaceBelow < 320 ? 'up' : 'down';
    setPosition({
      top: direction === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      direction,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, updatePosition]);

  const selected = models.find(m => m.id === value);
  const isInherited = !value && !!inheritedModel;
  const displayModel = selected || (isInherited ? inheritedModel : null);
  const providerIcon = displayModel ? (PROVIDER_ICON[displayModel.provider] || '') : '';

  const grouped = models.reduce<Record<string, AvailableModel[]>>((acc, m) => {
    const key = m.provider;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});
  const providerOrder = ['anthropic', 'google', 'openai'].filter(p => grouped[p]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
  };

  const dropdown = isOpen && createPortal(
    <div
      ref={dropdownRef}
      className="fixed min-w-[14rem] max-w-[18rem] bg-white dark:bg-gray-800 
        border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden"
      style={{
        zIndex: 9999,
        left: position.left,
        ...(position.direction === 'down'
          ? { top: position.top }
          : { bottom: window.innerHeight - position.top }),
      }}
    >
      {inheritedModel && (
        <button
          type="button"
          onClick={() => handleSelect('')}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors
            border-b border-gray-100 dark:border-gray-700
            ${!value
              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
        >
          <span className="text-xs opacity-60">{PROVIDER_ICON[inheritedModel.provider] || ''}</span>
          <span className="truncate">{inheritedModel.displayName}</span>
          <span className="text-[10px] opacity-50 shrink-0">({t('projectEditor.jobDefault')})</span>
          {!value && <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-blue-500" />}
        </button>
      )}

      <div className="max-h-[280px] overflow-y-auto py-1">
        {providerOrder.map((provider, groupIdx) => (
          <div key={provider}>
            {groupIdx > 0 && <div className="border-t border-gray-100 dark:border-gray-700 my-1" />}
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {provider}
            </div>
            {grouped[provider].map(model => {
              const isSelected = model.id === value;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelect(model.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors
                    ${isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                >
                  <span className="text-xs opacity-50">{PROVIDER_ICON[model.provider] || ''}</span>
                  <span className="truncate">{model.displayName}</span>
                  {model.recommended && (
                    <span className="text-[10px] text-amber-500 dark:text-amber-400 shrink-0">★</span>
                  )}
                  {isSelected && <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-blue-500" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm
          transition-colors cursor-pointer min-w-0 max-w-[13rem]
          ${displayModel
            ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
            : 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 hover:border-gray-400 dark:hover:border-gray-500'
          }`}
      >
        {!showAsCustom && providerIcon && <span className="shrink-0 text-xs opacity-60">{providerIcon}</span>}
        <span className="truncate text-[13px]">
          {showAsCustom
            ? t('projectEditor.custom')
            : displayModel
              ? `${displayModel.displayName}${isInherited ? ` (${t('projectEditor.jobDefault')})` : ''}`
              : (placeholder || t('projectEditor.selectModel'))
          }
        </span>
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {dropdown}
    </>
  );
}
