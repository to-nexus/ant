/**
 * DetectionReport - 통합 환경 감지 결과 (Frontend)
 * 
 * Backend의 core/types/detection.ts와 동일한 구조.
 * Code Job과 Design Job에서 공통으로 사용.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Type Definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 작업 모드 (Code & Design 통합) */
export type JobMode = 'generate' | 'refactor' | 'explain';

/** 실행 환경 */
export type JobEnvironment = 'frontend' | 'backend' | 'fullstack' | 'unknown';

/** 작업 유형 (Design Job only) */
export type DesignWorkType = 'ui-design' | 'system-design';

/** 도메인 (System Design only) */
export type DesignDomain = 'game' | 'service';

/** 프로젝트 프로파일 (Code Job only) */
export interface ProjectProfile {
  language: string;
  framework?: string;
}

/** Job 소스 타입 */
export type JobSource = 'code' | 'design';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 통합 감지 결과 (Code Job & Design Job 공통)
 */
export interface DetectionReport {
  // ━━━ 공통 항목 (Code & Design) ━━━
  
  /** 작업 모드 */
  jobMode: JobMode;
  jobModeReasoning: string;
  
  /** 실행 환경 */
  environment?: JobEnvironment;
  environmentReasoning?: string;
  
  // ━━━ Design Job 전용 ━━━
  
  /** 작업 유형 (Design Job only) */
  workType?: DesignWorkType;
  workTypeReasoning?: string;
  
  /** 도메인 (System Design only) */
  domain?: DesignDomain;
  domainReasoning?: string;
  
  // ━━━ Code Job 전용 ━━━
  
  /** 프로젝트 프로파일 */
  profile?: ProjectProfile;
  
  /** RAG 필요 여부 */
  requireRag?: boolean;
  
  // ━━━ 메타 정보 ━━━
  
  /** 어떤 Job에서 생성되었는지 */
  sourceJob: JobSource;
  
  /** 감지 시간 */
  detectedAt?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Job Mode에 대한 이모지 반환
 */
export function getJobModeEmoji(mode: JobMode): string {
  switch (mode) {
    case 'generate': return '✨';
    case 'refactor': return '🔧';
    case 'explain': return '📖';
  }
}

/**
 * Job Mode에 대한 한글 라벨 반환
 */
export function getJobModeLabel(mode: JobMode, isKorean = true): string {
  switch (mode) {
    case 'generate': return isKorean ? '생성' : 'Generate';
    case 'refactor': return isKorean ? '수정' : 'Refactor';
    case 'explain': return isKorean ? '설명' : 'Explain';
  }
}

/**
 * Environment에 대한 이모지 반환
 */
export function getEnvironmentEmoji(env: JobEnvironment): string {
  switch (env) {
    case 'frontend': return '🎨';
    case 'backend': return '⚙️';
    case 'fullstack': return '🌐';
    case 'unknown': return '❓';
  }
}

/**
 * Work Type에 대한 이모지 반환
 */
export function getWorkTypeEmoji(workType: DesignWorkType): string {
  switch (workType) {
    case 'ui-design': return '🎨';
    case 'system-design': return '🏗️';
  }
}

/**
 * Domain에 대한 이모지 반환
 */
export function getDomainEmoji(domain: DesignDomain): string {
  switch (domain) {
    case 'game': return '🎮';
    case 'service': return '🔧';
  }
}
