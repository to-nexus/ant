import { useState, useCallback, useMemo } from 'react';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  getConfigSlots,
  type IntentId,
} from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';

export interface MentionSuggestion {
  type: 'intent' | 'target' | 'ref' | 'context' | 'explicit' | 'command';
  id: string;
  label: string;
  description?: string;
  group?: 'suggested' | 'all';
}

const MENTION_PREFIXES = ['@intent:', '@target:', '@ref:', '@ctx:', '@explicit'] as const;
type MentionPrefix = (typeof MENTION_PREFIXES)[number];

type FileMentionPrefix = '@target:' | '@ref:' | '@ctx:';

const COMMAND_MENU: MentionSuggestion[] = [
  { type: 'command', id: '@intent:', label: 'intent', description: '작업 의도를 지정' },
  { type: 'command', id: '@target:', label: 'target', description: '대상 파일을 지정' },
  { type: 'command', id: '@ref:',    label: 'ref',    description: '참조 문서를 추가' },
  { type: 'command', id: '@ctx:',    label: 'ctx',    description: '컨텍스트 문서를 추가' },
  { type: 'command', id: '@explicit',label: 'explicit',description: '추론 생략, 직접 지정' },
];

function flattenFilePaths(nodes: FileNode[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') {
      paths.push(fullPath);
    }
    if (node.children) {
      paths.push(...flattenFilePaths(node.children, fullPath));
    }
  }
  return paths;
}

