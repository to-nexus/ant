import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { MentionSuggestion } from './hooks/useMentionAutocomplete';
import {
  Target, Crosshair, FileText, BookOpen, Zap, FolderTree, ClipboardList, Bot, Workflow, Folder, ChevronRight,
} from 'lucide-react';

const TYPE_ICONS: Record<string, any> = {
  intent: Target,
  target: Crosshair,
  ref: FileText,
  context: BookOpen,
  agentCtx: Bot,
  pipelineCtx: Workflow,
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
  pipelineCtx: 'text-fuchsia-500',
  explicit: 'text-indigo-500',
  plan: 'text-amber-500',
  browse: 'text-violet-500',
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
  /** Attach the row — or, for a directory that cannot be attached, enter it. */
  onSelect: (suggestion: MentionSuggestion) => void;
  /** Descend into a directory row (the › affordance). */
  onEnter?: (suggestion: MentionSuggestion) => void;
  onHover: (index: number) => void;
  /** Where the user is in the tree while a file prefix is armed. */
  breadcrumb?: { prefix: string; crumbs: string[] } | null;
}

export function MentionDropdown({ suggestions, selectedIndex, onSelect, onEnter, onHover, breadcrumb }: MentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('chat');

  useEffect(() => {
    if (!listRef.current) return;
    const buttons = listRef.current.querySelectorAll('[data-suggestion-idx]');
    const el = buttons[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  return (
    <div
      className="overflow-hidden z-50 mb-1 flex flex-col"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {breadcrumb && (
        <div
          className="flex items-center gap-1 px-3 py-1 text-[10px] text-[color:var(--text-4)] select-none shrink-0"
          style={{ borderBottom: '1px solid var(--border-1)' }}
        >
          <span className="font-mono">{breadcrumb.prefix}</span>
          {breadcrumb.crumbs.length === 0 ? (
            <>
              <span>›</span>
              <span>{t('mention.nav.root')}</span>
            </>
          ) : (
            breadcrumb.crumbs.map((crumb, i) => (
              <span key={`${i}-${crumb}`} className="flex items-center gap-1 min-w-0">
                <span>›</span>
                <span className="truncate">{crumb}</span>
              </span>
            ))
          )}
        </div>
      )}
      <div ref={listRef} className="max-h-72 overflow-y-auto">
        {suggestions.map((s, idx) => {
          const isCommand = s.type === 'command';
          const isDir = s.nodeType === 'directory';
          const cmdMapping = isCommand ? COMMAND_ICON_MAP[s.id] : null;
          const Icon = cmdMapping?.icon || (isDir && s.type !== 'agentCtx' && s.type !== 'pipelineCtx' ? Folder : TYPE_ICONS[s.type]) || FileText;
          const color = cmdMapping?.color || TYPE_COLORS[s.type] || 'text-gray-500';
          const isSelected = idx === selectedIndex;
          const hint = isCommand
            ? s.id
            : s.selectable
              ? t('mention.nav.attachHint')
              : s.enterable
                ? t('mention.nav.enterHint')
                : '';

          return (
            <div
              key={`${s.type}-${s.id}-${idx}`}
              data-suggestion-idx={idx}
              className="relative w-full flex items-stretch text-sm transition-colors hover:bg-[color:var(--bg-hover)]"
              style={isSelected ? { background: 'oklch(from var(--violet-500) l c h / 0.10)' } : undefined}
              onMouseEnter={() => onHover(idx)}
            >
              {isSelected && (
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--gradient-aurora)' }}
                />
              )}
              <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 text-left"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(s);
                }}
              >
                <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                <div className="flex-1 min-w-0 flex items-baseline">
                  {s.group === 'suggested' && (
                    <span className="mr-1 text-[10px] text-[color:var(--text-4)]" aria-hidden="true">★</span>
                  )}
                  <span className="font-medium text-[color:var(--text-1)] truncate">{s.label}</span>
                  {s.description && s.description !== s.label && (
                    <span className="ml-2 text-xs text-[color:var(--text-3)] truncate">{s.description}</span>
                  )}
                </div>
                {hint && (
                  <span className="text-[10px] text-[color:var(--text-4)] shrink-0 font-mono">{hint}</span>
                )}
              </button>
              {s.enterable && onEnter && (
                <button
                  type="button"
                  aria-label={t('mention.nav.enterHint')}
                  className="shrink-0 px-2 flex items-center text-[color:var(--text-4)] hover:text-[color:var(--text-1)]"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onEnter(s);
                  }}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
