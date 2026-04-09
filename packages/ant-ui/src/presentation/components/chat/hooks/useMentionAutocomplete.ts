import { useState, useCallback, useMemo } from 'react';
import { useStore } from '@/domain/store';
import { INTENT_DEFINITIONS, type ActionMetadata } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';

export interface MentionSuggestion {
  type: 'intent' | 'target' | 'ref' | 'context' | 'basis';
  id: string;
  label: string;
  description?: string;
}

const MENTION_PREFIXES = ['@intent:', '@target:', '@ref:', '@ctx:', '@basis:'] as const;
type MentionPrefix = (typeof MENTION_PREFIXES)[number];

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

export function useMentionAutocomplete(message: string, cursorPos: number) {
  const [, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const fileTree = useStore(s => s.fileTree);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const actionMetadata = useStore(s => s.actionMetadata);

  const allFilePaths = useMemo(() => flattenFilePaths(fileTree), [fileTree]);

  const { prefix, query, matchStart } = useMemo(() => {
    const textBeforeCursor = message.slice(0, cursorPos);
    for (const p of MENTION_PREFIXES) {
      const lastIdx = textBeforeCursor.lastIndexOf(p);
      if (lastIdx >= 0) {
        const afterPrefix = textBeforeCursor.slice(lastIdx + p.length);
        if (!afterPrefix.includes(' ') || afterPrefix.length < 50) {
          return { prefix: p as MentionPrefix, query: afterPrefix, matchStart: lastIdx };
        }
      }
    }
    return { prefix: null, query: '', matchStart: -1 };
  }, [message, cursorPos]);

  const suggestions = useMemo((): MentionSuggestion[] => {
    if (!prefix) return [];
    const q = query.toLowerCase();

    switch (prefix) {
      case '@intent:':
        return INTENT_DEFINITIONS
          .filter(d => d.id.toLowerCase().includes(q) || d.label.en.toLowerCase().includes(q) || d.label.ko.includes(q))
          .slice(0, 8)
          .map(d => ({ type: 'intent', id: d.id, label: d.id, description: d.label.ko || d.label.en }));

      case '@target:':
        return allFilePaths
          .filter(p => p.toLowerCase().includes(q) && p.startsWith('outputs/'))
          .slice(0, 8)
          .map(p => ({ type: 'target', id: p, label: p.split('/').pop() || p, description: p }));

      case '@ref:':
        return allFilePaths
          .filter(p => p.toLowerCase().includes(q))
          .slice(0, 8)
          .map(p => ({ type: 'ref', id: p, label: p.split('/').pop() || p, description: p }));

      case '@ctx:':
        return allFilePaths
          .filter(p => p.toLowerCase().includes(q))
          .slice(0, 8)
          .map(p => ({ type: 'context', id: p, label: p.split('/').pop() || p, description: p }));

      case '@basis:':
        return ['prd', 'directive', 'existing-doc', 'figma', 'references']
          .filter(b => b.includes(q))
          .map(b => ({ type: 'basis', id: b, label: b }));

      default:
        return [];
    }
  }, [prefix, query, allFilePaths]);

  const showSuggestions = prefix !== null && suggestions.length > 0;

  const applySuggestion = useCallback((suggestion: MentionSuggestion): { newMessage: string; newCursorPos: number } => {
    const beforeMention = message.slice(0, matchStart);
    const afterCursor = message.slice(cursorPos);
    const newMessage = beforeMention + afterCursor;

    switch (suggestion.type) {
      case 'intent':
        updateActionMetadata({ intent: suggestion.id });
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
      case 'basis':
        updateActionMetadata({ basis: suggestion.id as ActionMetadata['basis'] });
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
