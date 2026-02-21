/**
 * DetectionReport - 통합 환경 감지 결과
 * 
 * Shared types from @ant/shared + backend-only factory/formatter functions.
 */

// Re-export shared detection types (canonical source: @ant/shared)
export type {
  JobMode,
  JobEnvironment,
  DesignWorkType,
  DesignDomain,
  ProjectProfile,
  JobSource,
  DetectionReport,
} from '@ant/shared';

import type { JobMode, JobEnvironment, DesignDomain, JobSource, DetectionReport, ProjectProfile } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Factory Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Code Job에서 DetectionReport 생성
 */
export function createCodeDetectionReport(params: {
  jobMode: JobMode;
  jobModeReasoning: string;
  environment?: JobEnvironment;
  environmentReasoning?: string;
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
 * Design Job (Spec)에서 DetectionReport 생성
 */
export function createSpecDetectionReport(params: {
  jobMode: JobMode;
  jobModeReasoning: string;
}): DetectionReport {
  return {
    sourceJob: 'design',
    jobMode: params.jobMode,
    jobModeReasoning: params.jobModeReasoning,
    workType: 'spec',
    workTypeReasoning: 'Spec work: generating feature/task specification document',
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
    const workTypeEmoji = report.workType === 'ui-design' ? '🎨' 
      : report.workType === 'spec' ? '📋' : '🏗️';
    const workTypeLabel = report.workType === 'ui-design'
      ? (isKorean ? 'UI 디자인' : 'UI Design')
      : report.workType === 'spec'
        ? (isKorean ? '기능 스펙' : 'Feature Spec')
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
  } else if (report.workType === 'spec') {
    // spec doc output hint is dynamic (spec-{slug}.md), shown after decompose determines the slug
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

/**
 * Profile-only display for decompose node (environment + language + framework).
 * Avoids re-displaying jobMode already shown by detectEnvironment.
 */
export function formatProfileForChat(
  report: DetectionReport,
  language: UserLanguage = 'ko'
): string {
  const isKorean = language === 'ko';
  const parts: string[] = [];

  // Environment
  if (report.environment) {
    const envEmoji = report.environment === 'frontend' ? '🎨' 
      : report.environment === 'backend' ? '⚙️' 
      : report.environment === 'fullstack' ? '🌐' 
      : '❓';
    
    parts.push(isKorean
      ? `${envEmoji} **환경**: ${report.environment}`
      : `${envEmoji} **Environment**: ${report.environment}`);
    
    if (report.environmentReasoning) {
      parts.push(`   └ ${report.environmentReasoning}`);
    }
  }

  // Profile (language + framework)
  if (report.profile?.language) {
    let profileLine = isKorean
      ? `📊 **프로파일**: ${report.profile.language}`
      : `📊 **Profile**: ${report.profile.language}`;
    
    if (report.profile.framework) {
      profileLine += ` + ${report.profile.framework}`;
    }
    parts.push(profileLine);
  }

  return parts.length > 0 ? '\n' + parts.join('\n') + '\n' : '';
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
