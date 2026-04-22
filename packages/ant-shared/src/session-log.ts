/**
 * Session Log Types
 *
 * Types for feature.jsonl (context SSOT, prompt injection source) and
 * chat.jsonl (UI SSOT, chat display source).
 *
 * Design principle (책임 MECE):
 * - feature.jsonl: LLM 프롬프트 주입용. T2(user_turn) + T3(breadcrumb) + boundary
 * - chat.jsonl: UI 채팅 렌더용. 실행 과정에서 발생한 모든 채팅 이벤트의 영속
 *   저장. 라이브 스트림은 `ChatStatusHandler.showChatStatus` 한 곳에서 생성되고,
 *   동일 함수가 `chat_status` 라인으로 직렬화한다. 복원(replay) 은 그 라인을
 *   다시 `generateStatusContent(statusType, metadata)` 에 통과시키기만 하면
 *   라이브와 동일한 `MessageContent` 를 얻는다 — "복구 전용 빌더" 는 존재하지
 *   않는다.
 * - user_turn만 양쪽 복제 (의미상 공유 자원)
 *
 * Append-only JSONL. 각 라인은 독립적 JSON 객체.
 *
 * NOTE: 이전 파일 이름은 `trace.jsonl` 이었다. 내용이 곧 채팅이므로 `chat.jsonl`
 * 로 개명되었지만, 기존 워크스페이스와의 호환을 위해 reader 는 두 경로를 모두
 * 읽는다 (쓰기는 항상 `chat.jsonl`).
 */

import type { JobType } from './job';
import type { Mode } from './detection';

/**
 * 5-tier execution strategy identifier (SSOT).
 *
 * Emitted by each job's Tier Entry Node (code/design: Decompose,
 * plan/visual: Detect, learn/ask: fixed 0). The LLM directly outputs
 * this value after observing mode and refs (artifacts with
 * `role='ref'`). `selectExecutionTier(...)` acts as a safety fallback
 * when the LLM output is missing or invalid.
 *
 * Numeric values are stable and safe to serialize into feature.jsonl /
 * user_turn_meta lines; consumers should prefer the enum keys in code
 * comparisons (e.g. `tier === ExecutionTierId.Reflex`).
 */
export enum ExecutionTierId {
  Reflex = 0,
  OneShot = 1,
  Exploratory = 2,
  Task = 3,
  RefsGrounded = 4,
}

// ═══════════════════════════════════════════════════════════════════════
// Common types
// ═══════════════════════════════════════════════════════════════════════

/** Log line kind — identical to JobType, re-exported for clarity in session-log context */
export type LogJobType = JobType;

// ═══════════════════════════════════════════════════════════════════════
// feature.jsonl line types
// ═══════════════════════════════════════════════════════════════════════

/**
 * 공통 필수 필드 — 모든 feature/trace 라인에 포함
 */
interface LineBase {
  /** ISO 8601 timestamp */
  ts: string;
  /** 속한 job의 ID */
  jobId: string;
  /** turn ID — 같은 사용자 요청에 속한 이벤트들을 묶음 */
  turnId: string;
  /** jobtype — 분류/필터링/UI용 */
  jobType: LogJobType;
  /** collapsed 마킹 시 프롬프트/UI 렌더에서 제외 (디스크는 보존) */
  collapsed?: true;
}

/**
 * user_turn — 사용자 요청의 원문
 * 
 * 기록 시점: orchestrator가 LangGraph invoke 직전에 append
 * 이 시점엔 아직 mode만 알고 complexity 미정 → user_turn_meta 패치 라인으로 보완
 */
export interface FeatureUserTurnLine extends LineBase {
  type: 'user_turn';
  /**
   * 사용자 원본 directive.
   *
   * Naming SSOT: `text` (matches `TraceUserTurnLine.text` so trace ↔ feature
   * pairs share the same field name across the BE↔FE contract).
   */
  text: string;
  /** Detect 노드가 판정한 mode (already known at record time) */
  mode?: Mode;
}

/**
 * user_turn_meta — execution-tier classification patch line
 *
 * 기록 시점: Tier Entry Node(code/design: Decompose, plan/visual: Detect)
 * 완료 후 learn(또는 동등 phase) 종료 시 append. resolve가 로드 시
 * user_turn과 turnId 기준 병합.
 */
export interface FeatureUserTurnMetaLine extends LineBase {
  type: 'user_turn_meta';
  /** 5-tier execution strategy selected by the Tier Entry Node LLM. */
  executionTier: ExecutionTierId;
}

