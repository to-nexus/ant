/**
 * Detect Node — Common Factory
 *
 * Unified detect node replacing per-job detectEnvironment/classify.
 * Uses Strategy pattern: job-specific LLM logic is injected, common
 * infrastructure (explicit bypass, resume, RAC creation) is handled here.
 *
 * Invariant: after detect completes normally, state.detectionReport
 * and state.resolvedAction are ALWAYS populated.
 *
 * Pattern: Factory (not generic function like triage) because job-specific
 * LLM calling/parsing accounts for 30-40% of detect logic.
 */

import type { DetectableState, DetectStrategy } from './types.js';
import type { DetectionReport, IntentId } from '@ant/shared';
import {
  deriveFromIntent,
  resolveFromExplicit,
  resolveFromInfer,
  isValidIntentId,
} from '@ant/shared';
import { mergeDocumentsIntoRAC } from '../../graph/loadDocumentsForRAC.js';
import { normalizeDetectionReport, formatDetectionReportForChat } from '../../../../core/types/detection.js';
import { getEstimatingLabel, type UILocale } from '../../graph/timing/estimatingLabels.js';
import { extractLLMInfo } from '../../../../core/ports/workflow.js';

export { type DetectableState, type DetectStrategy, type DetectResult } from './types.js';

/**
 * Create a detect node bound to a job-specific strategy.
 * The returned function is added directly to the LangGraph as a node.
 *
 * ```ts
 * graph.addNode('detect', createDetectNode(codeDetectStrategy));
 * ```
 */
export function createDetectNode<T extends DetectableState>(
  strategy: DetectStrategy<T>,
): (state: T) => Promise<Partial<T>> {
  return async (state: T): Promise<Partial<T>> => {
    const phaseStart = Date.now();

    // Activity banner
    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity(
        getEstimatingLabel('detect', state._uiLocale as UILocale | undefined),
        'detect',
      );
    }

    state.recursionCount = (state.recursionCount || 0) + 1;

    // Workflow instrumentation: enter
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.enterNode(
        state._httpJobId,
        'detect',
        0,
        undefined,
        state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
        state.recursionCount,
        state.recursionLimit,
      );
    }

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 1: Explicit path (actionMetadata.intent present)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (state.actionMetadata?.intent) {
        return buildExplicitDetection(state, strategy, phaseStart);
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 2: Resume fast path (detectionReport already exists)
      // Skip when strategy signals it needs user input (e.g., Design clarify)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (state.detectionReport && !strategy.isAwaitingInput?.(state)) {
        return buildResumeDetection(state, strategy, phaseStart);
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 3: Strategy-driven LLM detection
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const result = await strategy.run(state);

      // Early return: clarify, error, or any case where RAC shouldn't be built
      if (result.skipRACCreation || !result.detectionReport) {
        return {
          ...result.stateUpdates,
          tokenUsage: state.tokenUsage,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
        } as unknown as Partial<T>;
      }

      const detectionReport = result.detectionReport;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 4: Intent resolution (validate + fallback)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let intentId: IntentId;
      if (detectionReport.intentId && isValidIntentId(detectionReport.intentId)) {
        intentId = detectionReport.intentId;
        console.log(`📋 [detect] Using LLM intentId: ${intentId}`);
      } else {
        intentId = strategy.synthesizeFallback(detectionReport, state);
        if (detectionReport.intentId) {
          console.log(`⚠️  [detect] Invalid LLM intentId "${detectionReport.intentId}" → fallback: ${intentId}`);
        }
        detectionReport.intentId = intentId;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 5: RAC creation (sole creation point)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const profile = strategy.getCodebaseProfile?.(state);
      const hints = strategy.getExplicitHints?.(state);
      let resolvedAction = resolveFromInfer(
        detectionReport,
        state.actionMetadata,
        profile,
        hints,
        intentId,
      );

      const featurePath = resolveFeaturePath(state);
      if (featurePath) {
        resolvedAction = mergeDocumentsIntoRAC(resolvedAction, featurePath);
      }

      console.log(`📋 [detect] RAC created (infer): intent=${intentId}, mode=${resolvedAction.mode}`);

      return {
        detectionReport,
        resolvedAction,
        ...result.stateUpdates,
        tokenUsage: state.tokenUsage,
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
      } as unknown as Partial<T>;
    } finally {
      // Workflow instrumentation: exit
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'detect', 0);
      }
    }
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildExplicitDetection<T extends DetectableState>(
  state: T,
  strategy: DetectStrategy<T>,
  phaseStart: number,
): Partial<T> {
  const intent = state.actionMetadata!.intent!;
  const derived = deriveFromIntent(intent);

  const detectionReport: DetectionReport = {
    detectedMode: derived.mode,
    detectedModeReasoning: `Determined by explicit intent: ${intent}`,
    sourceJob: state.currentJob || 'unknown',
    intentId: intent,
    detectedIntentGroup: derived.intentGroup,
    environment: derived.environment as any,
    detectedAt: new Date().toISOString(),
  };

  const profile = strategy.getCodebaseProfile?.(state);
  const hints = strategy.getExplicitHints?.(state);
  let resolvedAction = resolveFromExplicit(state.actionMetadata!, profile, hints);

  const featurePath = resolveFeaturePath(state);
  if (featurePath) {
    resolvedAction = mergeDocumentsIntoRAC(resolvedAction, featurePath);
  }

  console.log(`⚡ [detect] Explicit bypass: intent=${intent}, mode=${derived.mode}`);

  // Display in Chat UI
  displayReportInChat(detectionReport, state._uiLocale).catch(() => {});

  return {
    detectionReport,
    resolvedAction,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
  } as unknown as Partial<T>;
}

