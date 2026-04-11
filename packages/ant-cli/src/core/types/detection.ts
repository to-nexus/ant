/**
 * DetectionReport - 통합 환경 감지 결과
 * 
 * Shared types from @ant/shared + backend-only factory/formatter functions.
 */

// Re-export shared detection types (canonical source: @ant/shared)
export type {
  Mode,
  JobMode,
  JobEnvironment,
  IntentGroup,
  DesignDomain,
  ProjectProfile,
  JobSource,
  DetectionReport,
} from '@ant/shared';

import type { Mode, JobEnvironment, DesignDomain, JobSource, DetectionReport, ProjectProfile } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Factory Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Code Job에서 DetectionReport 생성
 */
export function createCodeDetectionReport(params: {
  detectedMode: Mode;
  detectedModeReasoning: string;
  environment?: JobEnvironment;
  environmentReasoning?: string;
  profile?: ProjectProfile;
  requireRag?: boolean;
  primarySources?: string[];
  primarySourcesReasoning?: string;
}): DetectionReport {
  return {
    sourceJob: 'code',
    detectedMode: params.detectedMode,
    detectedModeReasoning: params.detectedModeReasoning,
    environment: params.environment,
    environmentReasoning: params.environmentReasoning,
    profile: params.profile,
    requireRag: params.requireRag,
    primarySources: params.primarySources,
    primarySourcesReasoning: params.primarySourcesReasoning,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Design Job (UI Design)에서 DetectionReport 생성
 */
export function createUiDesignDetectionReport(params: {
  detectedMode: Mode;
  detectedModeReasoning: string;
}): DetectionReport {
  return {
    sourceJob: 'design',
    detectedMode: params.detectedMode,
    detectedModeReasoning: params.detectedModeReasoning,
    detectedIntentGroup: 'design-ui',
    detectedIntentGroupReasoning: 'UI design work: generating ui-tokens.json, ui-assets.json, ui-spec.json',
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Design Job (Spec)에서 DetectionReport 생성
 */
export function createSpecDetectionReport(params: {
  detectedMode: Mode;
  detectedModeReasoning: string;
}): DetectionReport {
  return {
    sourceJob: 'design',
    detectedMode: params.detectedMode,
    detectedModeReasoning: params.detectedModeReasoning,
    detectedIntentGroup: 'design-spec',
    detectedIntentGroupReasoning: 'Spec work: generating feature/task specification document',
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Design Job (System Design)에서 DetectionReport 생성
 */
export function createSystemDesignDetectionReport(params: {
  detectedMode: Mode;
  detectedModeReasoning: string;
  environment: JobEnvironment;
  environmentReasoning: string;
  domain: DesignDomain;
  domainReasoning: string;
}): DetectionReport {
  return {
    sourceJob: 'design',
    detectedMode: params.detectedMode,
    detectedModeReasoning: params.detectedModeReasoning,
    detectedIntentGroup: 'design-system',
    detectedIntentGroupReasoning: 'System design work: generating architecture documents',
    environment: params.environment,
    environmentReasoning: params.environmentReasoning,
    domain: params.domain,
    domainReasoning: params.domainReasoning,
    detectedAt: new Date().toISOString(),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Target Files Resolution (Single Source of Truth)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function filterByTier(files: string[], env: JobEnvironment | undefined): string[] {
  if (env === 'frontend') return files.filter(f => f.startsWith('fe-system-'));
  if (env === 'backend') return files.filter(f => f.startsWith('be-system-') || f.startsWith('api-contract-'));
  return files;
}

function getDefaultTargetFiles(env: JobEnvironment | undefined): string[] {
  if (env === 'frontend') return ['fe-system-main.md'];
  if (env === 'backend') return ['api-contract-main.md', 'be-system-main.md'];
  if (env === 'fullstack') return ['api-contract-main.md', 'fe-system-main.md', 'be-system-main.md'];
  return ['be-system-main.md'];
}

/**
 * Resolve targetFiles and effective mode for system-design work.
 * Called once after detect LLM response — both chat and decompose consume the result.
 *
 * - refactor requires same-tier docs; falls back to generate otherwise.
 * - api-contract-*.md is backend/fullstack own-tier, NOT frontend own-tier.
 */
export function resolveDesignTargetFiles(
  environment: JobEnvironment | undefined,
  mode: Mode,
  existingDesignFiles: string[]
): { targetFiles: string[]; effectiveMode: Mode } {
  if (mode === 'refactor' && existingDesignFiles.length > 0) {
    const ownTierFiles = filterByTier(existingDesignFiles, environment);
    if (ownTierFiles.length > 0) {
      return { targetFiles: ownTierFiles, effectiveMode: 'refactor' };
    }
  }

  const targetFiles = getDefaultTargetFiles(environment);
  return { targetFiles, effectiveMode: mode === 'refactor' ? 'generate' : mode };
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
  
  // ━━━ 1. Mode (공통) ━━━
  const modeEmoji = report.detectedMode === 'generate' ? '✨' 
    : report.detectedMode === 'refactor' ? '🔧' 
    : '📖';
  
  formatted += isKorean
    ? `${modeEmoji} **작업 모드**: ${report.detectedMode}\n`
    : `${modeEmoji} **Job Mode**: ${report.detectedMode}\n`;
  
  if (report.detectedModeReasoning) {
    formatted += `   └ ${report.detectedModeReasoning}\n\n`;
  }
  
  // ━━━ 2. Intent Group (Design Job only) ━━━
  const intentGroup = report.detectedIntentGroup;
  if (intentGroup) {
    const igEmoji = intentGroup === 'design-ui' ? '🎨' 
      : intentGroup === 'design-spec' ? '📋' : '🏗️';
    const igLabel = intentGroup === 'design-ui'
      ? (isKorean ? 'UI 디자인' : 'UI Design')
      : intentGroup === 'design-spec'
        ? (isKorean ? '기능 스펙' : 'Feature Spec')
        : (isKorean ? '시스템 디자인' : 'System Design');
    
    formatted += isKorean
      ? `${igEmoji} **작업 유형**: ${igLabel}\n`
      : `${igEmoji} **Work Type**: ${igLabel}\n`;
    
    const igReasoning = report.detectedIntentGroupReasoning;
    if (igReasoning) {
      formatted += `   └ ${igReasoning}\n\n`;
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
  if (intentGroup === 'design-ui') {
    formatted += isKorean
      ? `📄 **생성 문서**:\n`
      : `📄 **Output Documents**:\n`;
    formatted += `   • \`outputs/design/ui/ui-tokens.json\`\n`;
    formatted += `   • \`outputs/design/ui/ui-assets.json\`\n`;
    formatted += `   • \`outputs/design/ui/ui-spec.json\`\n\n`;
  } else if (intentGroup === 'design-spec') {
    // spec doc output hint is dynamic (spec-{slug}.md), shown after decompose determines the slug
  } else if (intentGroup === 'design-system') {
    if (report.detectedMode === 'refactor' && report.targetFiles?.length) {
      const filesList = report.targetFiles.map(f => `\`${f}\``).join(', ');
      formatted += isKorean
        ? `📄 **대상 문서**: ${filesList}\n\n`
        : `📄 **Target**: ${filesList}\n\n`;
    } else if (report.environment) {
      const typePatterns =
        report.environment === 'fullstack' ? '`api-contract-*.md`, `fe-system-*.md`, `be-system-*.md`' :
        report.environment === 'backend' ? '`api-contract-*.md`, `be-system-*.md`' :
        report.environment === 'frontend' ? '`fe-system-*.md`' :
        '`be-system-*.md`';
      formatted += isKorean
        ? `📄 **생성 문서**: ${typePatterns}\n\n`
        : `📄 **Output**: ${typePatterns}\n\n`;
    }
  }
  
  return formatted;
}

/**
 * Visual Job의 classify 결과를 Chat UI용 마크다운으로 변환
 */
export function formatVisualClassifyForChat(
  assetType: string,
  jobMode: string,
  reasoning: string,
  language: UserLanguage = 'ko'
): string {
  const isKorean = language === 'ko';

  const assetEmoji: Record<string, string> = {
    logo: '🏷️', icon: '🔷', hero: '🖼️', illustration: '🎨', general: '📦',
  };

  const modeEmoji: Record<string, string> = {
    generate: '✨', explain: '💡',
  };

  let formatted = isKorean
    ? `\n🏷️ **에셋 분류 완료**\n\n`
    : `\n🏷️ **Asset Classification Complete**\n\n`;

  formatted += isKorean
    ? `${assetEmoji[assetType] || '📦'} **에셋 유형**: ${assetType}\n`
    : `${assetEmoji[assetType] || '📦'} **Asset Type**: ${assetType}\n`;

  formatted += isKorean
    ? `${modeEmoji[jobMode] || '✨'} **작업 모드**: ${jobMode}\n`
    : `${modeEmoji[jobMode] || '✨'} **Job Mode**: ${jobMode}\n`;

  if (reasoning) {
    formatted += `   └ ${reasoning}\n`;
  }

  formatted += '\n';
  return formatted;
}

/**
 * Profile-only display for decompose node (environment + language + framework).
 * Avoids re-displaying detectedMode already shown by detectEnvironment.
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
      detectedMode: parsed.detectedMode || parsed.jobMode || parsed.mode || 'generate',
      detectedModeReasoning: parsed.detectedModeReasoning || parsed.jobModeReasoning || parsed.modeReasoning || '',
      detectedAt: new Date().toISOString(),
    };
    
    // Environment (common)
    if (parsed.environment) {
      report.environment = parsed.environment;
      report.environmentReasoning = parsed.environmentReasoning;
    }
    
    // Design-specific fields
    if (sourceJob === 'design') {
      const ig = parsed.intentGroup ?? parsed.workType;
      if (ig) {
        report.detectedIntentGroup = ig;
        report.detectedIntentGroupReasoning = parsed.intentGroupReasoning ?? parsed.workTypeReasoning;
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
    detectedMode: report.detectedMode,
    detectedModeReasoning: report.detectedModeReasoning,
  };
  
  if (report.environment) {
    json.environment = report.environment;
    json.environmentReasoning = report.environmentReasoning;
  }
  
  const ig = report.detectedIntentGroup;
  if (ig) {
    json.intentGroup = ig;
    json.intentGroupReasoning = report.detectedIntentGroupReasoning;
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

/**
 * Normalize a DetectionReport loaded from session JSON.
 * Maps deprecated field names (jobMode/intentGroup/workType) to current names (detectedMode/detectedIntentGroup).
 */
const LEGACY_INTENT_GROUP_MAP: Record<string, string> = {
  'ui-design': 'design-ui',
  'system-design': 'design-system',
  'spec': 'design-spec',
};

function migrateIntentGroup(value: string | undefined): string | undefined {
  if (!value) return value;
  return LEGACY_INTENT_GROUP_MAP[value] ?? value;
}

export function normalizeDetectionReport(raw: any): DetectionReport {
  const rawIG = raw.detectedIntentGroup ?? raw.intentGroup ?? raw.workType;
  return {
    ...raw,
    detectedMode: raw.detectedMode ?? raw.jobMode ?? 'generate',
    detectedModeReasoning: raw.detectedModeReasoning ?? raw.jobModeReasoning ?? '',
    detectedIntentGroup: migrateIntentGroup(rawIG),
    detectedIntentGroupReasoning: raw.detectedIntentGroupReasoning ?? raw.intentGroupReasoning ?? raw.workTypeReasoning,
    workType: undefined,
    workTypeReasoning: undefined,
  };
}
