import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  ACTION_DEFINITIONS,
  UNIVERSAL_AGENTS_DIRNAME,
  UNIVERSAL_PIPELINES_DIRNAME,
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
import { useArtifactPickerTree } from '@/application/hooks/ui/useArtifactPickerTree';
import {
  buildNavSuggestions,
  navBreadcrumb,
  popNavLevel,
  splitNavQuery,
  type MentionSuggestion,
  type NavSuggestionOptions,
} from './mentionSuggestions';

export type { MentionSuggestion } from './mentionSuggestions';

/** Which RAC field the folder-tree picker should target when opened from chat. */
export type BrowseField = 'refs' | 'context' | 'target';

// Phase 2 (D22): `domain` is a project-level property (set at project
// creation, changed only in project settings). The chat-input mention
// surface is turn-scoped and would let users desync project state
// per-message, so `@domain:` is intentionally absent from this list.
const MENTION_PREFIXES = ['@intent:', '@target:', '@ref:', '@ctx:', '@explicit'] as const;

// Universal surface (D-E): the mention MECHANISM (parsing / dropdown / token
// removal / keyboard nav) is shared; only vocabulary, cardinality, and the
// target store field differ. The pure data rules live in
// `universalMentionSurface.ts` (store-free, directly testable).
import { UNIVERSAL_MENTION_PREFIXES, ctxAgentIdOf, ctxPipelineIdOf, isUniversalCtxSuggestible } from './universalMentionSurface';

type MentionPrefix =
  | (typeof MENTION_PREFIXES)[number]
  | (typeof UNIVERSAL_MENTION_PREFIXES)[number];

type FileMentionPrefix = '@target:' | '@ref:' | '@ctx:';

/**
 * `_agents/payments-ops/jobs/settle/intents/reconcile/prompt.md`
 * → `payments-ops › settle › reconcile`. A raw mount path tells the user
 * nothing; the breadcrumb is what they picked the row by.
 */
function peerDescription(path: string, agentId: string): string {
  const parts = path.split('/').slice(2); // drop `_agents/{agentId}`
  const crumbs = [agentId];
  if (parts[0] === 'jobs' && parts[1]) crumbs.push(parts[1]);
  if (parts[2] === 'intents' && parts[3]) crumbs.push(parts[3]);
  return crumbs.join(' › ');
}

/** Universal `@ctx:` rows: the definition mounts get their own type (icon) and owner breadcrumb. */
function universalRowFor(node: FileNode): Partial<MentionSuggestion> {
  const agentId = ctxAgentIdOf(node.path);
  if (agentId) return { type: 'agentCtx', description: peerDescription(node.path, agentId) };
  const pipelineId = ctxPipelineIdOf(node.path);
  if (pipelineId) return { type: 'pipelineCtx', description: pipelineId };
  if (node.path === UNIVERSAL_AGENTS_DIRNAME) return { type: 'agentCtx' };
  if (node.path === UNIVERSAL_PIPELINES_DIRNAME) return { type: 'pipelineCtx' };
  return {};
}

/** `@target:` may address writable artifact domains only — `architecture/`, `visual/`, `meta/evals/`. */
function isWritableArtifactPath(p: string): boolean {
  return p.startsWith('architecture/') || p.startsWith('visual/') || p.startsWith('meta/evals/');
}

/** The grafted session log sits outside every job's reach — same exclusion the Browse picker applies. */
function isSessionsPath(p: string): boolean {
  return p === 'sessions' || p.startsWith('sessions/');
}

