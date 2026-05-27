/**
 * outputTagTransforms — pure chat-render hooks for every
 * `consumed-formatted` tag in the OutputTagRegistry.
 *
 * Hooks are stateless module-level functions so the registry stays a
 * pure data declaration and SpecialTagTransformer reduces to a walker.
 * Side-effect tracking (e.g. the `<done>true</done>` explicit-done flag)
 * lives in `SpecialTagTransformer` as a post-walk derivation, not in
 * any transform body.
 *
 * Locale labels for tag-specific content live in sibling SSOT modules
 * (`languageDetector.getCompletionMessage`, `executionTier/labels`)
 * and are imported here — never hard-coded.
 *
 * SSOT context: docs/architecture/36-output-tag-matrix.md.
 */

import type { Basis, ResolvedActionContext } from '@ant/shared';
import { coerceExecutionTier } from '../executionTier';
import { EXECUTION_TIER_LABELS } from '../executionTier/labels';
import { getCompletionMessage, type UserLanguage } from '../utils/languageDetector';
import { formatRACForChat, type RACFormatPhase, type DetectPathsCompressedView } from '../types/detection';
import type { PathOrFolder } from '@ant/shared';
import type { TransformContext, TransformResult } from './OutputTagRegistry';

// ────────────────────────────────────────────────────────────────────────────
// <done>
// ────────────────────────────────────────────────────────────────────────────

/**
 * `<done>true|false</done>` — completion notice.
 * `true` renders the locale-aware completion message and consumes;
 * `false` consumes silently (the LLM is signalling "still working").
 */
export function transformDone(
  match: RegExpMatchArray,
  ctx: TransformContext,
): TransformResult {
  const isDone = match[1].toLowerCase() === 'true';
  if (isDone) {
    return { text: getCompletionMessage(ctx.language), consumed: true };
  }
  return { consumed: true };
}

// ────────────────────────────────────────────────────────────────────────────
// <reply>
// ────────────────────────────────────────────────────────────────────────────

/**
 * `<reply>...</reply>` — narrative axis, body verbatim.
 * Empty body consumes silently (no chat-line written).
 */
export function transformReply(match: RegExpMatchArray): TransformResult {
  const body = (match[1] ?? '').trim();
  if (!body) return { consumed: true };
  return { text: body, consumed: true };
}

// ────────────────────────────────────────────────────────────────────────────
// <learn_command>
// ────────────────────────────────────────────────────────────────────────────

export function transformLearnCommand(
  match: RegExpMatchArray,
  ctx: TransformContext,
): TransformResult {
  try {
    const command = JSON.parse(match[1]);
    return { text: formatLearnCommand(command, ctx.language), consumed: true };
  } catch {
    const isKorean = ctx.language === 'ko';
    return {
      text: isKorean
        ? `**학습 명령 분석 완료**\n\`\`\`json\n${match[1]}\n\`\`\``
        : `**Learning Command Analyzed**\n\`\`\`json\n${match[1]}\n\`\`\``,
      consumed: true,
    };
  }
}

function formatLearnCommand(command: any, language: UserLanguage): string {
  const { action, branch, mode, files, text } = command;
  const isKorean = language === 'ko';

  let formatted = isKorean
    ? '**📚 학습 명령 분석 완료**\n\n'
    : '**📚 Learning Command Analyzed**\n\n';

  switch (action) {
    case 'index_branch':
      formatted += isKorean
        ? `• **작업**: 브랜치 인덱싱\n\n• **브랜치**: \`${branch || 'current'}\`\n\n• **모드**: ${mode === 'full' ? '전체' : '스마트'}\n\n`
        : `• **Action**: Index Branch\n\n• **Branch**: \`${branch || 'current'}\`\n\n• **Mode**: ${mode === 'full' ? 'Full' : 'Smart'}\n\n`;
      break;

    case 'index_codebase':
      formatted += isKorean
        ? `• **작업**: 코드베이스 인덱싱\n\n• **모드**: ${mode === 'full' ? '전체' : '스마트'}\n\n`
        : `• **Action**: Index Codebase\n\n• **Mode**: ${mode === 'full' ? 'Full' : 'Smart'}\n\n`;
      break;

    case 'learn_files': {
      const fileCount = files ? files.length : 0;
      formatted += isKorean
        ? `• **작업**: 파일 학습\n\n• **파일 수**: ${fileCount}개\n\n`
        : `• **Action**: Learn Files\n\n• **File Count**: ${fileCount}\n\n`;

      if (files && files.length > 0) {
        formatted += isKorean ? '• **파일 목록**:\n\n' : '• **Files**:\n\n';
        files.slice(0, 5).forEach((file: string) => {
          formatted += `  - \`${file}\`\n`;
        });
        if (files.length > 5) {
          formatted += isKorean
            ? `  - ... 외 ${files.length - 5}개\n`
            : `  - ... and ${files.length - 5} more\n`;
        }
        formatted += '\n';
      }
      break;
    }

    case 'learn_text': {
      const preview = text
        ? text.length > 100
          ? text.substring(0, 100) + '...'
          : text
        : '';
      formatted += isKorean
        ? `• **작업**: 텍스트 학습\n\n• **내용**: ${preview || '(제공됨)'}\n\n`
        : `• **Action**: Learn Text\n\n• **Content**: ${preview || '(provided)'}\n\n`;
      break;
    }

    default:
      formatted += isKorean
        ? `• **작업**: ${action}\n\n• **세부사항**:\n\n\`\`\`json\n${JSON.stringify(command, null, 2)}\n\`\`\`\n\n`
        : `• **Action**: ${action}\n\n• **Details**:\n\n\`\`\`json\n${JSON.stringify(command, null, 2)}\n\`\`\`\n\n`;
  }

  return formatted;
}

