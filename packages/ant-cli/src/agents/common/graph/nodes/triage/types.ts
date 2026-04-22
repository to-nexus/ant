/**
 * Triage System Types
 * 
 * 사용자 입력을 분석하여 적절한 처리 경로로 안내하는 시스템
 * 의료 Triage 개념 차용: 분류 → 적절한 경로로 라우팅
 */

import type { ResolvableState } from '../resolve/types.js';
import type { ActionMetadata } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Intent & Status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Intent: 사용자 의도 분류 (1단계)
 * - ask: 질문/도움 요청, 또는 의도 파악 실패 시 확인 요청
 * - work: 명확한 작업 요청
 */
export type Intent = 'ask' | 'work';

/**
 * WorkStatus: work일 때 실행 가능 여부 (2단계)
 * - proceed: 정상 진행 가능
 * - redirect: 다른 job이 더 적합
 * - blocked: 준비물 부족
 */
export type WorkStatus = 'proceed' | 'redirect' | 'blocked';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Choice System
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * ChoiceAction: 선택 후 수행할 액션
 * - proceed: 정상 진행 (조건 충족)
 * - proceedAnyway: 권장 조건 부족하지만 진행
 * - redirect: 다른 job으로 전환
 * - guide: 가이드 제공
 * - dismiss: 작업 취소
 */
export type ChoiceAction = 'proceed' | 'proceedAnyway' | 'redirect' | 'guide' | 'dismiss';

/**
 * ChoiceOptions: 선택지 구성
 */
export interface ChoiceOptions {
  positive: {
    label: string;      // "예", "전환", "그래도 진행"
    action: ChoiceAction;
  };
  negative: {
    label: string;      // "Dismiss", "취소"
    action: ChoiceAction;  // 'guide' or 'dismiss'
  };
  neutral?: {
    label: string;      // "현재 모드로 진행"
    action: ChoiceAction;  // 'proceed' - continue with current agent/job
  };
  fallbackGuide?: string;  // Optional - for 'guide' action
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Triage Result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * TriageResult: Triage 분석 결과
 */
export type ContinuationType = 'supplement' | 'newScope';

export type AskSubType = 'evaluate' | 'ant' | 'general';

export interface TriageResult {
  intent: Intent;
  
  // ask 관련
  inScope?: boolean;           // guardrails 통과 여부
  askResponse?: string;        // 응답 (in-scope일 때)
  askSubType?: AskSubType;     // ask 하위 분류
  
  // work 관련
  workStatus?: WorkStatus;
  continuationType?: ContinuationType;
  
  // work → redirect
  suggestedAgent?: string;
  suggestedJob?: string;
  redirectReason?: string;
  
  // work → blocked
  missingPrerequisites?: {
    required: string[];
    recommended: string[];
  };
  canProceed?: boolean;        // recommended만 부족하면 true
  blockedMessage?: string;
  proceedAnywayOption?: string;
  
  // 사용자에게 보여줄 메시지
  displayMessage?: string;
  
  // 선택 필요 여부
  needsChoice?: boolean;
  choiceOptions?: ChoiceOptions;
  
  // Programmatic guard message (sent to Chat UI when redirect is blocked by prerequisite check)
  _guardMessage?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Workspace State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * WorkspaceState: 워크스페이스 상태
 */
export interface WorkspaceState {
  // Common
  hasPrd: boolean;               // ⚠️ inputs/sources/ 내 텍스트 파일이 하나라도 있으면 true (prd.md 외 포함)
  hasDirective: boolean;         // ⚠️ 채팅 입력 시 true
  prdPath?: string;
  directivePath?: string;
  featurePath?: string;          // Feature directory path (for debug logging)
  sourceFileCount?: number;      // inputs/sources/ 내 텍스트 파일 수
  sourceFileNames?: string[];    // 파일명 목록 (e.g. ["prd.md", "tech-spec.md"])
  
  // Design job - ui-design mode
  hasScreens: boolean;           // inputs/references/screens/
  hasComponents: boolean;        // inputs/references/components/
  hasAssets: boolean;            // inputs/assets/
  hasFigmaConfig: boolean;       // outputs/design/ui/figma/figma.json with populated file value (workfile reference only; MCP reachability is NOT included — see code resolve's detectFigmaSource for the combined check)
  screenCount?: number;
  componentCount?: number;
  assetCount?: number;
  
  // Design job - system-design mode
  hasSystemDesignDoc: boolean;   // outputs/design/system/*-system-*.md or api-contract-*.md
  hasUiDocs: boolean;            // outputs/design/ui/ant/ui-*.json (ant UiSource present)
  
  // Evaluations
  hasEvals: boolean;             // outputs/evals/ has any reports
  evalCount?: number;            // Total eval report files
  
  // Spec documents
  hasSpecDocs: boolean;          // Any spec-*.md in outputs/design/spec/
  specDocCount?: number;
  specDocNames?: string[];       // e.g. ['spec-social-login.md', 'spec-payment.md']

  // Code job
  hasDesignDoc: boolean;         // Any design doc under outputs/design/system|ui|spec/
  hasCodebase: boolean;          // Indexed in vector DB
  indexedFileCount?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Graph State Extension
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * TriageableContext: Minimal context for triage node.
 * Architect uses full ProjectContext (subtype), Planner uses { featurePath }.
 */
export type TriageableContext = {
  featurePath?: string;
  project?: string;
  [key: string]: any;
};

/**
 * TriageableState: Triage 기능이 추가된 Graph State
 * Design/Code/Plan/Visual/Learn 그래프의 공통 베이스 타입
 *
 * Extends ResolvableState (resolve → triage → detect execution chain).
 * Fields common to ALL nodes (featurePath, context, directive, deps, etc.)
 * live in ResolvableState. Triage-specific fields live here.
 */
export interface TriageableState extends ResolvableState {
  // Triage state (triage-specific fields only; common fields are in ResolvableState)
  skipTriage?: boolean;
  triageResult?: TriageResult;
  workspaceState?: WorkspaceState;
  /** Compact digest of recent session turns — injected into triage prompt for context */
  sessionDigest?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * TriageChoiceRequest: 선택 API 요청
 */
export interface TriageChoiceRequest {
  jobId: string;
  choice: ChoiceAction;
}

/**
 * TriageChoiceResponse: 선택 API 응답
 */
export interface TriageChoiceResponse {
  type: 'guide' | 'continue';
  message?: string;  // guide일 때
  action?: ChoiceAction;  // continue일 때
}
