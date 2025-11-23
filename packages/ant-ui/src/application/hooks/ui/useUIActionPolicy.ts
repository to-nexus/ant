/**
 * useUIActionPolicy Hook
 * 
 * UI 액션 정책을 중앙에서 관리하는 훅
 * 
 * 목적:
 * - 모든 UI 액션의 활성화/비활성화 상태를 한 곳에서 관리
 * - 일관성 있는 UX 제공
 * - 정책 변경 시 한 곳만 수정
 * 
 * 설계 원칙:
 * - Single Source of Truth (SSOT)
 * - Policy-based UI Control
 * - Centralized Business Rules
 * 
 * 사용법:
 * ```typescript
 * const policy = useUIActionPolicy();
 * 
 * <Dropdown 
 *   disabled={!policy.canChangeProject}
 *   tooltip={policy.canChangeProject ? undefined : policy.disabledReason}
 * />
 * ```
 */

import { useStore } from '@/domain/store';

export interface UIActionPolicy {
  // ============================================
  // Selection Actions (프로젝트/기능/에이전트 선택)
  // ============================================
  canChangeProject: boolean;
  canChangeFeature: boolean;
  canChangeAgent: boolean;
  canChangeWorkType: boolean;  // job 타입 (code, design 등)
  
  // ============================================
  // Execution Actions (실행/중단)
  // ============================================
  canRun: boolean;
  canStop: boolean;
  
  // ============================================
  // Configuration Actions (설정 변경)
  // ============================================
  canEditConfig: boolean;
  canChangeMode: boolean;  // generate/refactor/explain
  
  // ============================================
  // File Tree Actions (파일 트리 조작)
  // ============================================
  canCreateFile: boolean;       // 파일 생성
  canCreateDirectory: boolean;  // 디렉토리 생성
  canUploadFiles: boolean;      // 파일 업로드
  canDeleteFile: boolean;       // 파일 삭제
  canSelectFile: boolean;       // 파일 선택/보기 (항상 가능)
  
  // ============================================
  // Dev Server Actions (개발 서버)
  // ============================================
  canStartDevServer: boolean;   // 개발 서버 시작 가능
  canStopDevServer: boolean;    // 개발 서버 중단 가능
  
  // ============================================
  // Display Policy (표시/숨김 정책)
  // ============================================
  shouldShowWorkflowIndicators: boolean;  // 워크플로우 인디케이터 표시 여부
  shouldShowInterruptUI: boolean;  // Interrupt UI (재개 프롬프트) 표시 여부
  
  // ============================================
  // State Flags (현재 상태)
  // ============================================
  isRunning: boolean;
  isStopping: boolean;
  isDisconnected: boolean;
  
  // ============================================
  // Disabled Reason (비활성화 이유)
  // ============================================
  disabledReason: string | null;
}

/**
 * UI 액션 정책 훅
 * 
 * 모든 UI 액션의 가능 여부를 결정하는 중앙 집중식 정책
 */
