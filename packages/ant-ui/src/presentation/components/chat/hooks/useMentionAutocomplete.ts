import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  ACTION_DEFINITIONS,
  getConfigSlots,
  filterSlotsByDomain,
  isActionVisibleForDomain,
  type IntentId,
  type Domain,
  type IntentGroup,
} from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { useActionFooterPolicy } from '@/application/hooks/ui/useActionFooterPolicy';

export interface MentionSuggestion {
  type: 'intent' | 'target' | 'ref' | 'context' | 'explicit' | 'command' | 'domain';
  id: string;
  label: string;
  description?: string;
  group?: 'suggested' | 'all';
}

const MENTION_PREFIXES = ['@intent:', '@target:', '@ref:', '@ctx:', '@domain:', '@explicit'] as const;
type MentionPrefix = (typeof MENTION_PREFIXES)[number];

type FileMentionPrefix = '@target:' | '@ref:' | '@ctx:';

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

function getSuggestedDirs(
  intent: IntentId,
  prefix: FileMentionPrefix,
  domain: Domain | undefined,
): string[] {
  const rawSlots = getConfigSlots(intent);
  if (!rawSlots) return [];
  // D28 — drop slots whose `applicableDomains` does not include the
  // workspace domain so a service workspace does not surface
  // `outputs/design/game-art` and a game workspace does not surface
  // `outputs/design/ui` in mention suggestions.
  const slots = filterSlotsByDomain(rawSlots, domain);
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
  domain: Domain | undefined,
): MentionSuggestion[] {
  const q = query.toLowerCase();
  const baseFilter = prefix === '@target:'
    ? (p: string) => p.toLowerCase().includes(q) && p.startsWith('outputs/')
    : (p: string) => p.toLowerCase().includes(q);
  const filtered = allFilePaths.filter(baseFilter);

  const suggestedDirs = intent ? getSuggestedDirs(intent, prefix, domain) : [];
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
  const { canStartChat } = useActionFooterPolicy();
  const { t } = useTranslation('chat');

  const COMMAND_MENU_BASE = useMemo<MentionSuggestion[]>(() => [
    { type: 'command', id: '@intent:', label: t('mention.intent.label'), description: t('mention.intent.description') },
    { type: 'command', id: '@target:', label: t('mention.target.label'), description: t('mention.target.description') },
    { type: 'command', id: '@ref:',    label: t('mention.ref.label'),    description: t('mention.ref.description') },
    { type: 'command', id: '@ctx:',    label: t('mention.ctx.label'),    description: t('mention.ctx.description') },
    { type: 'command', id: '@domain:', label: t('mention.domain.label'), description: t('mention.domain.description') },
  ], [t]);

  const EXPLICIT_COMMAND = useMemo<MentionSuggestion>(() => ({
    type: 'command',
    id: '@explicit',
    label: t('mention.explicit.label'),
    description: t('mention.explicit.description'),
  }), [t]);

  // Phase 1 domain options for `@domain:` mention. The Domain union is
  // static so we hardcode the value list and only translate the description.
  const DOMAIN_OPTIONS = useMemo<ReadonlyArray<{ id: Domain; label: string; description: string }>>(() => [
    { id: 'game',    label: 'game',    description: t('mention.domain.option.game.description') },
    { id: 'service', label: 'service', description: t('mention.domain.option.service.description') },
  ], [t]);

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

  // `@explicit` suggestion surfaces iff it's both settable (canStartChat) and not already on.
  // Mirrors the ActionFooter button policy so the two entry points are symmetrical.
  const explicitSettable = canStartChat && actionMetadata.explicit !== true;

  const suggestions = useMemo((): MentionSuggestion[] => {
    if (commandQuery !== null) {
      const menu = explicitSettable ? [...COMMAND_MENU_BASE, EXPLICIT_COMMAND] : COMMAND_MENU_BASE;
      if (commandQuery === '') return menu;
      return menu.filter(c => c.label.startsWith(commandQuery));
    }

    if (!prefix) return [];
    const q = query.toLowerCase();

    switch (prefix) {
      case '@intent:': {
        // Phase 2 (D22): mirror the ActionsPanel domain gate so users
        // cannot side-step it via mention. `gen-game-art-*` / `rev-game-art` /
        // `explain-game-art` (intentGroup `design-game-art`) disappear when
        // domain==='service'; `gen-ui-*` / `rev-ui` / `explain-ui`
        // (intentGroup `design-ui`) disappear when domain==='game'. The
        // current workspace domain is `service`.
        const hiddenGroups = new Set<IntentGroup>(
          ACTION_DEFINITIONS
            .filter(def => !isActionVisibleForDomain(def, actionMetadata.domain))
            .map(def => def.id)
        );
        return INTENT_DEFINITIONS
          .filter(d => !hiddenGroups.has(d.intentGroup))
          .filter(d => d.id.toLowerCase().includes(q) || d.label.en.toLowerCase().includes(q) || d.label.ko.includes(q))
          .slice(0, 8)
          .map(d => ({ type: 'intent', id: d.id, label: d.id, description: d.label.ko }));
      }

      case '@target:':
        return buildGroupedFileSuggestions('target', '@target:', allFilePaths, query, actionMetadata.intent, actionMetadata.domain);

      case '@ref:':
        return buildGroupedFileSuggestions('ref', '@ref:', allFilePaths, query, actionMetadata.intent, actionMetadata.domain);

      case '@ctx:':
        return buildGroupedFileSuggestions('context', '@ctx:', allFilePaths, query, actionMetadata.intent, actionMetadata.domain);

      case '@domain:':
        return DOMAIN_OPTIONS
          .filter(d => d.id.toLowerCase().includes(q) || d.label.toLowerCase().includes(q))
          .map(d => ({ type: 'domain', id: d.id, label: d.label, description: d.description }));

      case '@explicit':
        if (!explicitSettable) return [];
        if (q === '') return [{ type: 'explicit', id: 'true', label: 'Explicit', description: 'Skip triage, use metadata as-is' }];
        return [];

      default:
        return [];
    }
  }, [prefix, query, commandQuery, allFilePaths, actionMetadata.intent, actionMetadata.domain, explicitSettable, COMMAND_MENU_BASE, EXPLICIT_COMMAND, DOMAIN_OPTIONS]);

  const showSuggestions = (prefix !== null || commandQuery !== null) && suggestions.length > 0;

  const applySuggestion = useCallback((suggestion: MentionSuggestion): { newMessage: string; newCursorPos: number } => {
    const beforeMention = message.slice(0, matchStart);
    const afterCursor = message.slice(cursorPos);

    if (suggestion.type === 'command') {
      if (suggestion.id === '@explicit') {
        // Manual set path — gated by canStartChat to preserve the invariant
        // that `explicit === true` ⇒ metadata is complete. Manual removal
        // and all other metadata paths remain unconditional.
        if (canStartChat) {
          updateActionMetadata({ explicit: true });
        }
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
      case 'explicit': {
        const next = suggestion.id === 'true';
        // Setting `explicit: true` requires canStartChat (invariant gate).
        // Clearing is always allowed.
        if (!next || canStartChat) {
          updateActionMetadata({ explicit: next ? true : undefined });
        }
        break;
      }
      case 'domain': {
        // Phase 1 invariant — explicit > infer (10.2). Setting domain via
        // mention takes precedence over LLM inference downstream.
        updateActionMetadata({ domain: suggestion.id as Domain });
        break;
      }
    }

    setIsOpen(false);
    setSelectedIndex(0);
    return { newMessage: newMessage.trimStart(), newCursorPos: beforeMention.length };
  }, [message, cursorPos, matchStart, updateActionMetadata, actionMetadata, canStartChat]);

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