/**
 * breadcrumb — 작업 흔적 네비게이션 앵커 (T3)
 *
 * 생성 규칙 (tier 기반):
 * - mode='explain'                          → 생성 안 함 (T1 무수정)
 * - mode in {generate, refactor}, Tier 3/4  → 항상 생성 (bubble-up 적용)
 * - mode in {generate, refactor}, Tier 2, touched≥3 → mini-BC
 * - 그 외                                   → 생성 안 함
 */
export interface FeatureBreadcrumbLine extends LineBase {
  type: 'breadcrumb';
  mode?: Mode;
  /** 작업 유형 (structural) */
  scope: 'initial_creation' | 'modification' | 'refactor';
  /** bubble-up된 앵커 (§4.9 Breadcrumb Bubble-up) */
  anchors: {
    specs?: string[];  // ≤ 3
    paths?: string[];  // ≤ 5
    files?: string[];  // ≤ 10
  };
  /** 명사형 1줄 summary (rules에 제약 명시) */
  summary: string;
  /** 규모 통계 */
  stats: {
    created?: number;
    modified?: number;
    deleted?: number;
    touched?: number;
  };
  /** trace.jsonl에서 이 작업의 라인 범위 (optional, UI 흔적 뷰용) */
  traceRangeRef?: {
    startTs: string;
    endTs: string;
  };
}

/**
 * boundary — 대화 맥락 경계 마커
 *
 * 생성 규칙:
 * - Tier 3/4(task) 완료 → 자동 boundary (mode 무관)
 * - Hard Reset → 명시 boundary (`reason: 'user_reset'`)
 * - 그 외 → 생성 안 함
 *
 * 효과: resolve의 loadSinceBoundary가 이 boundary 이후 T2만 반환
 *
 * **jobType widening**: 일반 boundary는 자신을 만든 job의 jobType(`code` /
 * `design` / `plan` 등)을 그대로 기록하지만, Hard Reset은 agent-agnostic
 * 이벤트라 `'reset'` 리터럴을 허용한다. UI/분석 레이어는 이 값을 특수
 * 카테고리로 취급한다.
 */
export interface FeatureBoundaryLine extends Omit<LineBase, 'jobType'> {
  type: 'boundary';
  /** boundary-specific: `'reset'` for Hard Reset, concrete JobType otherwise. */
  jobType: LogJobType | 'reset';
  /**
   * Known reasons are listed for IDE autocomplete; `(string & {})` keeps
   * the union open without widening to plain `string` (which would erase
   * literal hints). Add new well-known values to the union as needed.
   */
  reason: 'auto_job_complete_todo' | 'user_reset' | (string & {});
}

export type FeatureLine =
  | FeatureUserTurnLine
  | FeatureUserTurnMetaLine
  | FeatureBreadcrumbLine
  | FeatureBoundaryLine;

// ═══════════════════════════════════════════════════════════════════════
// chat.jsonl (a.k.a. legacy trace.jsonl) line types (UI-only)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Chat status card type — SSOT for every progress/result indicator the
 * chat UI renders. `generateStatusContent(type, metadata)` in
 * `ChatStatusHandler` is the single function that turns a
 * `(ChatStatusType, metadata)` pair into a `MessageContent.content` string;
 * both the live broadcast path and the replay path call that same function
 * so rendering is always identical.
 *
 * When this union grows, `generateStatusContent` must gain a matching case
 * and the identifier here becomes part of the on-disk schema.
 */
export type ChatStatusType =
  | 'placeholder'
  | 'exploring' | 'explored'
  | 'retrieving' | 'retrieved'
  | 'grepping' | 'grepped'
  | 'listing_files' | 'listed_files'
  | 'searching_code' | 'searched_code'
  | 'reading' | 'read'
  | 'reading_source' | 'read_source'
  | 'thinking'
  | 'indexing' | 'indexed'
  | 'analyzing' | 'analyzed'
  | 'loading' | 'loaded'
  | 'storing' | 'stored'
  | 'searching_reference' | 'searched_reference'
  | 'tool_action'
  | 'learning' | 'learned'
  | 'context_loaded'
  | 'triage_choice'
  | 'choice_card'
  | 'cancelled'
  | 'file_creating' | 'file_writing' | 'file_create' | 'file_create_failed'
  | 'file_editing' | 'file_updating' | 'file_edit' | 'file_edit_failed'
  | 'file_deleting' | 'file_delete' | 'file_delete_failed'
  | 'file_conflict' | 'file_conflict_retry'
  | 'command_running' | 'command_streaming' | 'command'
  | 'processing' | 'processed'
  | 'downloading' | 'downloaded'
  | 'figma_calling' | 'figma_called'
  | 'plan_generating' | 'plan'
  | 'task_response'
  | 'text';

