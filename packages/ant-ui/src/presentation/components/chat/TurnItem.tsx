/**
 * TurnItem — single-turn renderer for the chat-SSOT projector.
 *
 * Phase 11 chat-SSOT — this component replaces the legacy `MessageItem`
 * entry point. Inputs are the `Turn` shape produced by `selectTurns`:
 *
 *   user:      ChatUserTurnLine | undefined         — header bubble
 *   sections:  TurnSection[]                        — one per workerScope
 *
 * Each section flattens to a card stack:
 *   thinking          → ShimmerCard (thinking variant)
 *   status            → WorkingCard / TerminalCard / FileCard / …
 *   assistant_message → markdown text
 *   choice            → ChoiceCard with (presented, resolved?) pair
 *
 * Streaming overlays from the section's TURN_BUFFER snapshot are rendered
 * after the durable items:
 *   activeThinking    → live thinking buffer (no durable line yet)
 *   activeText        → live assistant text buffer
 *   pendingCards      → in-flight cards rendered as their respective
 *                       status types via PendingCardSnapshot
 *
 * The card-level dispatch on `line.statusType` mirrors the SSOT contract
 * directly — there is no longer a `MessageContent` envelope between the
 * projector and the cards. The few presentation-only details that still
 * read like "MessageContent" (e.g. `aggregateChatStatuses`'s output)
 * carry a `ChatStatusLine` payload internally.
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ChatStatusLine,
  ChatStatusType,
  ChatUserTurnLine,
  PendingCardSnapshot,
  LogJobType,
} from '@ant/shared';

import { ActionMetadataBadges } from './ActionMetadataBadges';
import { ShimmerCard } from './ShimmerCard';
import { WorkingCard } from './WorkingCard';
import { TerminalCard } from './TerminalCard';
import { FileCard } from './FileCard';
import { ToolActionCard } from './ToolActionCard';
import { ContextLoadedCard } from './ContextLoadedCard';
import { RefineImpactCard } from './RefineImpactCard';
import { ChoiceCard } from './choiceCard';
import { PlanCard } from './PlanCard';
import { TaskResponseCard } from './TaskResponseCard';
import { TypingIndicator } from './TypingIndicator';
import { aggregateChatStatuses } from './aggregateChatStatuses';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import {
  MAIN_WORKER_SCOPE,
  type Turn,
  type TurnSection,
} from '@/domain/store/selectors/chat';
import { shouldSuppressPreviewOnlyStatusCard } from './statusCardVisibility';
import {
  buildTrailingThinkingMerge,
  type RenderEntry,
  type TrailingThinkingMerge,
} from './trailingThinkingMerge';

interface TurnItemProps {
  turn: Turn;
}

// Memo: `selectTurns` keeps a `Turn` reference stable across SSE deltas
// that don't touch this turn (per-turn incremental cache). Combined
// with `SectionStack`/`AssistantTextBlock` memos below, the entire
// subtree of an unaffected turn bails out of reconciliation — which is
// what unblocks long-session jank with `react-virtuoso` already in
// place.
export const TurnItem = memo(function TurnItem({ turn }: TurnItemProps) {
  return (
    <div className="w-full min-w-0">
      {turn.user && <UserBubble user={turn.user} />}
      <div className="space-y-3">
        {turn.sections.map((section, idx) => (
          <SectionStack
            key={`${turn.turnId}:${section.workerScope}:${idx}`}
            turnId={turn.turnId}
            turnJobType={turn.jobType}
            section={section}
          />
        ))}
      </div>
    </div>
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User bubble
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UserBubble = memo(function UserBubble({ user }: { user: ChatUserTurnLine }) {
  return (
    <div
      className="w-full px-4 py-3"
      style={{
        background: 'oklch(from var(--violet-300) l c h / 0.12)',
        borderLeft: '1px solid',
        borderImage: 'var(--gradient-aurora) 1',
        boxShadow: 'var(--shadow-xs)',
        borderRadius: 'var(--r-md)',
      }}
    >
      {user.actionMetadata && Object.keys(user.actionMetadata).length > 0 && (
        <ActionMetadataBadges metadata={user.actionMetadata} readOnly className="pb-1.5" />
      )}
      <div
        className="text-sm select-text whitespace-pre-wrap break-words"
        style={{ color: 'var(--text-1)', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {user.text}
      </div>
    </div>
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Section stack
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Memo: section ref is per-turn-stable thanks to `selectTurns`'s
// per-turn cache, so an SSE delta in a sibling section doesn't
// re-render this one.
const SectionStack = memo(function SectionStack({
  turnId,
  turnJobType,
  section,
}: {
  turnId: string;
  turnJobType: Turn['jobType'];
  section: TurnSection;
}) {
  const isStreaming = !!(
    section.activeText ||
    section.activeThinking ||
    (section.pendingCards && Object.keys(section.pendingCards).length > 0)
  );

  // Aggregate adjacent same-family chat-status lines so long runs of
  // Read / Listed / Grepped collapse into one expandable card. Items
  // are processed in the section's original order; non-status items
  // (thinking / assistant_message / choice) act as boundaries.
  const renderItems = useMemo(() => buildRenderItems(section), [section]);
  const trailingThinkingMerge = useMemo(
    () => buildTrailingThinkingMerge(renderItems, section.activeThinking, section.activeText),
    [renderItems, section.activeThinking, section.activeText],
  );

  // CardId set of items that have already finalized — used to skip
  // duplicate rendering when a TURN_BUFFER pending card is for a card
  // that has already landed as a durable status line.
  const finalizedCardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of section.items) {
      if (it.kind === 'status') ids.add(it.line.cardId);
    }
    return ids;
  }, [section.items]);

  // Surface the task label inside the scope key (`worker-N#task-K`).
  // Prefer a human-readable taskName from a `task_response` /
  // `plan_generating` line's metadata when present so users see the
  // narrative identity rather than the internal task id.
  const sectionHeader = useMemo(
    () => buildSectionHeader(section),
    [section],
  );

  return (
    <div className="space-y-2">
      {sectionHeader && (
        <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-4)] px-1 pt-1">
          {sectionHeader}
        </div>
      )}
      {renderItems.map((entry, idx) => (
        <RenderEntry
          key={entry.key ?? idx}
          entry={entry}
          isStreaming={isStreaming}
          trailingThinkingMerge={trailingThinkingMerge}
          renderIndex={idx}
        />
      ))}

      {/* Streaming overlays — appear after the durable section items */}
      {section.activeThinking && !trailingThinkingMerge?.hasActiveThinking && (
        <ShimmerCard variant="thinking" streamingText={section.activeThinking} />
      )}
      {section.activeText && (
        <AssistantTextBlock text={section.activeText} isStreaming />
      )}
      {section.pendingCards && Object.entries(section.pendingCards).map(([cardId, pending]) => {
        if (finalizedCardIds.has(cardId)) return null;
        return (
          <PendingStatusCard
            key={`pending:${cardId}`}
            pending={pending}
            turnId={turnId}
            turnJobType={turnJobType}
            workerScope={section.workerScope}
            isStreaming
          />
        );
      })}
    </div>
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Section header — surfaces `worker-N#task-K` identity for clarity
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseScope(scope: string): { workerLabel?: string; taskKey?: string } {
  if (scope === MAIN_WORKER_SCOPE) return {};
  // Cancelled card sections (`_cancelled_:{cardId}`) are visually
  // self-contained as a ChoiceCard; suppress the worker label header
  // so they don't render with a noisy "_cancelled_:..." subtitle.
  if (scope.startsWith('_cancelled_:')) return {};
  const [workerPart, taskPart] = scope.split('#', 2);
  return {
    workerLabel: workerPart || undefined,
    taskKey: taskPart || undefined,
  };
}

