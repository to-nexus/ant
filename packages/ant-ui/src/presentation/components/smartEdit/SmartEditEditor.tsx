import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import type { SmartEditConfig, SmartEditGroup, DeserializeResult } from './config';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Props
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SmartEditEditorProps {
  content: string;
  config: SmartEditConfig;
  initialResult: DeserializeResult & { ok: true };
  onChange: (serialized: string) => void;
  disabled?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Single row input for one value
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ValueRowProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  inputRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
  disabled?: boolean;
}

function ValueRow({ value, placeholder, onChange, onRemove, onKeyDown, inputRef, disabled }: ValueRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const assignRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      if (typeof inputRef === 'function') inputRef(el as unknown as HTMLInputElement);
      else if (inputRef && typeof inputRef === 'object')
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el as unknown as HTMLInputElement;
    },
    [inputRef],
  );

  // Auto-resize textarea to fit content (word-wrap without scrollbar)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const isFilled = value.trim().length > 0;

  return (
    <div className={`group flex items-start gap-0 border-b border-gray-200 dark:border-gray-700 last:border-b-0
      ${isFilled ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}`}
    >
      {/* Wrapping textarea */}
      <textarea
        ref={assignRef}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ''))}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={`flex-1 py-2.5 px-5 text-sm border-0 resize-none overflow-hidden
          placeholder:text-gray-400 dark:placeholder:text-gray-500
          focus:outline-none focus:bg-blue-50/50 dark:focus:bg-blue-900/10
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isFilled
            ? 'bg-transparent font-mono text-emerald-800 dark:text-emerald-300'
            : 'bg-transparent text-gray-900 dark:text-white'
          }`}
        style={{ wordBreak: 'break-all' }}
        spellCheck={false}
      />

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="flex-shrink-0 w-8 mt-2 h-8 flex items-center justify-center
          text-gray-300 dark:text-gray-600
          opacity-0 group-hover:opacity-100 focus:opacity-100
          hover:text-red-500 dark:hover:text-red-400
          transition-all disabled:hidden"
        tabIndex={-1}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Group: a section header + list of value rows
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface GroupEditorProps {
  group: SmartEditGroup;
  resolvedPlaceholder?: string;
  onValuesChange: (values: string[]) => void;
  disabled?: boolean;
}

function GroupEditor({ group, resolvedPlaceholder, onValuesChange, disabled }: GroupEditorProps) {
  const newRowRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<number, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const [newValue, setNewValue] = useState('');

  const handleRowChange = useCallback((index: number, value: string) => {
    const updated = [...group.values];
    updated[index] = value;
    onValuesChange(updated);
  }, [group.values, onValuesChange]);

  const handleRemove = useCallback((index: number) => {
    const updated = group.values.filter((_, i) => i !== index);
    onValuesChange(updated);
  }, [group.values, onValuesChange]);

  const handleAdd = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Support pasting multiple lines at once
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    onValuesChange([...group.values, ...lines]);
    setNewValue('');
  }, [group.values, onValuesChange]);

  const handleNewRowKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd(newValue);
    }
  }, [newValue, handleAdd]);

  const handleNewRowPaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted.includes('\n')) {
      e.preventDefault();
      const lines = pasted.split('\n').map(l => l.trim()).filter(Boolean);
      onValuesChange([...group.values, ...lines]);
      setNewValue('');
    }
  }, [group.values, onValuesChange]);

  const handleExistingRowKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && group.values[index] === '') {
      e.preventDefault();
      handleRemove(index);
      // Focus previous row or the new-row input
      requestAnimationFrame(() => {
        if (index > 0) {
          rowRefs.current.get(index - 1)?.focus();
        } else {
          newRowRef.current?.focus();
        }
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Focus the new-row input at the bottom
      newRowRef.current?.focus();
    }
  }, [group.values, handleRemove]);

  const label = group.label ?? (group.key !== null ? group.key : null);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {label && (
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide px-1">
          {label}
        </div>
      )}

      <div className="flex-1 border rounded-lg overflow-auto bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
        {/* Existing value rows */}
        {group.values.map((val, i) => (
          <ValueRow
            key={i}
            value={val}
            onChange={(v) => handleRowChange(i, v)}
            onRemove={() => handleRemove(i)}
            onKeyDown={(e) => handleExistingRowKeyDown(i, e)}
            inputRef={(el) => {
              if (el) rowRefs.current.set(i, el);
              else rowRefs.current.delete(i);
            }}
            disabled={disabled}
          />
        ))}

        {/* New entry row */}
        <div className="flex items-center gap-0 bg-gray-50/50 dark:bg-gray-900/30">
          <div className="flex-shrink-0 w-10 py-2.5 flex items-center justify-center">
            <Plus className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
          </div>
          <input
            ref={newRowRef}
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleNewRowKeyDown}
            onPaste={handleNewRowPaste}
            onBlur={() => {
              if (newValue.trim()) handleAdd(newValue);
            }}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            className="flex-1 py-2.5 px-3 text-sm bg-transparent border-0
              text-gray-900 dark:text-white
              placeholder:text-gray-400 dark:placeholder:text-gray-500
              focus:outline-none
              disabled:opacity-50 disabled:cursor-not-allowed"
            spellCheck={false}
          />
          <div className="flex-shrink-0 w-8" />
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function SmartEditEditor({
  content,
  config,
  initialResult,
  onChange,
  disabled,
}: SmartEditEditorProps) {
  const { t } = useTranslation('artifacts');

  const [groups, setGroups] = useState<SmartEditGroup[]>(initialResult.groups);
  const [preserved, setPreserved] = useState<Record<string, unknown>>(initialResult.preserved);

  // Track self-originated serializations to avoid circular re-deserialize
  const lastSelfSerialized = useRef(content);

  useEffect(() => {
    if (content !== lastSelfSerialized.current) {
      const result = config.deserialize(content);
      if (result.ok) {
        setGroups(result.groups);
        setPreserved(result.preserved);
      }
      lastSelfSerialized.current = content;
    }
  }, [content, config]);

  const handleGroupValuesChange = useCallback(
    (index: number, newValues: string[]) => {
      const updated = groups.map((g, i) => (i === index ? { ...g, values: newValues } : g));
      setGroups(updated);
      const serialized = config.serialize(updated, preserved);
      lastSelfSerialized.current = serialized;
      onChange(serialized);
    },
    [groups, preserved, config, onChange],
  );

  return (
    <div className="flex flex-col gap-3 flex-1 overflow-hidden">
      {groups.map((group, index) => {
        const resolvedPlaceholder = group.placeholder ? t(group.placeholder) : undefined;
        return (
          <GroupEditor
            key={group.key ?? index}
            group={group}
            resolvedPlaceholder={resolvedPlaceholder}
            onValuesChange={(values) => handleGroupValuesChange(index, values)}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
}