// ────────────────────────────────────────────────────────────────────────────
// <references>
// ────────────────────────────────────────────────────────────────────────────

export function transformReferences(
  match: RegExpMatchArray,
  ctx: TransformContext,
): TransformResult {
  try {
    const referencesText = match[1].trim();
    if (referencesText === '[]') return { consumed: true };
    const references = JSON.parse(referencesText);
    if (!Array.isArray(references) || references.length === 0) {
      return { consumed: true };
    }
    return { text: formatReferences(references, ctx.language), consumed: true };
  } catch {
    return { consumed: true };
  }
}

function formatReferences(references: any[], language: UserLanguage): string {
  const isKorean = language === 'ko';

  let formatted = isKorean
    ? `**📚 참고 레포지토리 등록**\n\n`
    : `**📚 Reference Repositories Registered**\n\n`;

  formatted += isKorean
    ? `다음 레포지토리의 코드를 참고하여 작업합니다:\n\n`
    : `Will reference code from the following repositories:\n\n`;

  references.forEach((ref) => {
    const project = ref.project || '(unknown)';
    const branch = ref.branch;
    if (branch) {
      formatted += `• **${project}** → \`${branch}\` 브랜치\n`;
    } else {
      formatted += `• **${project}** → 기본 브랜치\n`;
    }
  });

  formatted += '\n';
  formatted += isKorean
    ? `💡 필요시 \`search_reference_code\` 도구로 해당 레포의 코드를 검색합니다.`
    : `💡 Will use \`search_reference_code\` tool to search code from these repositories.`;

  return formatted;
}

// ────────────────────────────────────────────────────────────────────────────
// <detect>
// ────────────────────────────────────────────────────────────────────────────

/**
 * `<detect>` — canonical RAC payload rendered for chat. Accepts the
 * schema defined by `emitDetectOutcome` (phase + full RAC including
 * `basis`) as well as legacy LLM-streamed payloads that only carry
 * partial fields. Missing fields are rendered as omitted sections by
 * `formatRACForChat`.
 */
/**
 * Defensive parser for `payload.pathsCompressed` — the chat <detect>
 * payload is JSON-from-LLM-or-BE so every field is `unknown` until proven
 * shape-valid. Drops unknown variants silently; missing slots default to
 * undefined so `formatRACForChat` can fall back to `rac.target/refs/context`.
 */
function normalizePathsCompressed(
  raw: unknown,
): DetectPathsCompressedView | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: DetectPathsCompressedView = {};
  for (const role of ['target', 'refs', 'context'] as const) {
    const slot = obj[role];
    if (!Array.isArray(slot)) continue;
    const entries: PathOrFolder[] = [];
    for (const entry of slot) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.path !== 'string') continue;
      if (e.kind === 'folder' && typeof e.fileCount === 'number') {
        entries.push({ kind: 'folder', path: e.path, fileCount: e.fileCount });
      } else if (e.kind === 'file' || e.kind === undefined) {
        entries.push({ kind: 'file', path: e.path });
      }
    }
    if (entries.length) out[role] = entries;
  }
  if (!out.target && !out.refs && !out.context) return undefined;
  return out;
}

