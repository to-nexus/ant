/**
 * DetectionReport - Frontend helpers
 * 
 * Shared types from @ant/shared + FE-only helper/formatter functions.
 */

// Re-export shared detection types (canonical source: @ant/shared)
export type {
  Mode,
  JobMode,
  JobEnvironment,
  IntentGroup,
  DesignDomain,
  ProjectProfile,
  DetectionSummary,
  DetectionReport,
} from '@ant/shared';

import type { Mode, JobEnvironment, IntentGroup, DesignDomain } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FE-only Helper Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getJobModeEmoji(mode: Mode): string {
  switch (mode) {
    case 'generate': return '✨';
    case 'refactor': return '🔧';
    case 'explain': return '📖';
  }
}

export function getJobModeLabel(mode: Mode, isKorean = true): string {
  switch (mode) {
    case 'generate': return isKorean ? '생성' : 'Generate';
    case 'refactor': return isKorean ? '수정' : 'Refactor';
    case 'explain': return isKorean ? '설명' : 'Explain';
  }
}

export function getEnvironmentEmoji(env: JobEnvironment): string {
  switch (env) {
    case 'frontend': return '🎨';
    case 'backend': return '⚙️';
    case 'fullstack': return '🌐';
    case 'unknown': return '❓';
  }
}

export function getIntentGroupEmoji(intentGroup: IntentGroup): string {
  switch (intentGroup) {
    case 'design-ui': return '🎨';
    case 'design-system': return '🏗️';
    case 'design-spec': return '📋';
    default: return '📄';
  }
}

export function getDomainEmoji(domain: DesignDomain): string {
  switch (domain) {
    case 'game': return '🎮';
    case 'service': return '🔧';
  }
}
