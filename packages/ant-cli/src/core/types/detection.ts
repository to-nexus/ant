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
  Domain,
  InferredAction,
} from '@ant/shared';

import type { Mode, IntentGroup, Domain, InferredAction, ResolvedActionContext } from '@ant/shared';
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

/**
 * Pipeline phase that produced the RAC snapshot. Drives the chat header
 * so detect-time ("analysis complete") and decompose-time ("basis finalized")
 * emissions are visually distinguishable.
 */
export type RACFormatPhase = 'detect' | 'decompose-final';

export function formatRACForChat(
  rac: ResolvedActionContext,
  reasoning?: { intent?: string; domain?: string },
  language: UserLanguage = 'ko',
  phase: RACFormatPhase = 'detect',
): string {
  const isKorean = language === 'ko';
  const isVisual = rac.intentGroup === 'visual';

  let formatted = renderHeader(phase, isVisual, isKorean);

  if (phase === 'detect') {
    formatted += renderModeSection(rac, reasoning, isKorean);
    if (isVisual) return formatted + '\n';
    formatted += renderIntentGroupSection(rac, isKorean);
    formatted += renderDomainSection(rac, reasoning, isKorean);
    formatted += renderTargetSection(rac, isKorean);
    formatted += renderDesignUiOutputSection(rac, isKorean);
  }

  formatted += renderTechTierSection(rac, isKorean);
  formatted += renderVisualTierSection(rac, isKorean);
  formatted += renderGameArtTierSection(rac, isKorean);
  formatted += renderGameContentTierSection(rac, isKorean);

  return formatted;
}

function renderHeader(phase: RACFormatPhase, isVisual: boolean, isKorean: boolean): string {
  if (phase === 'decompose-final') {
    return isKorean ? `\n✅ **기반 기술 확정**\n\n` : `\n✅ **Basis Finalized**\n\n`;
  }
  if (isVisual) {
    return isKorean ? `\n🏷️ **에셋 분류 완료**\n\n` : `\n🏷️ **Asset Classification Complete**\n\n`;
  }
  return isKorean ? `\n🔍 **분석 완료**\n\n` : `\n🔍 **Analysis Complete**\n\n`;
}

function renderModeSection(
  rac: ResolvedActionContext,
  reasoning: { intent?: string; domain?: string } | undefined,
  isKorean: boolean,
): string {
  const modeEmoji = rac.mode === 'generate' ? '✨' : rac.mode === 'refactor' ? '🔧' : '📖';
  let out = isKorean
    ? `${modeEmoji} **작업 모드**: ${rac.mode}\n`
    : `${modeEmoji} **Mode**: ${rac.mode}\n`;
  if (reasoning?.intent) out += `   └ ${reasoning.intent}\n\n`;
  return out;
}

function renderIntentGroupSection(rac: ResolvedActionContext, isKorean: boolean): string {
  const ig = rac.intentGroup;
  if (!ig || (ig !== 'design-ui' && ig !== 'design-game-art' && ig !== 'design-spec' && ig !== 'design-system')) return '';

  const igEmoji = ig === 'design-ui' ? '🎨' : ig === 'design-game-art' ? '🖌️' : ig === 'design-spec' ? '📋' : '🏗️';
  const igLabel = ig === 'design-ui'
    ? (isKorean ? 'UI 디자인' : 'UI Design')
    : ig === 'design-game-art'
      ? (isKorean ? '게임 아트 디자인' : 'Game Art Design')
      : ig === 'design-spec'
        ? (isKorean ? '기능 스펙' : 'Feature Spec')
        : (isKorean ? '시스템 디자인' : 'System Design');
  return isKorean
    ? `${igEmoji} **작업 유형**: ${igLabel}\n\n`
    : `${igEmoji} **Work Type**: ${igLabel}\n\n`;
}

function renderDomainSection(
  rac: ResolvedActionContext,
  reasoning: { intent?: string; domain?: string } | undefined,
  isKorean: boolean,
): string {
  if (!rac.domain) return '';
  const domainEmoji = rac.domain === 'game' ? '🎮' : '🔧';
  let out = isKorean
    ? `${domainEmoji} **도메인**: ${rac.domain}\n`
    : `${domainEmoji} **Domain**: ${rac.domain}\n`;
  if (reasoning?.domain) out += `   └ ${reasoning.domain}\n\n`;
  return out;
}

function renderTargetSection(rac: ResolvedActionContext, isKorean: boolean): string {
  if (rac.intentGroup !== 'design-system' || !rac.target?.length) return '';
  const filesList = rac.target.map(f => `\`${f}\``).join(', ');
  return isKorean
    ? `📄 **대상 문서**: ${filesList}\n\n`
    : `📄 **Target**: ${filesList}\n\n`;
}

function renderDesignUiOutputSection(rac: ResolvedActionContext, isKorean: boolean): string {
  if (rac.intentGroup === 'design-ui') {
    let out = isKorean ? `📄 **생성 문서**:\n` : `📄 **Output Documents**:\n`;
    out += `   • \`outputs/design/ui/ant/ui-tokens.json\`\n`;
    out += `   • \`outputs/design/ui/ant/ui-assets.json\`\n`;
    out += `   • \`outputs/design/ui/ant/ui-spec.json\`\n\n`;
    return out;
  }
  if (rac.intentGroup === 'design-game-art') {
    let out = isKorean ? `📄 **생성 문서**:\n` : `📄 **Output Documents**:\n`;
    out += `   • \`outputs/design/game-art/game-art-tokens.json\`\n`;
    out += `   • \`outputs/design/game-art/game-art-assets.json\`\n`;
    out += `   • \`outputs/design/game-art/game-art-spec.json\`\n\n`;
    return out;
  }
  return '';
}