function buildResumeDetection<T extends DetectableState>(
  state: T,
  strategy: DetectStrategy<T>,
  phaseStart: number,
): Partial<T> {
  const report = normalizeDetectionReport(state.detectionReport!);

  console.log(`🔍 [detect] Resume — using existing detectionReport (LLM skip)`);
  console.log(`   mode=${report.detectedMode}`);

  let resolvedAction = state.resolvedAction;
  if (!resolvedAction) {
    const profile = strategy.getCodebaseProfile?.(state);
    const hints = strategy.getExplicitHints?.(state);
    const intentId = resolveIntentFromReport(report, strategy, state);
    resolvedAction = resolveFromInfer(report, state.actionMetadata, profile, hints, intentId);

    const featurePath = resolveFeaturePath(state);
    if (featurePath) {
      resolvedAction = mergeDocumentsIntoRAC(resolvedAction, featurePath);
    }
  }

  const strategyResumeUpdates = strategy.onResume?.(state) || {};

  return {
    detectionReport: report,
    resolvedAction,
    ...strategyResumeUpdates,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
  } as unknown as Partial<T>;
}

function resolveIntentFromReport<T extends DetectableState>(
  report: DetectionReport,
  strategy: DetectStrategy<T>,
  state: T,
): IntentId {
  if (report.intentId && isValidIntentId(report.intentId)) {
    return report.intentId;
  }
  return strategy.synthesizeFallback(report, state);
}

function resolveFeaturePath<T extends DetectableState>(state: T): string | undefined {
  return state.featurePath || (state as any).context?.featurePath;
}

async function displayReportInChat(
  report: DetectionReport,
  locale?: string,
): Promise<void> {
  try {
    const { getChatAPIClient } = await import('../../../../core/adapters/ChatAPIClient.js');
    const chatAPI = getChatAPIClient();
    const formatted = formatDetectionReportForChat(report, (locale as any) || 'ko');
    await chatAPI.sendLLMEvent({ type: 'text', text: formatted });
    await chatAPI.finalizeMessage();
  } catch {
    // Chat UI display is non-critical
  }
}
