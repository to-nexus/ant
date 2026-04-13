/**
 * Detection Utilities
 *
 * Backend-only helpers for detect pipeline.
 * Shared types come from @ant/shared (InferredAction, Mode, IntentGroup, etc.).
 *
 * - formatRACForChat: RAC + transient reasoning → chat markdown
 * - resolveDesignTargetFiles: intentId → target files for system-design
 * - parseInferredActionFromLLM: <detect> XML tag → InferredAction
 */

// Re-export shared detection types (canonical source: @ant/shared)
export type {
  Mode,
  IntentGroup,
  DesignDomain,
  InferredAction,
} from '@ant/shared';

import type { Mode, IntentGroup, DesignDomain, InferredAction, ResolvedActionContext } from '@ant/shared';
import { isValidIntentId } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Target Files Resolution — intentId → target files (no intermediate environment)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getDefaultTargetFilesFromIntent(intentId: string): string[] {
  switch (intentId) {
    case 'gen-sys-fe': return ['fe-system-main.md'];
    case 'gen-sys-be': return ['api-contract-main.md', 'be-system-main.md'];
    case 'gen-sys-full': return ['api-contract-main.md', 'fe-system-main.md', 'be-system-main.md'];
    default: return ['be-system-main.md'];
  }
}

function filterByIntent(files: string[], intentId: string): string[] {
  if (intentId === 'gen-sys-fe' || intentId === 'rev-sys') {
    // rev-sys: filter to whatever tier exists; gen-sys-fe: frontend only
    if (intentId === 'gen-sys-fe') return files.filter(f => f.startsWith('fe-system-'));
  }
  if (intentId === 'gen-sys-be') {
    return files.filter(f => f.startsWith('be-system-') || f.startsWith('api-contract-'));
  }
  return files;
}

/**
 * Resolve targetFiles and effective mode for system-design work.
 * Uses intentId directly — no intermediate environment concept.
 *
 * For refactor: requires same-tier docs to exist; falls back to generate if not.
 */
export function resolveDesignTargetFiles(
  intentId: string,
  mode: Mode,
  existingDesignFiles: string[],
): { targetFiles: string[]; effectiveMode: Mode } {
  if (mode === 'refactor' && existingDesignFiles.length > 0) {
    const ownTierFiles = filterByIntent(existingDesignFiles, intentId);
    if (ownTierFiles.length > 0) {
      return { targetFiles: ownTierFiles, effectiveMode: 'refactor' };
    }
  }

  const targetFiles = getDefaultTargetFilesFromIntent(intentId);
  return { targetFiles, effectiveMode: mode === 'refactor' ? 'generate' : mode };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Chat UI Formatter — RAC + transient reasoning → markdown
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { UserLanguage } from '../utils/languageDetector';

export function formatRACForChat(
  rac: ResolvedActionContext,
  reasoning?: { intent?: string; domain?: string },
  language: UserLanguage = 'ko',
): string {
  const isKorean = language === 'ko';
  const isVisual = rac.intentGroup === 'visual';

  let formatted = isVisual
    ? (isKorean ? `\n🏷️ **에셋 분류 완료**\n\n` : `\n🏷️ **Asset Classification Complete**\n\n`)
    : (isKorean ? `\n🔍 **분석 완료**\n\n` : `\n🔍 **Analysis Complete**\n\n`);

  // Mode
  const modeEmoji = rac.mode === 'generate' ? '✨' : rac.mode === 'refactor' ? '🔧' : '📖';
  formatted += isKorean
    ? `${modeEmoji} **작업 모드**: ${rac.mode}\n`
    : `${modeEmoji} **Mode**: ${rac.mode}\n`;

  if (reasoning?.intent) {
    formatted += `   └ ${reasoning.intent}\n\n`;
  }

  if (isVisual) return formatted + '\n';

  // Intent Group (design jobs)
  const ig = rac.intentGroup;
  if (ig && (ig === 'design-ui' || ig === 'design-spec' || ig === 'design-system')) {
    const igEmoji = ig === 'design-ui' ? '🎨' : ig === 'design-spec' ? '📋' : '🏗️';
    const igLabel = ig === 'design-ui'
      ? (isKorean ? 'UI 디자인' : 'UI Design')
      : ig === 'design-spec'
        ? (isKorean ? '기능 스펙' : 'Feature Spec')
        : (isKorean ? '시스템 디자인' : 'System Design');

    formatted += isKorean
      ? `${igEmoji} **작업 유형**: ${igLabel}\n\n`
      : `${igEmoji} **Work Type**: ${igLabel}\n\n`;
  }

  // Domain (system-design only)
  if (rac.domain) {
    const domainEmoji = rac.domain === 'game' ? '🎮' : '🔧';
    formatted += isKorean
      ? `${domainEmoji} **도메인**: ${rac.domain}\n`
      : `${domainEmoji} **Domain**: ${rac.domain}\n`;

    if (reasoning?.domain) {
      formatted += `   └ ${reasoning.domain}\n\n`;
    }
  }

  // Target files hint (system-design)
  if (ig === 'design-system' && rac.target?.length) {
    const filesList = rac.target.map(f => `\`${f}\``).join(', ');
    formatted += isKorean
      ? `📄 **대상 문서**: ${filesList}\n\n`
      : `📄 **Target**: ${filesList}\n\n`;
  }

  // UI design output hint
  if (ig === 'design-ui') {
    formatted += isKorean
      ? `📄 **생성 문서**:\n`
      : `📄 **Output Documents**:\n`;
    formatted += `   • \`outputs/design/ui/ui-tokens.json\`\n`;
    formatted += `   • \`outputs/design/ui/ui-assets.json\`\n`;
    formatted += `   • \`outputs/design/ui/ui-spec.json\`\n\n`;
  }

  return formatted;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LLM Response Parser — <detect> XML tag → InferredAction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function parseInferredActionFromLLM(
  response: string,
  sourceJob: string,
): InferredAction | null {
  try {
    const detectMatch = response.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);

    let jsonStr: string;
    if (detectMatch) {
      jsonStr = detectMatch[1];
    } else {
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                        response.match(/{[\s\S]*}/);
      if (!jsonMatch) return null;
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    const intentId = parsed.intentId;
    if (!intentId || !isValidIntentId(intentId)) {
      console.error(`[parseInferredAction] Invalid or missing intentId: "${intentId}"`);
      return null;
    }

    return {
      intentId,
      domain: parsed.domain,
      reasoning: {
        intent: parsed.reasoning || parsed.jobModeReasoning || parsed.intentGroupReasoning,
        domain: parsed.domainReasoning,
      },
      sourceJob,
    };
  } catch (error) {
    console.error('[parseInferredAction] Failed to parse LLM response:', error);
    return null;
  }
}