function getSuggestedDirs(intent: IntentId, prefix: FileMentionPrefix): string[] {
  const slots = getConfigSlots(intent);
  if (!slots) return [];
  const dirs = new Set<string>();
  if (prefix === '@ref:') {
    slots.refs.forEach(s => { if (s.path && !s.codebase) dirs.add(s.path); });
  } else if (prefix === '@ctx:') {
    slots.context.forEach(s => { if (s.path && !s.codebase) dirs.add(s.path); });
  } else if (prefix === '@target:') {
    if (slots.target.kind === 'generate') dirs.add(slots.target.dir);
  }
  return [...dirs];
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function buildGroupedFileSuggestions(
  type: 'target' | 'ref' | 'context',
  prefix: FileMentionPrefix,
  allFilePaths: string[],
  query: string,
  intent: IntentId | undefined,
): MentionSuggestion[] {
  const q = query.toLowerCase();
  const baseFilter = prefix === '@target:'
    ? (p: string) => p.toLowerCase().includes(q) && p.startsWith('outputs/')
    : (p: string) => p.toLowerCase().includes(q);
  const filtered = allFilePaths.filter(baseFilter);

  const suggestedDirs = intent ? getSuggestedDirs(intent, prefix) : [];
  if (suggestedDirs.length === 0) {
    return filtered.slice(0, 10).map(p => ({
      type, id: p, label: basename(p), description: p,
    }));
  }

  const isSuggested = (path: string) =>
    suggestedDirs.some(dir => path.startsWith(dir + '/') || path === dir);
  const suggested = filtered.filter(isSuggested);
  const rest = filtered.filter(p => !isSuggested(p));

  return [
    ...suggested.slice(0, 8).map(p => ({
      type, id: p, label: basename(p), description: p, group: 'suggested' as const,
    })),
    ...rest.slice(0, 8).map(p => ({
      type, id: p, label: basename(p), description: p, group: 'all' as const,
    })),
  ];
}

export function useMentionAutocomplete(message: string, cursorPos: number) {
  const [, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const fileTree = useStore(s => s.fileTree);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const actionMetadata = useStore(s => s.actionMetadata);

  const allFilePaths = useMemo(() => flattenFilePaths(fileTree), [fileTree]);

  const { prefix, query, matchStart, commandQuery } = useMemo(() => {
    const textBeforeCursor = message.slice(0, cursorPos);

    for (const p of MENTION_PREFIXES) {
      const lastIdx = textBeforeCursor.lastIndexOf(p);
      if (lastIdx >= 0) {
        const afterPrefix = textBeforeCursor.slice(lastIdx + p.length);
        if (!afterPrefix.includes(' ') || afterPrefix.length < 50) {
          return { prefix: p as MentionPrefix, query: afterPrefix, matchStart: lastIdx, commandQuery: null as string | null };
        }
      }
    }

    const atMatch = textBeforeCursor.match(/@([a-z]*)$/);
    if (atMatch) {
      return { prefix: null as MentionPrefix | null, query: '', matchStart: atMatch.index!, commandQuery: atMatch[1] };
    }

    return { prefix: null as MentionPrefix | null, query: '', matchStart: -1, commandQuery: null as string | null };
  }, [message, cursorPos]);

  const suggestions = useMemo((): MentionSuggestion[] => {
    if (commandQuery !== null) {
      if (commandQuery === '') return COMMAND_MENU;
      return COMMAND_MENU.filter(c => c.label.startsWith(commandQuery));
    }

    if (!prefix) return [];
    const q = query.toLowerCase();

    switch (prefix) {
      case '@intent:':
        return INTENT_DEFINITIONS
          .filter(d => d.id.toLowerCase().includes(q) || d.label.en.toLowerCase().includes(q) || d.label.ko.includes(q))
          .slice(0, 8)
          .map(d => ({ type: 'intent', id: d.id, label: d.id, description: d.label.ko }));

      case '@target:':
        return buildGroupedFileSuggestions('target', '@target:', allFilePaths, query, actionMetadata.intent);

      case '@ref:':
        return buildGroupedFileSuggestions('ref', '@ref:', allFilePaths, query, actionMetadata.intent);

      case '@ctx:':
        return buildGroupedFileSuggestions('context', '@ctx:', allFilePaths, query, actionMetadata.intent);

      case '@explicit':
        if (q === '') return [{ type: 'explicit', id: 'true', label: 'Explicit', description: 'Skip triage, use metadata as-is' }];
        return [];

      default:
        return [];
    }
  }, [prefix, query, commandQuery, allFilePaths, actionMetadata.intent]);

  const showSuggestions = (prefix !== null || commandQuery !== null) && suggestions.length > 0;

  const applySuggestion = useCallback((suggestion: MentionSuggestion): { newMessage: string; newCursorPos: number } => {
    const beforeMention = message.slice(0, matchStart);
    const afterCursor = message.slice(cursorPos);

    if (suggestion.type === 'command') {
      if (suggestion.id === '@explicit') {
        updateActionMetadata({ explicit: true });
        const newMessage = (beforeMention + afterCursor).trimStart();
        setIsOpen(false);
        setSelectedIndex(0);
        return { newMessage, newCursorPos: Math.max(0, beforeMention.length) };
      }
      const newMessage = beforeMention + suggestion.id + afterCursor;
      setIsOpen(false);
      setSelectedIndex(0);
      return { newMessage, newCursorPos: matchStart + suggestion.id.length };
    }

    const newMessage = beforeMention + afterCursor;

    switch (suggestion.type) {
      case 'intent':
        updateActionMetadata({ intent: suggestion.id as IntentId });
        break;
      case 'target':
        updateActionMetadata({
          target: [...(actionMetadata.target || []).filter(t => t !== suggestion.id), suggestion.id],
        });
        break;
      case 'ref':
        updateActionMetadata({
          refs: [...(actionMetadata.refs || []).filter(r => r !== suggestion.id), suggestion.id],
        });
        break;
      case 'context':
        updateActionMetadata({
          context: [...(actionMetadata.context || []).filter(c => c !== suggestion.id), suggestion.id],
        });
        break;
      case 'explicit':
        updateActionMetadata({ explicit: suggestion.id === 'true' });
        break;
    }

    setIsOpen(false);
    setSelectedIndex(0);
    return { newMessage: newMessage.trimStart(), newCursorPos: beforeMention.length };
  }, [message, cursorPos, matchStart, updateActionMetadata, actionMetadata]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): false | { newMessage: string; newCursorPos: number } => {
    if (!showSuggestions) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % suggestions.length);
        return { newMessage: message, newCursorPos: cursorPos };
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + suggestions.length) % suggestions.length);
        return { newMessage: message, newCursorPos: cursorPos };
      case 'Tab':
      case 'Enter':
        if (suggestions[selectedIndex]) {
          e.preventDefault();
          return applySuggestion(suggestions[selectedIndex]);
        }
        return false;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        return { newMessage: message, newCursorPos: cursorPos };
      default:
        return false;
    }
  }, [showSuggestions, suggestions, selectedIndex, applySuggestion, message, cursorPos]);

  return {
    suggestions,
    showSuggestions,
    selectedIndex,
    setSelectedIndex,
    applySuggestion,
    handleKeyDown,
    isOpen: showSuggestions,
    setIsOpen,
  };
}