/**
 * user_turn — feature.jsonl 사본 (text만 유지)
 *
 * sourceRef:
 * - code/design/plan: `feature.jsonl#<turnId>`
 * - ask/inline-ask: `ask-only` (원본이 feature.jsonl에 없음)
 */
export interface ChatUserTurnLine extends LineBase {
  type: 'user_turn';
  text: string;
  sourceRef: string;
}

export interface ChatThinkingLine extends LineBase {
  type: 'assistant_thinking';
  text: string;
}

/**
 * Durable record of a single chat-UI status card emission.
 *
 * Emitted by `ChatLogAppender.appendChatStatus(statusType, metadata)`
 * immediately after `ChatStatusHandler.showChatStatus` creates the
 * corresponding `MessageContent`. On replay, readers feed the pair back
 * into `generateStatusContent` to rebuild the identical content string.
 *
 * This is the SSOT for every non-structural chat card — file card,
 * command card, read/list/search status, choice cards (via
 * `ChatChoicePresentedLine`), etc. If a new card surfaces, the migration
 * path is: add the type to `ChatStatusType` + a case in
 * `generateStatusContent` — no new line kind required.
 */
export interface ChatStatusLine extends LineBase {
  type: 'chat_status';
  statusType: ChatStatusType;
  metadata?: Record<string, unknown>;
}

export interface ChatAssistantMessageLine extends LineBase {
  type: 'assistant_message';
  text: string;
}

/**
 * UI choice card presented to the user.
 *
 * Session redesign §16.2 Step 4: choice cards (triage / cancelled /
 * eval_save / clarifying / spec_complete / ...) are observable UI events
 * recorded in chat.jsonl so the Chat/Activity view can rebuild them on
 * refresh without chat.json.
 *
 * Pair with {@link ChatChoiceResolvedLine} via `cardId`. Unpaired
 * `choice_presented` lines render as actionable cards; paired lines render
 * with the `resolvedLabel` from the matching resolved line.
 */
export interface ChatChoicePresentedLine extends LineBase {
  type: 'choice_presented';
  /** Stable id so a later choice_resolved can back-reference this card */
  cardId: string;
  /**
   * Card subtype — renders via the UI's choice-card component:
   * 'triage_choice' | 'cancelled' | 'eval_save' | 'clarifying'
   * | 'spec_complete' | string  (arbitrary future cardTypes are fine)
   */
  cardType: string;
  /** Prompt / title shown above the buttons */
  prompt?: string;
  /**
   * cardType-specific free-form payload (choiceOptions / clarifyBlocks /
   * evalType / reason / ...). The UI decodes based on `cardType`.
   */
  payload?: Record<string, unknown>;
}

/**
 * User's response to a previously presented choice card.
 */
export interface ChatChoiceResolvedLine extends LineBase {
  type: 'choice_resolved';
  /** Matches {@link ChatChoicePresentedLine.cardId} */
  cardId: string;
  /** Machine action chosen ('proceed' | 'dismiss' | 'save' | ...) */
  choiceSelected: string;
  /** Display label to replace the buttons with ('Dismissed', 'Resumed', ...) */
  resolvedLabel: string;
  /** Free-form response data (clarifying answers, etc.) */
  answer?: Record<string, unknown>;
}

export type ChatLine =
  | ChatUserTurnLine
  | ChatThinkingLine
  | ChatStatusLine
  | ChatAssistantMessageLine
  | ChatChoicePresentedLine
  | ChatChoiceResolvedLine;

// ═══════════════════════════════════════════════════════════════════════
// Legacy line types + union (DEPRECATED — to be removed after callers migrate)
//
// These were the per-event line kinds before `chat_status` became the
// single SSOT. They are retained as type aliases / interfaces so the
// current writers (TraceAppender.appendToolCall / appendFileWrite /
// appendRunCommand / appendJobStatus) compile during the migration. A
// follow-up commit collapses them into `ChatStatusLine` and removes these
// declarations.
// ═══════════════════════════════════════════════════════════════════════