interface SuggestedSlots {
  /** Slot directory paths matching the mention prefix. */
  dirs: string[];
  /**
   * Excluded full paths. Built from `slot.excludeFiles` so a `@ref:plan/`
   * mention listing hides the plan job's own canonical output (`prd.md`)
   * — mirrors the `ActionConfigView` listing's `excludeFiles` filter.
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

export function useMentionAutocomplete(message: string, cursorPos: number) {
  const [, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // When set, ChatInput opens the unified folder-tree picker for this field
  // (see the MentionDropdown "Browse" row), expanded at the level the user was
  // navigating — captured here because opening it strips the mention token.
  const [browse, setBrowse] = useState<{ field: BrowseField; suggestedDirs: string[] } | null>(null);
  // Same domain-pruned tree the Browse picker renders — the typeahead and the
  // modal must never disagree on what exists.
  const fileTree = useArtifactPickerTree();
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const actionMetadata = useStore(s => s.actionMetadata);
  // Universal surface inputs — vocabulary comes from the selected custom
  // job's own catalog (API data, never a code-resident table).
  const projectType = useStore(s => s.projectType);
  const customAgents = useStore(s => s.customAgents);
  const selectedCustomAgentId = useStore(s => s.selectedCustomAgentId);
  const selectedCustomJobId = useStore(s => s.selectedCustomJobId);
  const addUniversalIntentMention = useStore(s => s.addUniversalIntentMention);
  const addUniversalContextMention = useStore(s => s.addUniversalContextMention);
  const setUniversalContextMentions = useStore(s => s.setUniversalContextMentions);
  const universalContext = useStore(s => s.universalTurnMeta.context);
  const setUniversalPlanMention = useStore(s => s.setUniversalPlanMention);
  const universalPlanOn = useStore(s => s.universalTurnMeta.plan);
  const ensureDefinitionTree = useStore(s => s.ensureDefinitionTree);
  const { canStartChat } = useActionFooterPolicy();
  const { t } = useTranslation('chat');

  const isUniversal = projectType === 'universal';
  const universalJobIntents = useMemo(() => {
    if (!isUniversal) return [];
    const agent = customAgents.find(a => a.id === selectedCustomAgentId);
    return agent?.jobs.find(j => j.id === selectedCustomJobId)?.intents ?? [];
  }, [isUniversal, customAgents, selectedCustomAgentId, selectedCustomJobId]);

  const COMMAND_MENU_BASE = useMemo<MentionSuggestion[]>(() => {
    if (isUniversal) {
      // `@intent:` only surfaces when the selected job declares a catalog;
      // `@plan` only while the flag is off (a second toggle is meaningless).
      return [
        ...(universalJobIntents.length > 0
          ? [{ type: 'command' as const, id: '@intent:', label: t('mention.intent.label'), description: t('mention.universalIntent.description', { defaultValue: 'Attach one of this job\'s intents (a run binds at most one)' }) }]
          : []),
        { type: 'command' as const, id: '@ctx:', label: t('mention.ctx.label'), description: t('mention.ctx.description') },
        ...(!universalPlanOn
          ? [{ type: 'command' as const, id: '@plan', label: t('mention.plan.label', { defaultValue: 'plan' }), description: t('mention.plan.description', { defaultValue: 'Plan turn — produce a plan first, not the work' }) }]
          : []),
      ];
    }
    return [
      { type: 'command', id: '@intent:', label: t('mention.intent.label'), description: t('mention.intent.description') },
      { type: 'command', id: '@target:', label: t('mention.target.label'), description: t('mention.target.description') },
      { type: 'command', id: '@ref:',    label: t('mention.ref.label'),    description: t('mention.ref.description') },
      { type: 'command', id: '@ctx:',    label: t('mention.ctx.label'),    description: t('mention.ctx.description') },
    ];
  }, [t, isUniversal, universalJobIntents.length, universalPlanOn]);

  const EXPLICIT_COMMAND = useMemo<MentionSuggestion>(() => ({
    type: 'command',
    id: '@explicit',
    label: t('mention.explicit.label'),
    description: t('mention.explicit.description'),
  }), [t]);

  const activePrefixes: readonly MentionPrefix[] = isUniversal ? UNIVERSAL_MENTION_PREFIXES : MENTION_PREFIXES;

  const { prefix, query, matchStart, commandQuery } = useMemo(() => {
    const textBeforeCursor = message.slice(0, cursorPos);

    for (const p of activePrefixes) {
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
  }, [message, cursorPos, activePrefixes]);

  const isFilePrefix = prefix === '@target:' || prefix === '@ref:' || prefix === '@ctx:';
  const { dirPrefix, remainder } = useMemo(() => splitNavQuery(isFilePrefix ? query : ''), [isFilePrefix, query]);

  // Level change = a new list; the highlight restarts at the top.
  useEffect(() => { setSelectedIndex(0); }, [prefix, dirPrefix]);

  // Click-to-fetch: descending into `_agents/{id}/` re-reads a tree whose
  // earlier load failed or went stale (a `ready` tree is a no-op).
  useEffect(() => {
    if (!isUniversal || !isFilePrefix) return;
    const agentId = ctxAgentIdOf(dirPrefix);
    if (agentId) void ensureDefinitionTree(agentId);
  }, [isUniversal, isFilePrefix, dirPrefix, ensureDefinitionTree]);

  const navLabels = useMemo<NavSuggestionOptions['labels']>(() => ({
    browse: t('mention.browse.label'),
    browseDescription: t('mention.browse.description'),
    more: (n: number) => t('mention.more', { count: n }),
  }), [t]);

  // `@explicit` suggestion surfaces iff it's both settable (canStartChat) and not already on.
  // Mirrors the ActionFooter button policy so the two entry points are symmetrical.
  // Universal never surfaces it — there is no triage to bypass.
  const explicitSettable = !isUniversal && canStartChat && actionMetadata.explicit !== true;

  const suggestions = useMemo((): MentionSuggestion[] => {
    if (commandQuery !== null) {
      const menu = explicitSettable ? [...COMMAND_MENU_BASE, EXPLICIT_COMMAND] : COMMAND_MENU_BASE;
      if (commandQuery === '') return menu;
      return menu.filter(c => c.label.startsWith(commandQuery));
    }

    if (!prefix) return [];
    const q = query.toLowerCase();

    // Universal surface: data + rules differ, mechanism is shared.
    if (isUniversal) {
      if (prefix === '@intent:') {
        return universalJobIntents
          .filter(i => i.id.toLowerCase().includes(q) || i.infer.toLowerCase().includes(q))
          .slice(0, 8)
          .map(i => ({ type: 'intent' as const, id: i.id, label: i.id, description: i.infer }));
      }
      if (prefix === '@ctx:') {
        // One tree, three namespaces (artifacts, `_agents/`, `_pipelines/`),
        // browsed a level at a time — the mounts are directories like any other.
        return buildNavSuggestions(fileTree, query, {
          field: 'context',
          selectableTypes: ['file', 'directory'],
          isOffered: n => isUniversalCtxSuggestible(n.path),
          rowFor: universalRowFor,
          labels: navLabels,
        });
      }
      if (prefix === '@plan') {
        if (universalPlanOn || q !== '') return [];
        return [{ type: 'plan' as const, id: 'true', label: 'Plan', description: t('mention.plan.description', { defaultValue: 'Plan turn — produce a plan first, not the work' }) }];
      }
      return [];
    }

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
          // Match against the static label plus any per-domain label
          // override. Plan labels are domain-neutral ("PRD"), so both the
          // service and game branches resolve to the same base label; the
          // generic override path is kept for any future domain-divergent
          // label. The cast widens the literal-narrowed union element to
          // the SSOT shape so optional `labelByDomain` access compiles.
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
      case '@ref:':
      case '@ctx:': {
        const slots = actionMetadata.intent
          ? getSuggestedSlots(actionMetadata.intent, prefix, actionMetadata.domain)
          : { dirs: [] as string[], excludedPaths: new Set<string>() };
        // `@target:` is files-only under the writable domains (single-select
        // revise contract); `@ref:` / `@ctx:` take files and folder units.
        return prefix === '@target:'
          ? buildNavSuggestions(fileTree, query, {
              field: 'target',
              selectableTypes: ['file'],
              isOffered: n => n.type === 'file' && isWritableArtifactPath(n.path) && !slots.excludedPaths.has(n.path),
              suggestedDirs: slots.dirs,
              labels: navLabels,
            })
          : buildNavSuggestions(fileTree, query, {
              field: prefix === '@ref:' ? 'ref' : 'context',
              selectableTypes: ['file', 'directory'],
              isOffered: n => !isSessionsPath(n.path) && !slots.excludedPaths.has(n.path),
              suggestedDirs: slots.dirs,
              labels: navLabels,
            });
      }

      case '@explicit':
        if (!explicitSettable) return [];
        if (q === '') return [{ type: 'explicit', id: 'true', label: 'Explicit', description: 'Skip triage, use metadata as-is' }];
        return [];

      default:
        return [];
    }
  }, [prefix, query, commandQuery, fileTree, navLabels, actionMetadata.intent, actionMetadata.domain, explicitSettable, COMMAND_MENU_BASE, EXPLICIT_COMMAND, t, isUniversal, universalJobIntents, universalPlanOn]);

  const showSuggestions = (prefix !== null || commandQuery !== null) && suggestions.length > 0;

  /** Rewrite the mention query to `{dirPath}/` — the dropdown now lists that directory. */
  const setNavQuery = useCallback((nextQuery: string): { newMessage: string; newCursorPos: number } => {
    const start = matchStart + (prefix?.length ?? 0);
    const newMessage = message.slice(0, start) + nextQuery + message.slice(cursorPos);
    setSelectedIndex(0);
    return { newMessage, newCursorPos: start + nextQuery.length };
  }, [message, cursorPos, matchStart, prefix]);

