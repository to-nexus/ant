/**
 * DetectionReport - 통합 환경 감지 결과
 * 
 * Code Job과 Design Job에서 공통으로 사용하는 감지 결과 구조체.
 * UI 렌더링, 상태 관리, 로깅에서 일관된 형식 제공.
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
// Factory Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Code Job에서 DetectionReport 생성
 */
export function createCodeDetectionReport(params: {
  jobMode: JobMode;
  jobModeReasoning: string;
  environment: JobEnvironment;
  environmentReasoning: string;
  profile?: ProjectProfile;
  requireRag?: boolean;
}): DetectionReport {
  return {
    sourceJob: 'code',
    jobMode: params.jobMode,
    jobModeReasoning: params.jobModeReasoning,
    environment: params.environment,
    environmentReasoning: params.environmentReasoning,
    profile: params.profile,
    requireRag: params.requireRag,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Design Job (UI Design)에서 DetectionReport 생성
 */
export function createUiDesignDetectionReport(params: {
  jobMode: JobMode;
  jobModeReasoning: string;
}): DetectionReport {
  return {
    sourceJob: 'design',
    jobMode: params.jobMode,
    jobModeReasoning: params.jobModeReasoning,
    workType: 'ui-design',
    workTypeReasoning: 'UI design work: generating ui-tokens.json, ui-assets.json, ui-spec.json',
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Design Job (System Design)에서 DetectionReport 생성
 */
export function createSystemDesignDetectionReport(params: {
  jobMode: JobMode;
  jobModeReasoning: string;
  environment: JobEnvironment;
  environmentReasoning: string;
  domain: DesignDomain;
  domainReasoning: string;
}): DetectionReport {
  return {
    sourceJob: 'design',
    jobMode: params.jobMode,
    jobModeReasoning: params.jobModeReasoning,
    workType: 'system-design',
    workTypeReasoning: 'System design work: generating architecture documents',
    environment: params.environment,
    environmentReasoning: params.environmentReasoning,
    domain: params.domain,
    domainReasoning: params.domainReasoning,
    detectedAt: new Date().toISOString(),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Chat UI Formatter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { UserLanguage } from '../utils/languageDetector';

/**
 * DetectionReport를 Chat UI용 마크다운으로 변환
 */
export function formatDetectionReportForChat(
  report: DetectionReport,
  language: UserLanguage = 'ko'
): string {
  const isKorean = language === 'ko';
  
  let formatted = isKorean
    ? `\n🔍 **환경 분석 완료**\n\n`
    : `\n🔍 **Environment Analysis Complete**\n\n`;
  
  // ━━━ 1. Job Mode (공통) ━━━
  const modeEmoji = report.jobMode === 'generate' ? '✨' 
    : report.jobMode === 'refactor' ? '🔧' 
    : '📖';
  
  formatted += isKorean
    ? `${modeEmoji} **작업 모드**: ${report.jobMode}\n`
    : `${modeEmoji} **Job Mode**: ${report.jobMode}\n`;
  
  if (report.jobModeReasoning) {
    formatted += `   └ ${report.jobModeReasoning}\n\n`;
  }
  
  // ━━━ 2. Work Type (Design Job only) ━━━
  if (report.workType) {
    const workTypeEmoji = report.workType === 'ui-design' ? '🎨' : '🏗️';
    const workTypeLabel = report.workType === 'ui-design'
      ? (isKorean ? 'UI 디자인' : 'UI Design')
      : (isKorean ? '시스템 디자인' : 'System Design');
    
    formatted += isKorean
      ? `${workTypeEmoji} **작업 유형**: ${workTypeLabel}\n`
      : `${workTypeEmoji} **Work Type**: ${workTypeLabel}\n`;
    
    if (report.workTypeReasoning) {
      formatted += `   └ ${report.workTypeReasoning}\n\n`;
    }
  }
  
  // ━━━ 3. Domain (System Design only) ━━━
  if (report.domain) {
    const domainEmoji = report.domain === 'game' ? '🎮' : '🔧';
    
    formatted += isKorean
      ? `${domainEmoji} **도메인**: ${report.domain}\n`
      : `${domainEmoji} **Domain**: ${report.domain}\n`;
    
    if (report.domainReasoning) {
      formatted += `   └ ${report.domainReasoning}\n\n`;
    }
  }
  
  // ━━━ 4. Environment (Code Job & System Design) ━━━
  if (report.environment) {
    const envEmoji = report.environment === 'frontend' ? '🎨' 
      : report.environment === 'backend' ? '⚙️' 
      : report.environment === 'fullstack' ? '🌐' 
      : '❓';
    
    formatted += isKorean
      ? `${envEmoji} **환경**: ${report.environment}\n`
      : `${envEmoji} **Environment**: ${report.environment}\n`;
    
    if (report.environmentReasoning) {
      formatted += `   └ ${report.environmentReasoning}\n\n`;
    }
  }
  
  // ━━━ 5. Profile (Code Job only) ━━━
  if (report.profile?.language) {
    formatted += isKorean
      ? `📊 **프로파일**: ${report.profile.language}`
      : `📊 **Profile**: ${report.profile.language}`;
    
    if (report.profile.framework) {
      formatted += ` + ${report.profile.framework}`;
    }
    formatted += '\n\n';
  }
  
  // ━━━ 6. Output Files Hint (Design Job) ━━━
  if (report.workType === 'ui-design') {
    formatted += isKorean
      ? `📄 **생성 문서**:\n`
      : `📄 **Output Documents**:\n`;
    formatted += `   • \`outputs/design/ui-tokens.json\`\n`;
    formatted += `   • \`outputs/design/ui-assets.json\`\n`;
    formatted += `   • \`outputs/design/ui-spec.json\`\n\n`;
  } else if (report.workType === 'system-design' && report.environment) {
    if (report.environment === 'fullstack') {
      formatted += isKorean
        ? `📄 **생성 문서**: \`api-contract.md\`, \`fe-system-design.md\`, \`be-system-design.md\`\n\n`
        : `📄 **Output**: \`api-contract.md\`, \`fe-system-design.md\`, \`be-system-design.md\`\n\n`;
    } else {
      formatted += isKorean
        ? `📄 **생성 문서**: \`system-design.md\`\n\n`
        : `📄 **Output**: \`system-design.md\`\n\n`;
    }
  }
  
  return formatted;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JSON Parser (from LLM response)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * LLM 응답의 <detect> 태그에서 DetectionReport 파싱
 */
export function parseDetectionReportFromLLM(
  response: string,
  sourceJob: JobSource
): DetectionReport | null {
  try {
    // Extract from <detect> XML tag
    const detectMatch = response.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);
    
    let jsonStr: string;
    if (detectMatch) {
      jsonStr = detectMatch[1];
    } else {
      // Fallback: Try ```json or plain JSON
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                        response.match(/{[\s\S]*}/);
      
      if (!jsonMatch) {
        return null;
      }
      
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Build DetectionReport from parsed JSON
    const report: DetectionReport = {
      sourceJob,
      jobMode: parsed.jobMode || parsed.mode || 'generate',
      jobModeReasoning: parsed.jobModeReasoning || parsed.modeReasoning || '',
      detectedAt: new Date().toISOString(),
    };
    
    // Environment (common)
    if (parsed.environment) {
      report.environment = parsed.environment;
      report.environmentReasoning = parsed.environmentReasoning;
    }
    
    // Design-specific fields
    if (sourceJob === 'design') {
      if (parsed.workType) {
        report.workType = parsed.workType;
        report.workTypeReasoning = parsed.workTypeReasoning;
      }
      if (parsed.domain) {
        report.domain = parsed.domain;
        report.domainReasoning = parsed.domainReasoning;
      }
    }
    
    // Code-specific fields
    if (sourceJob === 'code') {
      if (parsed.profile) {
        report.profile = {
          language: parsed.profile.language || 'typescript',
          framework: parsed.profile.framework,
        };
      }
      if (parsed.requireRag !== undefined || parsed.requireRagForDecompose !== undefined) {
        report.requireRag = parsed.requireRag ?? parsed.requireRagForDecompose;
      }
    }
    
    return report;
  } catch (error) {
    console.error('[DetectionReport] Failed to parse LLM response:', error);
    return null;
  }
}

/**
 * DetectionReport를 <detect> 태그용 JSON으로 직렬화
 */
export function serializeDetectionReportToJson(report: DetectionReport): string {
  const json: Record<string, any> = {
    jobMode: report.jobMode,
    jobModeReasoning: report.jobModeReasoning,
  };
  
  if (report.environment) {
    json.environment = report.environment;
    json.environmentReasoning = report.environmentReasoning;
  }
  
  if (report.workType) {
    json.workType = report.workType;
    json.workTypeReasoning = report.workTypeReasoning;
  }
  
  if (report.domain) {
    json.domain = report.domain;
    json.domainReasoning = report.domainReasoning;
  }
  
  if (report.profile) {
    json.profile = report.profile;
  }
  
  if (report.requireRag !== undefined) {
    json.requireRag = report.requireRag;
  }
  
  return JSON.stringify(json, null, 2);
}
