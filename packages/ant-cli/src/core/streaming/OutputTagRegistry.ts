/**
 * OutputTagRegistry — single source of truth for every canonical `<tag>`
 * the LLM is allowed to emit.
 *
 * SSOT scope (what THIS module owns):
 *
 *   - The full inventory of registered tag names + their patterns.
 *   - The 4-axis classification (intent / processing / persistence /
 *     blocking) for each tag — see `docs/architecture/36-output-tag-matrix.md`.
 *   - The `chatLineKind` / `streamAction` discriminators.
 *   - The `promptContract` string each tag contributes to the
 *     `output-tag-policy` partial (Phase 2).
 *
 * What THIS module does NOT own (still split by responsibility):
 *
 *   - Streaming parse logic (incremental partial-buffer handling) — that
 *     stays in `parsers/XMLStreamParser.ts`. The parser reads
 *     `streamAction` enums from this registry but its parse loop is
 *     streaming-aware code, not data lookup.
 *   - Chat rendering routing — that stays in
 *     `transformers/SpecialTagTransformer.ts`. The transformer walks
 *     this registry and calls each entry's `transform` hook.
 *   - Chat-line persistence (SSE / Redis / chat.jsonl) — that stays in
 *     `core/llm-response/LLMResponseService.ts`. It reads `chatLineKind`
 *     from this registry to discriminate `assistant_message` lines.
 *   - Disk writes — `FileRenderer` / `FileRegistry` (artifact tags only).
 *   - LangGraph state mutation — each node, using `extract` hook results.
 *
 * Status:
 *
 *   - Chat rendering (transform hooks) — fully owned here; the
 *     `SpecialTagTransformer` walks this registry and has no
 *     self-registered transformer table of its own.
 *   - Post-stream extraction — entries point at the canonical extractor
 *     module (`extractPlanText`, `parseClarifyTags`,
 *     `parseExecutionTierTag`). Those modules remain the implementation
 *     site so call sites that still call them directly continue to work
 *     without churn; collapsing the call sites onto `getTag(name).extract`
 *     is a follow-up cleanup that does not change behaviour.
 */

import type { ChatAssistantMessageKind } from '@ant/shared';
import type { UserLanguage } from '../utils/languageDetector';
import { extractPlanText } from '../../agents/common/graph/nodes/plan/extractPlanText';
import { parseClarifyTags } from '../../agents/common/clarify/tags';
import { parseExecutionTierTag } from '../executionTier/parseExecutionTierTag';
import {
  transformDone,
  transformReply,
  transformLearnCommand,
  transformReferences,
  transformDetect,
  transformExecutionTier,
} from './outputTagTransforms';

// ────────────────────────────────────────────────────────────────────────────
// 4-axis classification
// ────────────────────────────────────────────────────────────────────────────

/** Axis A — what the LLM is expressing. Exactly one per tag. */
export type TagAxisIntent =
  | 'artifact' // file / code edit / sealed plan
  | 'narrative' // user-facing answer / summary / proposal
  | 'control' // flow control (work-blocking or completion)
  | 'decision' // one-shot routing classification
  | 'metadata'; // kanban / references / internal hints

/** Axis B — how the streaming pipeline processes the tag. Multiple allowed. */
export type TagAxisProcessing =
  | 'stream-action' // XMLStreamParser branches mid-stream into a typed action
  | 'consumed-formatted' // SpecialTagTransformer turns it into chat text
  | 'consumed-suppressed' // SpecialTagTransformer silently drops it (no UI)
  | 'post-stream'; // separate extractor slices the body after stream ends

/** Axis C — where the result is persisted. Multiple allowed. */
export type TagAxisPersistence =
  | 'disk-file' // filesystem (FileRenderer / FileRegistry)
  | 'sealed-state' // LangGraph state.* channel
  | 'chat-line' // chat.jsonl line (type + kind)
  | 'kanban' // task queue UI
  | 'card-only' // live card (no chat.jsonl line)
  | 'none'; // pure side-effect (silent state mutation)

/** Axis D — effect on graph flow. Exactly one per tag. */
export type TagAxisBlocking =
  | 'blocking' // halts the node until user replies
  | 'terminal' // signals current task completion
  | 'non-blocking'; // proceeds in parallel