const LOG_JOB_TYPES = new Set<LogJobType>([
  'code',
  'design',
  'learn',
  'ask',
  'plan',
  'inline-ask',
  'visual',
]);

function parseLogJobType(value: unknown): LogJobType | undefined {
  if (typeof value !== 'string') return undefined;
  return LOG_JOB_TYPES.has(value as LogJobType) ? (value as LogJobType) : undefined;
}

function resolvePendingJobType(
  turnJobType: Turn['jobType'],
  pending: PendingCardSnapshot,
): Turn['jobType'] {
  const fromMetadata = parseLogJobType(
    (pending.metadata as Record<string, unknown> | undefined)?.jobType,
  );
  return fromMetadata ?? turnJobType;
}

/**
 * Best-effort task name extraction from a section's events. The BE
 * stamps `metadata.taskName` on `task_response` / `plan_generating` /
 * `plan` chat_status lines, so we surface that for the header label.
 * Falls back to the raw `taskKey` (task id) when no human-readable
 * name is found.
 */
function buildSectionHeader(section: TurnSection): string | null {
  const { workerLabel, taskKey } = parseScope(section.workerScope);
  if (!workerLabel) return null;
  if (!taskKey) return null; // No task scope → don't clutter with bare worker label.

  let taskName: string | undefined;
  for (const item of section.items) {
    if (item.kind !== 'status') continue;
    const md = (item.line.metadata ?? {}) as Record<string, unknown>;
    const candidate = typeof md.taskName === 'string' ? md.taskName : undefined;
    if (candidate) {
      taskName = candidate;
      break;
    }
  }
  return `${workerLabel} · ${taskName ?? taskKey}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Render-entry assembly: thinking / aggregated-status / message / choice
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Walk the section's items and produce a flat render list, applying
 * `aggregateChatStatuses` to consecutive runs of `kind:'status'`.
 */
function buildRenderItems(section: TurnSection): RenderEntry[] {
  const out: RenderEntry[] = [];
  let statusBuffer: Array<{ line: ChatStatusLine; pending?: PendingCardSnapshot }> = [];

  const flushStatus = () => {
    if (statusBuffer.length === 0) return;
    const pendingByCard = new Map<string, PendingCardSnapshot | undefined>();
    for (const s of statusBuffer) {
      pendingByCard.set(s.line.cardId, s.pending);
    }
    const lines = statusBuffer.map((s) => s.line);
    const aggregated = aggregateChatStatuses(lines);
    for (const entry of aggregated) {
      out.push({
        key: `status:${entry.line.cardId}:${entry.originalIndex}`,
        kind: 'status',
        line: entry.line,
        pending: pendingByCard.get(entry.line.cardId),
      });
    }
    statusBuffer = [];
  };

  for (const item of section.items) {
    if (item.kind === 'status') {
      statusBuffer.push({ line: item.line, pending: item.pending });
      continue;
    }
    flushStatus();
    if (item.kind === 'thinking') {
      out.push({
        key: `thinking:${item.line.ts}:${item.line.cardId ?? ''}`,
        kind: 'thinking',
        line: item.line,
      });
    } else if (item.kind === 'assistant_message') {
      out.push({
        key: `msg:${item.line.ts}`,
        kind: 'assistant_message',
        line: item.line,
      });
    } else if (item.kind === 'choice') {
      out.push({
        key: `choice:${item.presented.cardId}`,
        kind: 'choice',
        presented: item.presented,
        resolved: item.resolved,
      });
    }
  }
  flushStatus();
  return out;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Render-entry dispatch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Memo: most parent re-renders happen because ONE entry in the parent's
// `renderItems` changed. With `useMemo([section])` returning a stable
// renderItems when section is unchanged, every entry ref is also stable
// — so this memo lets unaffected entries skip reconciliation entirely.
const RenderEntry = memo(function RenderEntry({
  entry,
  isStreaming,
  trailingThinkingMerge,
  renderIndex,
}: {
  entry: RenderEntry;
  isStreaming: boolean;
  trailingThinkingMerge: TrailingThinkingMerge | null;
  renderIndex: number;
}) {
  if (
    trailingThinkingMerge &&
    renderIndex > trailingThinkingMerge.startIndex &&
    renderIndex <= trailingThinkingMerge.endIndex
  ) {
    return null;
  }
  if (trailingThinkingMerge && renderIndex === trailingThinkingMerge.startIndex) {
    if (trailingThinkingMerge.hasActiveThinking) {
      return (
        <ShimmerCard
          variant="thinking"
          streamingText={trailingThinkingMerge.mergedText}
          durationMs={trailingThinkingMerge.mergedDurationMs}
        />
      );
    }
    return (
      <ShimmerCard
        variant="thinking"
        line={trailingThinkingMerge.mergedLine}
        durationMs={trailingThinkingMerge.mergedDurationMs}
      />
    );
  }
  switch (entry.kind) {
    case 'thinking':
      return <ShimmerCard variant="thinking" line={entry.line} durationMs={entry.line.durationMs} />;
    case 'assistant_message':
      return <AssistantTextBlock text={entry.line.text} isStreaming={false} />;
    case 'status':
      return <StatusCardDispatch line={entry.line} pending={entry.pending} isStreaming={isStreaming} />;
    case 'choice':
      return <ChoiceCard presented={entry.presented} resolved={entry.resolved} />;
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status card dispatch — one switch on `statusType`
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface StatusCardDispatchProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  isStreaming: boolean;
}

const StatusCardDispatch = memo(function StatusCardDispatch({
  line,
  pending,
  isStreaming,
}: StatusCardDispatchProps) {
  if (shouldSuppressPreviewOnlyStatusCard(line)) {
    return null;
  }

  switch (line.statusType) {
    case 'placeholder':
      return isStreaming ? <ShimmerCard variant="placeholder" /> : null;

    case 'thinking':
      // Thinking-as-status (legacy path) — render via ShimmerCard with
      // a synthesized thinking line. The first-class `assistant_thinking`
      // line is dispatched via the 'thinking' RenderEntry kind.
      return null;

    case 'cancelled':
      // Cancelled is rendered as a choice card via choice_presented in the
      // chat-SSOT model. A cancelled `chat_status` is a legacy fallback
      // that we no longer emit; render it as a no-op.
      return null;

    case 'text':
      return <AssistantTextBlock text={pending?.streamedOutput ?? ''} isStreaming={isStreaming} />;

    // ===== Working states (~ing) and result states (~ed) =====
    case 'exploring':
    case 'explored':
    case 'retrieving':
    case 'retrieved':
    case 'grepping':
    case 'grepped':
    case 'listing_files':
    case 'listed_files':
    case 'searching_code':
    case 'searched_code':
    case 'reading':
    case 'read':
    case 'reading_state':
    case 'read_state':
    case 'reading_source':
    case 'read_source':
    case 'indexing':
    case 'indexed':
    case 'analyzing':
    case 'analyzed':
    case 'storing':
    case 'stored':
    case 'learning':
    case 'learned':
    case 'loading':
    case 'loaded':
    case 'processing':
    case 'processed':
    case 'downloading':
    case 'downloaded':
    case 'figma_calling':
    case 'figma_called':
      return <WorkingCard line={line} pending={pending} variant={line.statusType as any} />;

    case 'context_loaded':
      return <ContextLoadedCard line={line} pending={pending} />;

    case 'refine_impact':
      return <RefineImpactCard line={line} pending={pending} />;

    case 'tool_action':
      return <ToolActionCard line={line} pending={pending} />;

    // ===== Terminal Commands =====
    case 'command':
    case 'command_running':
    case 'command_streaming':
      return <TerminalCard line={line} pending={pending} isStreaming={isStreaming} />;

    // ===== File Operations =====
    case 'file_creating':
    case 'file_writing':
    case 'file_create':
    case 'file_create_failed':
      return <FileCard line={line} pending={pending} operation="create" isStreaming={isStreaming} />;

    case 'file_editing':
    case 'file_updating':
    case 'file_edit':
    case 'file_edit_failed':
      return <FileCard line={line} pending={pending} operation="edit" isStreaming={isStreaming} />;

    case 'file_deleting':
    case 'file_delete':
    case 'file_delete_failed':
      return <FileCard line={line} pending={pending} operation="delete" isStreaming={isStreaming} />;

    // ===== Plan Card =====
    case 'plan_generating':
    case 'plan':
      return <PlanCard line={line} pending={pending} isStreaming={isStreaming} />;

    // ===== Task Response Card =====
    case 'task_response_streaming':
    case 'task_response':
      return <TaskResponseCard line={line} pending={pending} isStreaming={isStreaming} />;

    // ===== Triage Choice / Choice Card (legacy chat_status path) =====
    case 'triage_choice':
    case 'choice_card':
      // Choice cards are now driven by `choice_presented` lines (see the
      // 'choice' RenderEntry). A bare `chat_status` of these types is
      // a legacy edge case we no longer emit.
      return null;

    default:
      // Any future statusType added to ChatStatusType lands here until
      // a renderer is added — surface it as an unknown placeholder for
      // visibility instead of silently swallowing.
      return null;
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pending card overlay (for cards that have not yet finalized)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PendingStatusCard = memo(function PendingStatusCard({
  pending,
  turnId,
  turnJobType,
  workerScope,
  isStreaming,
}: {
  pending: PendingCardSnapshot;
  turnId: string;
  turnJobType: Turn['jobType'];
  workerScope: string;
  isStreaming: boolean;
}) {
  // Synthesize a ChatStatusLine from the pending snapshot so the same
  // dispatcher renders the in-flight view. The synthetic line is memoized
  // by the pending snapshot's identity so referential equality survives
  // across re-renders that don't change the pending data — keeps card
  // children's effect deps stable.
  //
  // `ts` is derived deterministically from the cardId so memoized
  // children never see a wall-clock-induced false invalidation. The
  // projector replaces this synthetic line with the durable
  // `chat_status` line as soon as it arrives.
  const line = useMemo<ChatStatusLine>(
    () => ({
      type: 'chat_status',
      ts: `pending:${pending.cardId}`,
      jobId: '',
      turnId,
      jobType: resolvePendingJobType(turnJobType, pending),
      cardId: pending.cardId,
      statusType: pending.statusType as ChatStatusType,
      workerScope: workerScope === MAIN_WORKER_SCOPE ? undefined : workerScope,
      metadata: pending.metadata,
    }),
    [pending, turnId, turnJobType, workerScope],
  );
  return <StatusCardDispatch line={line} pending={pending} isStreaming={isStreaming} />;
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Markdown assistant text — used by both finalized message and live overlay
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Hoisted to module scope so each `AssistantTextBlock` render reuses
// the same `components` reference. Combined with `React.memo` below,
// this means a finalized assistant message never re-runs the markdown
// pipeline once it has been parsed.
const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS = createMarkdownComponents();

// Memo: the most expensive render in a long chat is `ReactMarkdown` on
// long finalized messages. Once a turn is finalized, `text` and
// `isStreaming` (false) never change, so this bails out of every
// future re-render.
const AssistantTextBlock = memo(function AssistantTextBlock({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevContentLengthRef = useRef(0);

  useEffect(() => {
    if (isStreaming && scrollContainerRef.current) {
      const currentLength = text.length;
      if (currentLength > prevContentLengthRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        prevContentLengthRef.current = currentLength;
      }
    }
  }, [text, isStreaming]);

  if (!text) return null;

  return (
    <div className="px-1 py-2 w-full select-text overflow-x-hidden" ref={scrollContainerRef}>
      <div
        className="prose prose-sm dark:prose-invert max-w-none w-full select-text"
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
});

// Re-export TypingIndicator for callers that previously imported it from
// MessageItem (used by ChatHistory's footer typing indicator).
export { TypingIndicator };