/** @deprecated Use {@link ChatUserTurnLine}. */
export type TraceUserTurnLine = ChatUserTurnLine;
/** @deprecated Use {@link ChatThinkingLine}. */
export type TraceThinkingLine = ChatThinkingLine;
/** @deprecated Use {@link ChatAssistantMessageLine}. */
export type TraceAssistantMessageLine = ChatAssistantMessageLine;
/** @deprecated Use {@link ChatChoicePresentedLine}. */
export type TraceChoicePresentedLine = ChatChoicePresentedLine;
/** @deprecated Use {@link ChatChoiceResolvedLine}. */
export type TraceChoiceResolvedLine = ChatChoiceResolvedLine;

/**
 * @deprecated `tool_call` lines are being folded into {@link ChatStatusLine}
 * (`statusType` carries the card kind). Retained temporarily so live writers
 * compile while callers migrate. New readers should NOT match this.
 */
export interface TraceToolCallLine extends LineBase {
  type: 'tool_call';
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
}

/**
 * @deprecated Replaced by `chat_status` lines carrying `statusType`
 * `file_create` / `file_edit` / `file_delete` (plus failed variants).
 * Retained for one migration step.
 */
export interface TraceFileWriteLine extends LineBase {
  type: 'file_write';
  path: string;
  operation?: 'create' | 'update' | 'delete';
  content?: string;
  diffBefore?: string;
  diffAfter?: string;
  error?: string;
}

/**
 * @deprecated Replaced by `chat_status` lines carrying `statusType='command'`
 * with the command / exit code in metadata. Retained for one migration step.
 */
export interface TraceRunCommandLine extends LineBase {
  type: 'run_command';
  cmd: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

/**
 * @deprecated Chat view skips `job_status` entirely (SSE workflow stream
 * drives phase UI). Retained only so the old reader/writer code compiles.
 * This will disappear in the same follow-up commit.
 */
export interface TraceJobStatusLine extends LineBase {
  type: 'job_status';
  phase: string;
  progress?: number;
  message?: string;
}

/**
 * @deprecated Union of every (current + legacy) chat log line. Prefer
 * {@link ChatLine} in new code; this alias includes the legacy shapes so
 * the migration can flip readers one-by-one without a flag day.
 */
export type TraceLine =
  | ChatLine
  | TraceToolCallLine
  | TraceFileWriteLine
  | TraceRunCommandLine
  | TraceJobStatusLine;

// ═══════════════════════════════════════════════════════════════════════
// Spec clarify (Decompose output)
// ═══════════════════════════════════════════════════════════════════════

export interface SpecClarifyChoiceOption {
  label: string;
  action: 'redirect_to_design' | 'proceed_without_spec' | 'cancel';
}

export interface SpecClarify {
  /**
   * Validation token (literal `true`).
   *
   * Although the SpecClarify object's existence already implies "choice
   * needed", this field is intentionally kept as a parser-level discriminant:
   * `responseParser` rejects `<specClarify>{}</specClarify>` and other
   * malformed payloads by checking `parsed.needsChoice === true`. The
   * Decompose prompt instructs the LLM to emit this token so partial /
   * malformed JSON does not slip through as a valid clarify.
   */
  needsChoice: true;
  reason: string;
  choiceOptions: {
    positive: SpecClarifyChoiceOption;
    neutral: SpecClarifyChoiceOption;
    negative: SpecClarifyChoiceOption;
  };
  /** UI에 표시할 권유 메시지 */
  displayMessage: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

/** T2 토큰이 이 임계값 초과 시 Compact 안전망 발동 */
export const FEATURE_CONTEXT_THRESHOLD = 12000;

/** Compact 시 유지할 최신 user_turn 개수 */
export const FEATURE_CONTEXT_WINDOW = 6;

/** Breadcrumb bubble-up 임계값 */
export const BREADCRUMB_THRESHOLDS = {
  /** touched ≤ 10: files 그대로 */
  SMALL: 10,
  /** touched ≤ 50: paths 패턴 승격 */
  MEDIUM: 50,
  /** touched ≤ 200: specs + top-level paths만 */
  LARGE: 200,
} as const;

/** Breadcrumb 앵커 개수 상한 */
export const BREADCRUMB_LIMITS = {
  specs: 3,
  paths: 5,
  files: 10,
} as const;

/** direct 노드의 ReAct 루프 최대 반복 횟수 (환경 변수로 튜닝 가능) */
export const DIRECT_LOOP_LIMITS = {
  oneshot: 2,
  exploratory: 10,
} as const;

/** 런타임 승격 트리거 — touched > 이 값이면 exploratory → todo 승격 */
export const PROMOTION_TOUCHED_THRESHOLD = 3;
