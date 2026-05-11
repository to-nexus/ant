import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  ACTION_DEFINITIONS,
  getConfigSlotsForDomain,
  isActionSurfaced,
  getIntentLabel,
  type IntentDefinitionShape,
  type IntentId,
  type Domain,
  type IntentGroup,
  type ConfigSlots,
} from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { useActionFooterPolicy } from '@/application/hooks/ui/useActionFooterPolicy';

export interface MentionSuggestion {
  type: 'intent' | 'target' | 'ref' | 'context' | 'explicit' | 'command';
  id: string;
  label: string;
  description?: string;
  group?: 'suggested' | 'all';
}

// Phase 2 (D22): `domain` is a workspace-scoped 1st-class selector and is
// mutated only via `DomainToggle`. The chat-input mention surface is
// turn-scoped and would let users desync workspace state per-message,
// so `@domain:` is intentionally absent from this list.
const MENTION_PREFIXES = ['@intent:', '@target:', '@ref:', '@ctx:', '@explicit'] as const;
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

interface SuggestedSlots {
  /** Slot directory paths matching the mention prefix. */
  dirs: string[];
  /**
   * Domain-aware excluded full paths. Built from `slot.excludeFiles` so
   * a service workspace's `@ref:plan/` mention listing hides `gdd.md`
   * and a game workspace hides `prd.md` — mirrors the
   * `ActionConfigView` listing's `excludeFiles` filter.
   */
  excludedPaths: Set<string>;
}

function collectExcludedPaths(slot: { path: string; excludeFiles?: string[] }, out: Set<string>): void {
  if (!slot.path || !slot.excludeFiles) return;
  for (const filename of slot.excludeFiles) {
    out.add(`${slot.path}/${filename}`);
  }
}

function getSuggestedSlots(
  intent: IntentId,
  prefix: FileMentionPrefix,
  domain: Domain | undefined,
): SuggestedSlots {
  // D28-revised — single domain-aware slot SSOT. Drops wrong-domain
  // slots (`gen-code-*` ui-source vs game-art-source) and rewrites
  // plan-dir slot `excludeFiles` so a workspace mention surface only
  // ever suggests files for its own domain.
  const slots: ConfigSlots | null = getConfigSlotsForDomain(intent, domain ?? 'service');
  if (!slots) return { dirs: [], excludedPaths: new Set() };
  const dirs = new Set<string>();
  const excludedPaths = new Set<string>();
  if (prefix === '@ref:') {
    slots.refs.forEach(s => {
      if (s.path && !s.codebase) dirs.add(s.path);
      collectExcludedPaths(s, excludedPaths);
    });
  } else if (prefix === '@ctx:') {
    slots.context.forEach(s => {
      if (s.path && !s.codebase) dirs.add(s.path);
      collectExcludedPaths(s, excludedPaths);
    });
  } else if (prefix === '@target:') {
    if (slots.target.kind === 'generate') dirs.add(slots.target.dir);
  }
  return { dirs: [...dirs], excludedPaths };
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
  // `@target:` should suggest files in writable artifact domains only —
  // `architecture/`, `visual/`, `meta/evals/` (replaces legacy `outputs/`).
  const isWritableArtifactPath = (p: string): boolean =>
    p.startsWith('architecture/') ||
    p.startsWith('visual/') ||
    p.startsWith('meta/evals/');
  const slotInfo = intent
    ? getSuggestedSlots(intent, prefix, domain)
    : { dirs: [] as string[], excludedPaths: new Set<string>() };
  const baseFilter = prefix === '@target:'
    ? (p: string) => p.toLowerCase().includes(q) && isWritableArtifactPath(p) && !slotInfo.excludedPaths.has(p)
    : (p: string) => p.toLowerCase().includes(q) && !slotInfo.excludedPaths.has(p);
  const filtered = allFilePaths.filter(baseFilter);

  const suggestedDirs = slotInfo.dirs;
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
  ], [t]);

  const EXPLICIT_COMMAND = useMemo<MentionSuggestion>(() => ({
    type: 'command',
    id: '@explicit',
    label: t('mention.explicit.label'),
    description: t('mention.explicit.description'),
  }), [t]);

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
        // Mirror the ActionsPanel surfacing rule so users cannot side-step
        // via mention. `isActionSurfaced` closes BOTH axes: the domain gate
        // (Phase 2 / D22 — `design-game-art` hidden when domain==='service',
        // `design-ui` hidden when domain==='game') AND the status axis
        // (`status: 'hidden'` cards like `learn-codebase` are removed from
        // every UI surface).
        const hiddenGroups = new Set<IntentGroup>(
          ACTION_DEFINITIONS
            .filter(def => !isActionSurfaced(def, actionMetadata.domain))
            .map(def => def.id)
        );
        return INTENT_DEFINITIONS
          .filter(d => !hiddenGroups.has(d.intentGroup))
          // Match against BOTH the static and the domain-correct labels
          // so a game-domain user can search for "GDD" and a service user
          // for "PRD" — without losing matches against the canonical
          // base label (e.g. legacy mentions, search snippets). The cast
          // widens the literal-narrowed union element to the SSOT shape
          // so optional `labelByDomain` access compiles for every entry.
          .filter(d => {
            const def = d as IntentDefinitionShape;
            const labelEnService = (def.labelByDomain?.service?.en ?? def.label.en).toLowerCase();
            const labelEnGame = (def.labelByDomain?.game?.en ?? def.label.en).toLowerCase();
            const labelKoService = def.labelByDomain?.service?.ko ?? def.label.ko;
            const labelKoGame = def.labelByDomain?.game?.ko ?? def.label.ko;
            return def.id.toLowerCase().includes(q)
              || labelEnService.includes(q)
              || labelEnGame.includes(q)
              || labelKoService.includes(q)
              || labelKoGame.includes(q);
          })
          .slice(0, 8)
          .map(d => ({ type: 'intent', id: d.id, label: d.id, description: getIntentLabel(d, actionMetadata.domain, 'ko') }));
      }

      case '@target:':
        return buildGroupedFileSuggestions('target', '@target:', allFilePaths, query, actionMetadata.intent, actionMetadata.domain);

      case '@ref:':
        return buildGroupedFileSuggestions('ref', '@ref:', allFilePaths, query, actionMetadata.intent, actionMetadata.domain);

      case '@ctx:':
        return buildGroupedFileSuggestions('context', '@ctx:', allFilePaths, query, actionMetadata.intent, actionMetadata.domain);

      case '@explicit':
        if (!explicitSettable) return [];
        if (q === '') return [{ type: 'explicit', id: 'true', label: 'Explicit', description: 'Skip triage, use metadata as-is' }];
        return [];

      default:
        return [];
    }
  }, [prefix, query, commandQuery, allFilePaths, actionMetadata.intent, actionMetadata.domain, explicitSettable, COMMAND_MENU_BASE, EXPLICIT_COMMAND]);

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
