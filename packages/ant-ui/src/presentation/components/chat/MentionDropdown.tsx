import { useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { MentionSuggestion } from './hooks/useMentionAutocomplete';
import { Target, Crosshair, FileText, BookOpen, Zap, FolderTree, ClipboardList, Bot } from 'lucide-react';

const TYPE_ICONS: Record<string, any> = {
  intent: Target,
  target: Crosshair,
  ref: FileText,
  context: BookOpen,
  agentCtx: Bot,
  explicit: Zap,
  plan: ClipboardList,
  browse: FolderTree,
};

const TYPE_COLORS: Record<string, string> = {
  intent: 'text-blue-500',
  target: 'text-orange-500',
  ref: 'text-emerald-500',
  context: 'text-gray-500',
  agentCtx: 'text-cyan-500',
  explicit: 'text-indigo-500',
  plan: 'text-amber-500',
  browse: 'text-violet-500',
};

/** Group header i18n keys under `chat:mention.group`. Keyed by
 * `MentionSuggestion.group` so a new namespace is one row here, not another
 * ternary. */
const GROUP_LABEL_KEYS: Record<string, string> = {
  suggested: 'suggested',
  all: 'all',
  artifacts: 'artifacts',
  agents: 'agentDefinitions',
};

const COMMAND_ICON_MAP: Record<string, { icon: any; color: string }> = {
  '@intent:':  { icon: Target,        color: 'text-blue-500' },
  '@target:':  { icon: Crosshair,     color: 'text-orange-500' },
  '@ref:':     { icon: FileText,      color: 'text-emerald-500' },
  '@ctx:':     { icon: BookOpen,      color: 'text-gray-500' },
  '@explicit': { icon: Zap,           color: 'text-indigo-500' },
  '@plan':     { icon: ClipboardList, color: 'text-amber-500' },
};

interface MentionDropdownProps {
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: MentionSuggestion) => void;
  onHover: (index: number) => void;
}

export function MentionDropdown({ suggestions, selectedIndex, onSelect, onHover }: MentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('chat');

  useEffect(() => {
    if (!listRef.current) return;
    const buttons = listRef.current.querySelectorAll('[data-suggestion-idx]');
    const el = buttons[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  const hasGroups = suggestions.some(s => s.group);

  return (
    <div
      ref={listRef}
      className="overflow-hidden z-50 max-h-48 overflow-y-auto mb-1"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {suggestions.map((s, idx) => {
        const prevGroup = idx > 0 ? suggestions[idx - 1].group : undefined;
        const showGroupHeader = hasGroups && s.group && s.group !== prevGroup;

        const isCommand = s.type === 'command';
        const cmdMapping = isCommand ? COMMAND_ICON_MAP[s.id] : null;
        const Icon = cmdMapping?.icon || TYPE_ICONS[s.type] || FileText;
        const color = cmdMapping?.color || TYPE_COLORS[s.type] || 'text-gray-500';
        const isSelected = idx === selectedIndex;

        return (
          <Fragment key={`${s.type}-${s.id}-${idx}`}>
            {showGroupHeader && (
              <>
                {prevGroup && (
                  <div style={{ borderTop: '1px solid var(--border-1)' }} />
                )}
                <div className="px-3 py-1 text-[10px] font-medium text-[color:var(--text-4)] uppercase tracking-wider select-none">
                  {t(`mention.group.${GROUP_LABEL_KEYS[s.group!] ?? 'all'}`)}
                </div>
              </>
            )}
            <button
              data-suggestion-idx={idx}
              type="button"
              className={`relative w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--bg-hover)]`}
              style={
                isSelected
                  ? { background: 'oklch(from var(--violet-500) l c h / 0.10)' }
                  : undefined
              }
              onMouseEnter={() => onHover(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(s);
              }}
            >
              {isSelected && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: 'var(--gradient-aurora)',
                  }}
                />
              )}
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-[color:var(--text-1)]">{s.label}</span>
                {s.description && s.description !== s.label && (
                  <span className="ml-2 text-xs text-[color:var(--text-3)] truncate">{s.description}</span>
                )}
              </div>
              {isCommand ? (
                <span className="text-[10px] text-[color:var(--text-4)] shrink-0 font-mono">{s.id}</span>
              ) : (
                <span className="text-[10px] text-[color:var(--text-4)] shrink-0 uppercase">{s.type}</span>
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