function renderTechTierSection(rac: ResolvedActionContext, isKorean: boolean): string {
  const tt = rac.basis?.techTier;
  if (!tt || (!tt.stack && !tt.frontend && !tt.backend)) return '';

  const header = isKorean ? `🛠️ **기반 기술**\n` : `🛠️ **Tech Stack**\n`;
  const stackLabel = isKorean ? '구조' : 'Stack';
  const feLabel = isKorean ? '프론트엔드' : 'Frontend';
  const beLabel = isKorean ? '백엔드' : 'Backend';
  const noneLabel = isKorean ? '없음' : 'n/a';

  let out = header;
  if (tt.stack) out += `   • ${stackLabel}: ${tt.stack}\n`;
  if (tt.frontend) out += `   • ${feLabel}: ${renderTierTuple(tt.frontend, noneLabel)}\n`;
  if (tt.backend) out += `   • ${beLabel}: ${renderTierTuple(tt.backend, noneLabel)}\n`;
  return out + '\n';
}

function renderTierTuple(
  tier: { language?: string; framework?: string; packageManager?: string; gameEngine?: string },
  noneLabel: string,
): string {
  const lang = tier.language || noneLabel;
  const fw = tier.framework ? ` / ${tier.framework}` : '';
  const pm = tier.packageManager ? ` (${tier.packageManager})` : '';
  // Phase 1 — game-domain 5th slot. Surfaced inline for visibility.
  const engine = tier.gameEngine ? ` + ${tier.gameEngine}` : '';
  return `${lang}${fw}${pm}${engine}`;
}

/**
 * Render the gameArtTier (game-domain art policy) section of the chat RAC
 * summary. Phase 2 surfaces 2 axes (concept / perspective); Phase 4 fills
 * the remaining 5.
 */
function renderGameArtTierSection(rac: ResolvedActionContext, isKorean: boolean): string {
  const gat = rac.basis?.gameArtTier;
  if (!gat) return '';
  const entries: Array<[string, string | undefined]> = [
    [isKorean ? '컨셉' : 'Concept', gat.concept],
    [isKorean ? '시점' : 'Perspective', gat.perspective],
    [isKorean ? '엔티티' : 'Entities', gat.entityCatalog],
    [isKorean ? '모션' : 'Motion', gat.motionPattern],
    [isKorean ? '파티클' : 'Particles', gat.particleProfile],
    [isKorean ? '투사체' : 'Projectiles', gat.projectilePolicy],
    [isKorean ? '오디오' : 'Audio', gat.audioProfile],
  ];
  const present = entries.filter(([, v]) => !!v);
  if (present.length === 0) return '';

  const header = isKorean ? `🖌️ **게임 아트 기반**\n` : `🖌️ **Game Art Basis**\n`;
  return header + present.map(([k, v]) => `   • ${k}: ${v}`).join('\n') + '\n\n';
}

/**
 * Render the gameContentTier (game-domain content policy) section of the
 * chat RAC summary. Phase 1 / Phase 2 axes: genre + coreLoop.
 */
function renderGameContentTierSection(rac: ResolvedActionContext, isKorean: boolean): string {
  const gct = rac.basis?.gameContentTier;
  if (!gct) return '';
  const entries: Array<[string, string | undefined]> = [
    [isKorean ? '장르' : 'Genre', gct.genre],
    [isKorean ? '코어 루프' : 'Core Loop', gct.coreLoop],
  ];
  const present = entries.filter(([, v]) => !!v);
  if (present.length === 0) return '';

  const header = isKorean ? `🎮 **게임 콘텐츠**\n` : `🎮 **Game Content**\n`;
  return header + present.map(([k, v]) => `   • ${k}: ${v}`).join('\n') + '\n\n';
}

function renderVisualTierSection(rac: ResolvedActionContext, isKorean: boolean): string {
  const vt = rac.basis?.visualTier;
  if (!vt) return '';
  const entries: Array<[string, string | undefined]> = [
    [isKorean ? '디자인 시스템' : 'Design System', vt.designSystem],
    [isKorean ? '비주얼 언어' : 'Visual Language', vt.visualLanguage],
    [isKorean ? '표면 시스템' : 'Surface System', vt.surfaceSystem],
    [isKorean ? '공간 시스템' : 'Spatial System', vt.spatialSystem],
    [isKorean ? '인터랙션' : 'Interaction', vt.interactionGrammar],
    [isKorean ? '컴포넌트 의미' : 'Component Semantics', vt.componentSemantics],
    [isKorean ? '계층 규칙' : 'Hierarchy Rules', vt.visualHierarchyRules],
  ];
  const present = entries.filter(([, v]) => !!v);
  if (present.length === 0) return '';

  const header = isKorean ? `🎨 **비주얼 기반**\n` : `🎨 **Visual Basis**\n`;
  return header + present.map(([k, v]) => `   • ${k}: ${v}`).join('\n') + '\n\n';
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