/**
 * ChatLine kind discriminator (only when persistence includes
 * `chat-line`). Re-exports the cross-package SSOT from `@ant/shared`
 * extended with `clarify_question` — a card-only kind that does NOT
 * land in `chat.jsonl` as `assistant_message` but is surfaced through
 * `choice_presented` instead. Both registries (registry + ChatLine)
 * share the same vocabulary so a regression that drops a kind from
 * one fails the other immediately.
 */
export type ChatLineKind = ChatAssistantMessageKind | 'clarify_question';

export interface TagAxis {
  intent: TagAxisIntent;
  processing: readonly TagAxisProcessing[];
  persistence: readonly TagAxisPersistence[];
  blocking: TagAxisBlocking;
}

// ────────────────────────────────────────────────────────────────────────────
// Hook contracts
// ────────────────────────────────────────────────────────────────────────────

export interface TransformResult {
  /** Text rendered into the chat surface (omit when consuming silently). */
  text?: string;
  /** True when the entry handled the content; false lets fallthrough run. */
  consumed: boolean;
}

export interface TransformContext {
  language: UserLanguage;
}

export type TransformHook = (
  match: RegExpMatchArray,
  ctx: TransformContext,
) => TransformResult;

/**
 * Post-stream extractor. Returns either a single value, an array (for
 * tags that may appear multiple times, e.g. `<clarify>`), or `null` /
 * `undefined` when no body matched. Caller casts to the entry's known
 * shape (registry stays generic to avoid leaking domain types upward).
 */
export type ExtractHook<T = unknown> = (
  text: string,
  opts?: Record<string, unknown>,
) => T | T[] | null | undefined;

// ────────────────────────────────────────────────────────────────────────────
// Entry shape
// ────────────────────────────────────────────────────────────────────────────

export interface OutputTagSpec<TExtracted = unknown> {
  /** Canonical tag name without angle brackets (e.g. `plan`, `reply`). */
  name: string;

  /**
   * Match pattern. When the tag has a body (`<x>...</x>`), group 1 is
   * the inner body. When the tag is self-classifying like `<done>true</done>`,
   * group 1 is the value. Stream-only / wrapper-only tags may use a
   * pattern that simply detects presence.
   */
  pattern: RegExp;

  /** 4-axis classification. */
  axis: TagAxis;

  /**
   * `XMLStreamParser` action type when `axis.processing` includes
   * `stream-action`. The parser SSOT decides the action shape; the
   * registry only declares the name so the matrix lint can verify
   * 1:1 wiring.
   */
  streamAction?: string;

  /**
   * `chat.jsonl` `kind` discriminator when `axis.persistence` includes
   * `chat-line`. Required for chat-line entries; forbidden otherwise
   * (matrix lint enforces).
   */
  chatLineKind?: ChatLineKind;

  /**
   * Chat-render hook. Required when `axis.processing` includes
   * `consumed-formatted`. Forbidden otherwise.
   */
  transform?: TransformHook;

  /**
   * Post-stream body extractor. Required when `axis.processing`
   * includes `post-stream`. Forbidden otherwise.
   */
  extract?: ExtractHook<TExtracted>;

