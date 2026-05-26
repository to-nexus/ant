/**
 * emitDetectOutcome — Single entry point for broadcasting detect/decompose-final
 * RAC summaries to the chat UI.
 *
 * Canonical Tag Rendering SSOT (see AGENTS.md):
 *   Every `<tag>` rendered to chat is owned by `SpecialTagTransformer`. Callers
 *   NEVER duplicate formatting logic. This helper packs the RAC into a canonical
 *   `<detect>{...}</detect>` payload, runs it through the transformer, and
 *   forwards the resulting text to the chat service.
 *
 *   Two phases:
 *   - 'detect'          — detect node end; initial analysis + preset basis
 *   - 'decompose-final' — decompose end; LLM-merged techTier / visualTier
 *
 * Failures are logged (warn) so a renderer issue is always visible; chat UI
 * output remains non-blocking.
 */

import type {
  ResolvedActionContext,
  InferredAction,
  ExecutionTierId,
  PathOrFolder,
} from '@ant/shared';
import { SpecialTagTransformer } from './transformers/SpecialTagTransformer';
import { getChatAPIClient } from '../adapters/ChatAPIClient';
import type { UserLanguage } from '../utils/languageDetector';

export type DetectPhase = 'detect' | 'decompose-final';

/**
 * Folder-compressed view of the RAC slot paths. Produced by
 * `compressPathsByFolder` (BE FS check) — full-folder selections collapse
 * into a single `folder` entry, partial selections stay as files. The
 * chat <detect> renderer (`formatRACForChat`) reads this when present and
 * falls back to `rac.target` string[] otherwise.
 */
export interface DetectPathsCompressed {
  target?: ReadonlyArray<PathOrFolder>;
  refs?: ReadonlyArray<PathOrFolder>;
  context?: ReadonlyArray<PathOrFolder>;
}

export interface EmitDetectOutcomeOptions {
  /** Transient reasoning (infer path only). Optional. */
  reasoning?: InferredAction['reasoning'];
  /** UI locale; falls back to 'ko' to match product default. */
  locale?: string;
  /** Which pipeline phase this emission represents (controls title). */
  phase?: DetectPhase;
  /**
   * Final executionTier chosen for this turn (decompose-final only).
   * Surfacing this to the UI helps operators see at a glance which
   * execution path the job took (Tier 0/1 direct vs Tier 2+ task
   * pipeline) — previously the tier was visible only in server logs.
   */
  executionTier?: ExecutionTierId;
  /**
   * Folder-compressed RAC slots. Detect node fills this via
   * `compressPathsByFolder`; the chat renderer prefers this over
   * `rac.target` string[] for the chat <detect> output.
   */
  pathsCompressed?: DetectPathsCompressed;
}

export async function emitDetectOutcome(
  rac: ResolvedActionContext,
  opts: EmitDetectOutcomeOptions = {},
): Promise<void> {
  const { reasoning, locale, phase = 'detect', executionTier, pathsCompressed } = opts;

  try {
    const payload = buildCanonicalDetectPayload(rac, reasoning, phase, executionTier, pathsCompressed);
    const transformer = new SpecialTagTransformer(normalizeLocale(locale));
    const raw = `<detect>${JSON.stringify(payload)}</detect>`;
    const result = transformer.transform(raw);

    if (!result.consumed || !result.text) {
      console.warn('[emitDetectOutcome] SpecialTagTransformer did not produce text for <detect> payload');
      return;
    }

    const chatAPI = getChatAPIClient();
    await chatAPI.sendLLMEvent({ type: 'text', text: result.text });
    await chatAPI.finalizeMessage();
  } catch (err) {
    console.warn('[emitDetectOutcome] failed to emit detect outcome:', err);
  }
}

/**
 * Canonical `<detect>` payload schema.
 * Consumed by `SpecialTagTransformer.transformDetect`.
 */
function buildCanonicalDetectPayload(
  rac: ResolvedActionContext,
  reasoning: InferredAction['reasoning'] | undefined,
  phase: DetectPhase,
  executionTier: ExecutionTierId | undefined,
  pathsCompressed: DetectPathsCompressed | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    phase,
    intentId: rac.intent,
    mode: rac.mode,
    intentGroup: rac.intentGroup,
    source: rac.source,
  };

  if (rac.domain) payload.domain = rac.domain;
  if (rac.target?.length) payload.target = rac.target;
  if (rac.refs?.length) payload.refs = rac.refs;
  if (rac.context?.length) payload.context = rac.context;
  if (rac.basis?.techTier) payload.techTier = rac.basis.techTier;
  if (rac.basis?.visualTier) payload.visualTier = rac.basis.visualTier;
  // Phase 2 (D12-revised) — surface gameArtTier and gameContentTier so the
  // chat summary emits matrix-active tier values (not just techTier+visualTier).
  if (rac.basis?.gameArtTier && Object.values(rac.basis.gameArtTier).some(Boolean)) {
    payload.gameArtTier = rac.basis.gameArtTier;
  }
  if (rac.basis?.gameContentTier && Object.values(rac.basis.gameContentTier).some(Boolean)) {
    payload.gameContentTier = rac.basis.gameContentTier;
  }
  if (executionTier !== undefined) payload.executionTier = executionTier;

  if (reasoning && (reasoning.intent || reasoning.domain)) {
    payload.reasoning = {
      ...(reasoning.intent ? { intent: reasoning.intent } : {}),
      ...(reasoning.domain ? { domain: reasoning.domain } : {}),
    };
  }

  if (pathsCompressed) {
    const trimmed: DetectPathsCompressed = {};
    if (pathsCompressed.target?.length) trimmed.target = pathsCompressed.target;
    if (pathsCompressed.refs?.length) trimmed.refs = pathsCompressed.refs;
    if (pathsCompressed.context?.length) trimmed.context = pathsCompressed.context;
    if (trimmed.target || trimmed.refs || trimmed.context) {
      payload.pathsCompressed = trimmed;
    }
  }

  return payload;
}

function normalizeLocale(locale: string | undefined): UserLanguage {
  if (locale === 'ko' || locale === 'en' || locale === 'ja' || locale === 'zh') return locale;
  return 'ko';
}