export function useUIActionPolicy(): UIActionPolicy {
  const isRunning = useStore(state => state.isRunning);
  const isStopping = useStore(state => state.isStopping);
  const isDisconnected = useStore(state => state.connectionStatus === 'disconnected');
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const backendMode = useStore(state => state.backendMode);
  const userEmail = useStore(state => state.userEmail);
  const isDevServerLoading = useStore(state => state.isDevServerLoading);
  const devServerStatus = useStore(state => state.devServerStatus);
  
  // ============================================
  // Policy Rules (정책 규칙)
  // ============================================
  
  /**
   * Rule 0: Cloud 모드에서 비로그인 시 모든 액션 불가
   * - backendMode === 'cloud' && !userEmail → 모든 액션 비활성화
   */
  const isAuthenticated = backendMode === 'local' || !!userEmail;
  
  /**
   * Rule 1: 작업 진행 중에는 모든 선택 변경 불가
   * - isRunning || isStopping → 모든 selection 비활성화
   */
  const isWorkInProgress = isRunning || isStopping;
  
  /**
   * Rule 2: 서버 연결 끊김 시 모든 액션 불가
   * - isDisconnected → 모든 액션 비활성화
   */
  const canPerformAnyAction = !isDisconnected && isAuthenticated;
  
  /**
   * Rule 3: Run 실행 조건
   * - NOT running
   * - NOT stopping
   * - NOT disconnected
   * - project AND feature 선택됨
   */
  const hasValidSelection = !!selectedProject && !!selectedFeature;
  const canRun = !isRunning && !isStopping && canPerformAnyAction && hasValidSelection;
  
  /**
   * Rule 4: Stop 실행 조건
   * - IS running
   * - NOT stopping (중복 방지)
   * - NOT disconnected
   */
  const canStop = isRunning && !isStopping && canPerformAnyAction;
  
  /**
   * Rule 5: Dev Server 시작 조건
   * - NOT job running (작업 실행 중 아님)
   * - NOT dev server loading (개발서버 시작/중단 중 아님)
   * - NOT disconnected
   * - project 선택됨
   */
  const canStartDevServer = !isRunning && !isDevServerLoading && canPerformAnyAction && !!selectedProject && !(devServerStatus?.running ?? false);
  
  /**
   * Rule 6: Dev Server 중단 조건
   * - Dev server running
   * - NOT dev server loading (개발서버 시작/중단 중 아님)
   * - NOT disconnected
   */
  const canStopDevServer = (devServerStatus?.running ?? false) && !isDevServerLoading && canPerformAnyAction;
  
  // ============================================
  // Disabled Reason (비활성화 사유 메시지)
  // ============================================
  let disabledReason: string | null = null;
  
  if (!isAuthenticated) {
    disabledReason = 'Please sign in to continue';
  } else if (isDisconnected) {
    disabledReason = 'Server disconnected';
  } else if (isStopping) {
    disabledReason = 'Stopping in progress...';
  } else if (isRunning) {
    disabledReason = 'Task is running';
  } else if (!hasValidSelection) {
    disabledReason = 'Select project and feature first';
  }
  
  // ============================================
  // Policy Object (정책 객체)
  // ============================================
  return {
    // Selection Actions
    canChangeProject: !isWorkInProgress && canPerformAnyAction,
    canChangeFeature: !isWorkInProgress && canPerformAnyAction,
    canChangeAgent: !isWorkInProgress && canPerformAnyAction,
    canChangeWorkType: !isWorkInProgress && canPerformAnyAction,
    
    // Execution Actions
    canRun,
    canStop,
    
    // Configuration Actions
    canEditConfig: !isWorkInProgress && canPerformAnyAction,
    canChangeMode: !isWorkInProgress && canPerformAnyAction,
    
    // File Tree Actions
    // Rule: 작업 진행 중에는 파일 조작 불가 (읽기만 가능)
    canCreateFile: !isWorkInProgress && canPerformAnyAction,
    canCreateDirectory: !isWorkInProgress && canPerformAnyAction,
    canUploadFiles: !isWorkInProgress && canPerformAnyAction,
    canDeleteFile: !isWorkInProgress && canPerformAnyAction,
    canSelectFile: canPerformAnyAction,  // 파일 선택/보기는 항상 가능 (서버 연결 시)
    
    // Dev Server Actions
    canStartDevServer,
    canStopDevServer,
    
    // Display Policy
    shouldShowWorkflowIndicators: isRunning && !isStopping,  // 실행 중이고 중단 중이 아닐 때만 표시
    shouldShowInterruptUI: !isRunning && !isStopping,  // 작업이 멈춘 상태일 때만 표시 (+ kanbanData 조건은 컴포넌트에서 추가 체크)
    
    // State Flags
    isRunning,
    isStopping,
    isDisconnected,
    
    // Disabled Reason
    disabledReason
  };
}

/**
 * Example Usage:
 * 
 * ```typescript
 * // In ProjectSection.tsx
 * export function ProjectSection() {
 *   const policy = useUIActionPolicy();
 *   
 *   return (
 *     <Dropdown 
 *       disabled={!policy.canChangeProject}
 *       tooltip={policy.canChangeProject ? undefined : policy.disabledReason}
 *     />
 *   );
 * }
 * 
 * // In GlobalNavBar.tsx
 * export function GlobalNavBar() {
 *   const policy = useUIActionPolicy();
 *   
 *   return (
 *     <>
 *       <Button 
 *         onClick={handleRun}
 *         disabled={!policy.canRun}
 *       >
 *         Run
 *       </Button>
 *       <Button 
 *         onClick={handleStop}
 *         disabled={!policy.canStop}
 *       >
 *         Stop
 *       </Button>
 *     </>
 *   );
 * }
 * ```
 */