  /**
   * Short, FPOP-style contract sentence the `output-tag-policy.md`
   * partial inserts into the LLM prompt. Universal wording only —
   * node-specific wording belongs in variant rules (SBS principle).
   */
  promptContract: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Registry implementation
// ────────────────────────────────────────────────────────────────────────────

const REGISTRY: Map<string, OutputTagSpec> = new Map();

/**
 * Register a tag entry. Throws on duplicate name (SSOT discipline) or
 * obvious axis-shape violations (caught by `output-tag-matrix.test.ts`
 * for the full matrix). Call from the bottom of this file only.
 */
function register<T>(spec: OutputTagSpec<T>): void {
  if (REGISTRY.has(spec.name)) {
    throw new Error(
      `[OutputTagRegistry] duplicate registration for tag "${spec.name}" — every tag has exactly one SSOT entry`,
    );
  }
  validateEntryShape(spec);
  REGISTRY.set(spec.name, spec as OutputTagSpec);
}

function validateEntryShape(spec: OutputTagSpec): void {
  const { name, axis } = spec;
  if (!axis || !axis.intent || !axis.blocking) {
    throw new Error(`[OutputTagRegistry] tag "${name}" missing axis fields`);
  }
  if (!Array.isArray(axis.processing) || axis.processing.length === 0) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" must declare at least one processing mode`,
    );
  }
  if (!Array.isArray(axis.persistence) || axis.persistence.length === 0) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" must declare at least one persistence target`,
    );
  }
  if (!spec.promptContract || spec.promptContract.trim().length === 0) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" missing promptContract`,
    );
  }

  // Wiring invariants: hook presence must match processing axis.
  const hasStreamAction = axis.processing.includes('stream-action');
  if (hasStreamAction && !spec.streamAction) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" has stream-action processing but no streamAction name`,
    );
  }
  if (!hasStreamAction && spec.streamAction) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" declares streamAction but processing does not include stream-action`,
    );
  }
  const hasFormatted = axis.processing.includes('consumed-formatted');
  if (hasFormatted && !spec.transform) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" has consumed-formatted processing but no transform hook`,
    );
  }
  if (!hasFormatted && spec.transform) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" declares transform but processing does not include consumed-formatted`,
    );
  }
  const hasPostStream = axis.processing.includes('post-stream');
  if (hasPostStream && !spec.extract) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" has post-stream processing but no extract hook`,
    );
  }
  if (!hasPostStream && spec.extract) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" declares extract but processing does not include post-stream`,
    );
  }
  // chat-line ↔ chatLineKind 1:1
  const hasChatLine = axis.persistence.includes('chat-line');
  if (hasChatLine && !spec.chatLineKind) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" persists to chat-line but no chatLineKind declared`,
    );
  }
  if (!hasChatLine && spec.chatLineKind) {
    throw new Error(
      `[OutputTagRegistry] tag "${name}" declares chatLineKind but does not persist to chat-line`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Look up a tag entry by name. Throws when the name is unregistered —
 * mistyped names are bugs, never `undefined` returns.
 */
export function getTag<T = unknown>(name: string): OutputTagSpec<T> {
  const entry = REGISTRY.get(name);
  if (!entry) {
    throw new Error(
      `[OutputTagRegistry] unknown tag "${name}" — every canonical tag must be registered (see docs/architecture/36-output-tag-matrix.md)`,
    );
  }
  return entry as OutputTagSpec<T>;
}

/**
 * Find a tag entry by name, returning `undefined` when absent. Use only
 * for code paths that legitimately probe optional registration (e.g.
 * matrix lint test, dev-mode warnings). Prefer `getTag` everywhere else.
 */
export function findTag<T = unknown>(name: string): OutputTagSpec<T> | undefined {
  return REGISTRY.get(name) as OutputTagSpec<T> | undefined;
}

/** Snapshot of every registered entry. Returned in registration order. */
export function allTags(): readonly OutputTagSpec[] {
  return Array.from(REGISTRY.values());
}

/** Names of every registered tag (for fast `Set` membership checks). */
export function allTagNames(): readonly string[] {
  return Array.from(REGISTRY.keys());
}

/**
 * Filter helper for soft introspection (test surfaces / lint helpers).
 * Returns a new array; the underlying registry is read-only.
 */
export function tagsByIntent(intent: TagAxisIntent): readonly OutputTagSpec[] {
  return Array.from(REGISTRY.values()).filter((t) => t.axis.intent === intent);
}

// ────────────────────────────────────────────────────────────────────────────
// Entries
// ────────────────────────────────────────────────────────────────────────────
//
// Every canonical tag emitted anywhere in the pipeline lives below.
// Adding a new tag means adding one entry — `SpecialTagTransformer`,
// `XMLStreamParser`, `ChatService`, and the `output-tag-policy` partial
// all consume this registry; nothing else needs touching.

/**
 * Generic body extractor — slices `<tag>body</tag>` and trims.
 *
 * Used by every `decision` and similar pure-body tag whose downstream
 * domain logic (validation / matrix-gating / default-on-exhaustion)
 * lives elsewhere. Phase 4 may replace these with full-fidelity
 * extractors if the call sites converge on identical needs.
 */
function extractTagBody(text: string, name: string): string | undefined {
  const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : undefined;
}

// ── artifact axis ──────────────────────────────────────────────────────────

register({
  name: 'file',
  pattern: /<file\s+[^>]*>([\s\S]*?)<\/file>/i,
  axis: {
    intent: 'artifact',
    processing: ['stream-action'],
    persistence: ['disk-file'],
    blocking: 'non-blocking',
  },
  streamAction: 'file_start',
  promptContract:
    'Use `<file path="...">body</file>` to write a NEW file. The body is written verbatim to disk. No commentary inside.',
});

register({
  name: 'append',
  pattern: /<append\s+[^>]*>([\s\S]*?)<\/append>/i,
  axis: {
    intent: 'artifact',
    processing: ['stream-action'],
    persistence: ['disk-file'],
    blocking: 'non-blocking',
  },
  streamAction: 'file_start',
  promptContract:
    'Use `<append path="...">body</append>` to append to an existing file. The body is appended verbatim. No commentary inside.',
});

register({
  name: 'edit',
  pattern: /<edit\s+[^>]*>([\s\S]*?)<\/edit>/i,
  axis: {
    intent: 'artifact',
    processing: ['stream-action'],
    persistence: ['disk-file'],
    blocking: 'non-blocking',
  },
  streamAction: 'file_start',
  promptContract:
    'Use `<edit path="..." search="..." replace="...">` for targeted replacements in an existing file. Use only when the surgical change is clearer than rewriting the whole file.',
});

register({
  name: 'delete',
  pattern: /<delete\s+[^>]*\/>/i,
  axis: {
    intent: 'artifact',
    processing: ['stream-action'],
    persistence: ['disk-file'],
    blocking: 'non-blocking',
  },
  streamAction: 'file_start',
  promptContract:
    'Use `<delete path="..." />` to remove a file. Self-closing. Use sparingly — only when the file is genuinely obsolete.',
});

register({
  name: 'plan',
  pattern: /<plan>([\s\S]*?)<\/plan>/,
  axis: {
    intent: 'artifact',
    processing: ['stream-action', 'post-stream'],
    persistence: ['sealed-state', 'card-only'],
    blocking: 'non-blocking',
  },
  streamAction: 'plan_start',
  extract: (text, opts) =>
    extractPlanText(
      text,
      typeof opts?.minLength === 'number' ? opts.minLength : undefined,
    ),
  promptContract:
    'Use `<plan>{...sealed JSON...}</plan>` exactly once to seal the plan node decision. The body is JSON only — no prose, no nested tags, no markdown fences.',
});

// ── narrative axis ─────────────────────────────────────────────────────────

register({
  name: 'reply',
  pattern: /<reply>([\s\S]*?)<\/reply>/i,
  axis: {
    intent: 'narrative',
    processing: ['consumed-formatted'],
    persistence: ['chat-line'],
    blocking: 'non-blocking',
  },
  chatLineKind: 'directive_reply',
  transform: transformReply,
  promptContract:
    'Use `<reply>...</reply>` for any text the user should see — answer, summary, follow-up question, proposal. Body is the message verbatim. No nested artifact / control / decision tags inside.',
});

// ── control axis ───────────────────────────────────────────────────────────

register({
  name: 'done',
  pattern: /<done>(true|false)<\/done>/i,
  axis: {
    intent: 'control',
    processing: ['consumed-formatted'],
    persistence: ['chat-line'],
    blocking: 'terminal',
  },
  chatLineKind: 'completion',
  transform: transformDone,
  promptContract:
    'Emit `<done>true</done>` exactly once when the current task is complete. Until then, omit it. Output nothing after `<done>true</done>` — the system terminates the turn at that boundary.',
});

register({
  name: 'clarify',
  pattern: /<clarify(?:\s+question="[^"]*")?\s*>([\s\S]*?)<\/clarify>/,
  axis: {
    intent: 'control',
    processing: ['post-stream', 'stream-action'],
    persistence: ['chat-line', 'card-only'],
    blocking: 'blocking',
  },
  streamAction: 'clarify_start',
  chatLineKind: 'clarify_question',
  extract: (text) => parseClarifyTags(text),
  promptContract:
    'Use `<clarify>question</clarify>` ONLY when you cannot continue without a user answer. The job halts until the user replies. For non-blocking questions or summaries, use `<reply>` instead.',
});

// ── decision axis ──────────────────────────────────────────────────────────

register({
  name: 'executionTier',
  pattern: /<executionTier>\s*([\s\S]*?)\s*<\/executionTier>/i,
  axis: {
    intent: 'decision',
    processing: ['consumed-formatted', 'post-stream'],
    persistence: ['sealed-state', 'chat-line'],
    blocking: 'non-blocking',
  },
  chatLineKind: 'rendered_payload',
  transform: transformExecutionTier,
  extract: (text) => parseExecutionTierTag(text),
  promptContract:
    'Emit `<executionTier>N</executionTier>` exactly once during decompose, where N is an integer 0–4. Body is the integer only — no label, no JSON.',
});

register({
  name: 'domain',
  pattern: /<domain>\s*[\s\S]*?\s*<\/domain>/i,
  axis: {
    intent: 'decision',
    processing: ['consumed-suppressed', 'post-stream'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  extract: (text) => extractTagBody(text, 'domain'),
  promptContract:
    'Emit `<domain>service|game</domain>` when the workspace domain is being classified. Body is the literal value only.',
});

register({
  name: 'gameArtTier',
  pattern: /<gameArtTier>\s*[\s\S]*?\s*<\/gameArtTier>/i,
  axis: {
    intent: 'decision',
    processing: ['consumed-suppressed', 'post-stream'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  extract: (text) => extractTagBody(text, 'gameArtTier'),
  promptContract:
    'Emit `<gameArtTier>{...JSON...}</gameArtTier>` for game-domain art classification. Body is JSON matching the gameArtTier schema.',
});

register({
  name: 'gameContentTier',
  pattern: /<gameContentTier>\s*[\s\S]*?\s*<\/gameContentTier>/i,
  axis: {
    intent: 'decision',
    processing: ['consumed-suppressed', 'post-stream'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  extract: (text) => extractTagBody(text, 'gameContentTier'),
  promptContract:
    'Emit `<gameContentTier>{...JSON...}</gameContentTier>` for game-domain content classification. Genre × coreLoop must satisfy the matrix gate.',
});

register({
  name: 'techTier',
  pattern: /<techTier>\s*[\s\S]*?\s*<\/techTier>/i,
  axis: {
    intent: 'decision',
    processing: ['consumed-suppressed', 'post-stream'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  extract: (text) => extractTagBody(text, 'techTier'),
  promptContract:
    'Emit `<techTier>{...JSON...}</techTier>` to declare the active tech-tier slots. Body is JSON matching the techTier schema.',
});

// ── metadata axis ──────────────────────────────────────────────────────────

register({
  name: 'tasks',
  pattern: /<tasks>\s*([\s\S]*?)\s*<\/tasks>/,
  axis: {
    intent: 'metadata',
    processing: ['stream-action'],
    persistence: ['kanban'],
    blocking: 'non-blocking',
  },
  streamAction: 'task_added',
  promptContract:
    'Wrap the task list in `<tasks>...</tasks>`. Each `<task>...</task>` child is surfaced incrementally to the kanban board.',
});

register({
  name: 'task',
  pattern: /<task>\s*[\s\S]*?\s*<\/task>/,
  axis: {
    intent: 'metadata',
    processing: ['stream-action'],
    persistence: ['kanban'],
    blocking: 'non-blocking',
  },
  streamAction: 'task_added',
  promptContract:
    'Each task is wrapped in its own `<task>...</task>` element inside `<tasks>`. Do NOT emit a JSON array — the system parses tasks incrementally as each `</task>` arrives.',
});

register({
  name: 'references',
  pattern: /<references>\s*([\s\S]*?)\s*<\/references>/,
  axis: {
    intent: 'metadata',
    processing: ['consumed-formatted'],
    persistence: ['chat-line'],
    blocking: 'non-blocking',
  },
  chatLineKind: 'rendered_payload',
  transform: transformReferences,
  promptContract:
    'Emit `<references>[...JSON array...]</references>` to register reference repositories. The body is a JSON array — empty array allowed.',
});

register({
  name: 'detect',
  pattern: /<detect>\s*([\s\S]*?)\s*<\/detect>/,
  axis: {
    intent: 'metadata',
    processing: ['consumed-formatted'],
    persistence: ['chat-line'],
    blocking: 'non-blocking',
  },
  chatLineKind: 'rendered_payload',
  transform: transformDetect,
  promptContract:
    'Emit `<detect>{...JSON...}</detect>` exactly once during the detect phase. Body is the canonical RAC payload — no markdown fences.',
});

register({
  name: 'learn_command',
  pattern: /<learn_command>\s*([\s\S]*?)\s*<\/learn_command>/,
  axis: {
    intent: 'metadata',
    processing: ['consumed-formatted'],
    persistence: ['chat-line'],
    blocking: 'non-blocking',
  },
  chatLineKind: 'rendered_payload',
  transform: transformLearnCommand,
  promptContract:
    'Emit `<learn_command>{...JSON...}</learn_command>` to declare a learning command. Body is JSON matching the learn_command schema.',
});

register({
  name: 'thinking',
  pattern: /<thinking>([\s\S]*?)<\/thinking>/,
  axis: {
    intent: 'metadata',
    processing: ['stream-action'],
    persistence: ['chat-line'],
    blocking: 'non-blocking',
  },
  streamAction: 'thinking',
  chatLineKind: 'thinking_chunk',
  promptContract:
    'Wrap private reasoning in `<thinking>...</thinking>` when extended thinking is enabled. Content is surfaced as a collapsed reasoning panel — not as a user-facing answer.',
});

register({
  name: 'boundary',
  pattern: /<boundary>\s*[\s\S]*?\s*<\/boundary>/i,
  axis: {
    intent: 'metadata',
    processing: ['consumed-suppressed'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  promptContract:
    'Emit `<boundary>{...JSON...}</boundary>` only when the detect phase asks for it. Body is internal state — never user-facing.',
});

register({
  name: 'directHints',
  pattern: /<directHints>\s*[\s\S]*?\s*<\/directHints>/i,
  axis: {
    intent: 'metadata',
    processing: ['consumed-suppressed'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  promptContract:
    'Emit `<directHints>{...JSON...}</directHints>` only when the detect phase asks for it. Body is internal state — never user-facing.',
});

register({
  name: 'specClarify',
  pattern: /<specClarify>\s*[\s\S]*?\s*<\/specClarify>/i,
  axis: {
    intent: 'metadata',
    processing: ['consumed-suppressed'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  promptContract:
    'Emit `<specClarify>{...JSON...}</specClarify>` only when the design detect phase asks for it. Body is internal state — never user-facing.',
});

// ── intent registry: workspace-scope tags (still under the metadata axis) ──

register({
  name: 'triage',
  pattern: /<triage>\s*([\s\S]*?)\s*<\/triage>/,
  axis: {
    intent: 'metadata',
    processing: ['stream-action'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  streamAction: 'triage',
  promptContract:
    'Wrap the entire triage response in `<triage>...</triage>`. The body is JSON matching the triage schema.',
});

register({
  name: 'direct',
  pattern: /<direct>\s*([\s\S]*?)\s*<\/direct>/i,
  axis: {
    intent: 'metadata',
    processing: ['post-stream', 'consumed-suppressed'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  extract: (text) => extractTagBody(text, 'direct'),
  promptContract:
    'Wrap the visual `direct` routing decision in `<direct>{...JSON...}</direct>`. The body is JSON only — the parser deserialises it post-stream.',
});

register({
  name: 'eval',
  pattern: /<eval\s+type="[^"]*"\s*\/>/i,
  axis: {
    intent: 'metadata',
    processing: ['consumed-suppressed'],
    persistence: ['sealed-state'],
    blocking: 'non-blocking',
  },
  promptContract:
    'Append a self-closing `<eval type="..." />` tag at the end of an evaluation report (ask job). The save-card UI uses the type to route to the right rubric.',
});
