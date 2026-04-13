/**
 * Detection helpers — FE-only formatters for shared detection types.
 */

// Re-export shared detection types (canonical source: @ant/shared)
export type {
  Mode,
  IntentGroup,
  DesignDomain,
  InferredAction,
} from '@ant/shared';

import type { Mode, IntentGroup, DesignDomain } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FE-only Helper Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getModeEmoji(mode: Mode): string {
  switch (mode) {
    case 'generate': return '✨';
    case 'refactor': return '🔧';
    case 'explain': return '📖';
  }
}

export function getModeLabel(mode: Mode, isKorean = true): string {
  switch (mode) {
    case 'generate': return isKorean ? '생성' : 'Generate';
    case 'refactor': return isKorean ? '수정' : 'Refactor';
    case 'explain': return isKorean ? '설명' : 'Explain';
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