  const enterDirectory = useCallback((suggestion: MentionSuggestion) => setNavQuery(`${suggestion.id}/`), [setNavQuery]);

  const applySuggestion = useCallback((suggestion: MentionSuggestion): { newMessage: string; newCursorPos: number } => {
    // A directory that cannot be attached (the `_agents` / `_pipelines` roots,
    // any directory on `@target:`) is entered instead — the one gesture works.
    if (suggestion.selectable === false && suggestion.enterable) return enterDirectory(suggestion);

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
      if (suggestion.id === '@plan') {
        // Argument-less flag mention (universal only) — strip the token.
        setUniversalPlanMention(true);
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

    // Browse: strip the mention token and open the folder-tree picker for
    // this field (ChatInput observes `browseField`).
    if (suggestion.type === 'browse') {
      setBrowse({ field: suggestion.id as BrowseField, suggestedDirs: dirPrefix ? [dirPrefix.replace(/\/$/, '')] : [] });
      setIsOpen(false);
      setSelectedIndex(0);
      return { newMessage: newMessage.trimStart(), newCursorPos: beforeMention.length };
    }

    // Universal: mentions arm `universalTurnMeta` — never the canonical
    // actionMetadata store. `@ctx:` accumulates; `@intent:` is a single
    // slot (a run binds at most one intent — last pick replaces).
    if (isUniversal) {
      if (suggestion.type === 'intent') addUniversalIntentMention(suggestion.id);
      else if (suggestion.type === 'context' || suggestion.type === 'agentCtx' || suggestion.type === 'pipelineCtx') addUniversalContextMention(suggestion.id);
      else if (suggestion.type === 'plan') setUniversalPlanMention(true);
      setIsOpen(false);
      setSelectedIndex(0);
      return { newMessage: newMessage.trimStart(), newCursorPos: beforeMention.length };
    }

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
  }, [message, cursorPos, matchStart, dirPrefix, enterDirectory, updateActionMetadata, actionMetadata, canStartChat, isUniversal, addUniversalIntentMention, addUniversalContextMention, setUniversalPlanMention]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): false | { newMessage: string; newCursorPos: number } => {
    if (!showSuggestions) return false;
    const current = suggestions[selectedIndex];

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
        if (!current) return false;
        e.preventDefault();
        return current.enterable ? enterDirectory(current) : applySuggestion(current);
      case 'ArrowRight':
        if (!current?.enterable) return false;
        e.preventDefault();
        return enterDirectory(current);
      case 'Enter':
        if (!current) return false;
        e.preventDefault();
        return applySuggestion(current);
      case 'ArrowLeft':
      case 'Backspace':
        // With nothing typed at this level, step back up one directory.
        if (!isFilePrefix || dirPrefix === '' || remainder !== '') return false;
        e.preventDefault();
        return setNavQuery(popNavLevel(query));
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        return { newMessage: message, newCursorPos: cursorPos };
      default:
        return false;
    }
  }, [showSuggestions, suggestions, selectedIndex, applySuggestion, enterDirectory, setNavQuery, isFilePrefix, dirPrefix, remainder, query, message, cursorPos]);

  const navCrumbs = useMemo(() => (isFilePrefix ? navBreadcrumb(fileTree, dirPrefix) : []), [isFilePrefix, fileTree, dirPrefix]);

  // Picker wiring — universal confirms into `universalTurnMeta.context`
  // (replace contract), canonical into the armed actionMetadata field.
  const browseField = browse?.field ?? null;
  const browseInitialSelected = useMemo((): string[] => {
    if (!browseField) return [];
    if (isUniversal) return universalContext;
    return actionMetadata[browseField] ?? [];
  }, [browseField, isUniversal, universalContext, actionMetadata]);

  const applyBrowseSelection = useCallback((paths: string[]) => {
    if (!browseField) return;
    if (isUniversal) {
      setUniversalContextMentions(paths.filter(isUniversalCtxSuggestible));
      return;
    }
    updateActionMetadata({ [browseField]: paths.length > 0 ? paths : undefined });
  }, [browseField, isUniversal, setUniversalContextMentions, updateActionMetadata]);

  return {
    suggestions,
    showSuggestions,
    selectedIndex,
    setSelectedIndex,
    applySuggestion,
    enterDirectory,
    /** `{ prefix, crumbs }` for the dropdown header while a file prefix is armed; null otherwise. */
    navBreadcrumb: isFilePrefix && prefix ? { prefix, crumbs: navCrumbs } : null,
    handleKeyDown,
    isOpen: showSuggestions,
    setIsOpen,
    browseField,
    /** The level the user was browsing when the picker opened — it expands there. */
    browseSuggestedDirs: browse?.suggestedDirs ?? [],
    browseInitialSelected,
    applyBrowseSelection,
    clearBrowseField: () => setBrowse(null),
  };
}