export function transformDetect(
  match: RegExpMatchArray,
  ctx: TransformContext,
): TransformResult {
  try {
    const detectJson = match[1].trim();
    const parsed = JSON.parse(detectJson);

    const isDesignJob = 'intentGroup' in parsed || 'workType' in parsed;
    const intentGroup = isDesignJob
      ? parsed.intentGroup ?? parsed.workType
      : undefined;

    const mode =
      parsed.mode ||
      parsed.detectedMode ||
      parsed.jobMode ||
      parsed.designMode ||
      'generate';

    const flatGameArtTier = parsed.gameArtTier;
    const flatBasisHasAny = !!(
      parsed.techTier ||
      parsed.visualTier ||
      flatGameArtTier ||
      parsed.gameContentTier
    );
    const basis: Basis | undefined = flatBasisHasAny
      ? {
          techTier: parsed.techTier,
          visualTier: parsed.visualTier,
          gameArtTier: flatGameArtTier,
          gameContentTier: parsed.gameContentTier,
        }
      : undefined;

    const source: ResolvedActionContext['source'] =
      parsed.source === 'explicit' ? 'explicit' : 'infer';

    const rac: ResolvedActionContext = {
      mode,
      intentGroup: intentGroup && intentGroup !== 'error' ? intentGroup : undefined,
      intent: parsed.intentId,
      domain: parsed.domain,
      target: Array.isArray(parsed.target) ? parsed.target : undefined,
      refs: Array.isArray(parsed.refs) ? parsed.refs : undefined,
      context: Array.isArray(parsed.context) ? parsed.context : undefined,
      basis,
      source,
      hasExplicitFields: source === 'explicit',
    };

    const reasoning: { intent?: string; domain?: string } | undefined =
      parsed.reasoning ||
      parsed.detectedModeReasoning ||
      parsed.jobModeReasoning ||
      parsed.modeReasoning ||
      parsed.designModeReasoning ||
      parsed.domainReasoning
        ? {
            intent:
              parsed.reasoning?.intent ??
              parsed.detectedModeReasoning ??
              parsed.jobModeReasoning ??
              parsed.modeReasoning ??
              parsed.designModeReasoning ??
              undefined,
            domain:
              parsed.reasoning?.domain ?? parsed.domainReasoning ?? undefined,
          }
        : undefined;

    const phase: RACFormatPhase =
      parsed.phase === 'decompose-final' ? 'decompose-final' : 'detect';
    const pathsCompressed = normalizePathsCompressed(parsed.pathsCompressed);
    const formatted = formatRACForChat(rac, reasoning, ctx.language, phase, pathsCompressed);

    const tierLine = buildExecutionTierLine(parsed.executionTier, ctx.language);

    return { text: formatted + tierLine, consumed: true };
  } catch {
    const isKorean = ctx.language === 'ko';
    return {
      text: isKorean
        ? '⚠️ 환경 분석 결과 파싱 실패'
        : '⚠️ Failed to parse environment analysis',
      consumed: true,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// <executionTier>
// ────────────────────────────────────────────────────────────────────────────

export function transformExecutionTier(
  match: RegExpMatchArray,
  ctx: TransformContext,
): TransformResult {
  const body = (match[1] || '').trim();
  const n = Number(body);
  const tierId =
    Number.isInteger(n) && n >= 0 && n <= 4
      ? (n as 0 | 1 | 2 | 3 | 4)
      : coerceExecutionTier(undefined, 'OutputTagRegistry.executionTier');
  return {
    text: renderExecutionTier(tierId, ctx.language),
    consumed: true,
  };
}

/**
 * Append an execution-tier line to the `<detect>` payload when present
 * (decompose-final phase carries the final tier classification).
 */
function buildExecutionTierLine(raw: unknown, language: UserLanguage): string {
  if (raw === undefined || raw === null) return '';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 4) return '';
  return renderExecutionTier(n as 0 | 1 | 2 | 3 | 4, language);
}

function renderExecutionTier(
  tierId: 0 | 1 | 2 | 3 | 4,
  language: UserLanguage,
): string {
  const label = EXECUTION_TIER_LABELS[tierId];
  const isKorean = language === 'ko';
  const header = isKorean
    ? `\n🎯 **실행 전략**: Tier ${tierId} · ${label.short[language] || label.short.en}\n`
    : `\n🎯 **Execution Strategy**: Tier ${tierId} · ${label.short[language] || label.short.en}\n`;
  const desc = label.description[language] || label.description.en;
  return `${header}   └ ${desc}\n\n`;
}
