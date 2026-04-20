/**
 * Session Log Types
 * 
 * Types for feature.jsonl (context SSOT, prompt injection source) and
 * trace.jsonl (UI SSOT, chat display source).
 * 
 * Design principle (책임 MECE):
 * - feature.jsonl: LLM 프롬프트 주입용. T2(user_turn) + T3(breadcrumb) + boundary
 * - trace.jsonl: UI 채팅 렌더용. 실행 과정의 모든 이벤트. 맥락 전달 대상 아님
 * - user_turn만 양쪽 복제 (의미상 공유 자원)
 * 
 * Append-only JSONL. 각 라인은 독립적 JSON 객체.
 */

import type { JobType } from './job';
import type { Mode } from './detection';

// ═══════════════════════════════════════════════════════════════════════
// Common types
// ═══════════════════════════════════════════════════════════════════════

export type Complexity = 'oneshot' | 'exploratory' | 'todo';

export type DecidedBy = 'user' | 'heuristic' | 'llm';

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
 * user_turn_meta — complexity 판정 패치 라인
 * 
 * 기록 시점: Decompose 완료 후 learn/direct 종료 시 append
 * resolve가 로드 시 user_turn과 turnId 기준 병합
 */
export interface FeatureUserTurnMetaLine extends LineBase {
  type: 'user_turn_meta';
  complexity: Complexity;
  decidedBy: DecidedBy;
  reason: string;
}

/**
 * breadcrumb — 작업 흔적 네비게이션 앵커 (T3)
 * 
 * 생성 규칙:
 * - mode='explain': 생성 안 함 (T1 무수정)
 * - mode in {generate, refactor} + complexity='todo': 항상 생성 (bubble-up 적용)
 * - mode in {generate, refactor} + complexity='exploratory' + touched≥3: mini-BC
 * - 그 외: 생성 안 함
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
 * - complexity='todo' 완료 → 자동 boundary (mode 무관)
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
// trace.jsonl line types (UI-only)
// ═══════════════════════════════════════════════════════════════════════

/**
 * user_turn — feature.jsonl 사본 (text만 유지)
 * 
 * sourceRef:
 * - code/design/plan: `feature.jsonl#<turnId>`
 * - ask/inline-ask: `ask-only` (원본이 feature.jsonl에 없음)
 */
export interface TraceUserTurnLine extends LineBase {
  type: 'user_turn';
  text: string;
  sourceRef: string;
}

export interface TraceThinkingLine extends LineBase {
  type: 'assistant_thinking';
  text: string;
}

export interface TraceToolCallLine extends LineBase {
  type: 'tool_call';
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
}

export interface TraceFileWriteLine extends LineBase {
  type: 'file_write';
  path: string;
  diff?: string;
  operation?: 'create' | 'update' | 'delete';
}

export interface TraceRunCommandLine extends LineBase {
  type: 'run_command';
  cmd: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface TraceJobStatusLine extends LineBase {
  type: 'job_status';
  phase: string;
  progress?: number;
  message?: string;
}

export interface TraceAssistantMessageLine extends LineBase {
  type: 'assistant_message';
  text: string;
}

/**
 * UI choice card presented to the user.
 *
 * Session redesign §16.2 Step 4: choice cards (triage / cancelled /
 * eval_save / clarifying / spec_complete / ...) are observable UI events
 * recorded in trace.jsonl so the Chat/Activity view can rebuild them on
 * refresh without chat.json.
 *
 * Pair with {@link TraceChoiceResolvedLine} via `cardId`. Unpaired
 * `choice_presented` lines render as actionable cards; paired lines render
 * with the `resolvedLabel` from the matching resolved line.
 */
export interface TraceChoicePresentedLine extends LineBase {
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
export interface TraceChoiceResolvedLine extends LineBase {
  type: 'choice_resolved';
  /** Matches {@link TraceChoicePresentedLine.cardId} */
  cardId: string;
  /** Machine action chosen ('proceed' | 'dismiss' | 'save' | ...) */
  choiceSelected: string;
  /** Display label to replace the buttons with ('Dismissed', 'Resumed', ...) */
  resolvedLabel: string;
  /** Free-form response data (clarifying answers, etc.) */
  answer?: Record<string, unknown>;
}

export type TraceLine =
  | TraceUserTurnLine
  | TraceThinkingLine
  | TraceToolCallLine
  | TraceFileWriteLine
  | TraceRunCommandLine
  | TraceJobStatusLine
  | TraceAssistantMessageLine
  | TraceChoicePresentedLine
  | TraceChoiceResolvedLine;

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
