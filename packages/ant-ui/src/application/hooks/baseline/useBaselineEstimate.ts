/**
 * useBaselineEstimate — PR-2 fetcher.
 *
 * Calls `GET /api/jobs/baseline-estimate` with a 300ms debounce on every
 * (intent, refs, context, draftText, project, feature) change. Writes the
 * result into the kanban slice via `updateBaselinePhaseTokenUsage` — the
 * single REST-side writer for `kanban.baselinePhaseTokenUsage`. The gauge
 * (`TurnTokenRing`) reads that field as a fallback when no `live`
 * `currentPhaseTokenUsages` entry exists.
 *
 * Failure policy: on 4xx / 5xx / network, do NOTHING (don't blank the
 * existing baseline, don't fabricate one). The PR-2 endpoint returns 503
 * when Anthropic countTokens is unavailable — silently leaving the gauge
 * in its no-baseline state is more honest than a placeholder estimate.
 */

import { useEffect, useRef } from 'react';
import type { BaselineEstimate, PhaseTokenUsage } from '@ant/shared';
import { useStore } from '@/domain/store';

export interface UseBaselineEstimateInput {
  /** Currently selected intent (from action card). */
  intent?: string;
  /** Explicit ref paths from action card. */
  refs?: readonly string[];
  /** Explicit context paths from action card. */
  context?: readonly string[];
  /** Current chat-input draft text. */
  draftText?: string;
}

const DEBOUNCE_MS = 300;

function toPhaseTokenUsage(estimate: BaselineEstimate): PhaseTokenUsage {
  return {
    phase: estimate.heaviestNode.node,
    label: `${estimate.heaviestNode.job}/${estimate.heaviestNode.node}`,
    mode: 'baseline',
    contextWindow: estimate.contextWindow,
    tokenUsage: {
      inputTokens: estimate.total,
      outputTokens: 0,
      totalTokens: estimate.total,
    },
  };
}

export function useBaselineEstimate(input: UseBaselineEstimateInput = {}): void {
  const updateBaseline = useStore(s => s.updateBaselinePhaseTokenUsage);
  const selectedProject = useStore(s => s.selectedProject);
  const selectedFeature = useStore(s => s.selectedFeature);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const intent = input.intent;
  const refsKey = (input.refs ?? []).join('|');
  const contextKey = (input.context ?? []).join('|');
  const draftText = input.draftText ?? '';

  useEffect(() => {
    if (!intent || !selectedProject || !selectedFeature) return;

    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    if (inFlightRef.current) inFlightRef.current.abort();

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      inFlightRef.current = controller;

      const params = new URLSearchParams({
        intent,
        projectId: selectedProject,
        featureName: selectedFeature,
      });
      if (draftText) params.set('draftText', draftText);
      if (refsKey) params.set('refs', refsKey.replace(/\|/g, ','));
      if (contextKey) params.set('context', contextKey.replace(/\|/g, ','));

      try {
        const res = await fetch(`/api/jobs/baseline-estimate?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          // 400 `intent-unmapped` is expected for visual intents (image
          // generation has no PromptBuilder-based heaviest call) — log it
          // informatively so a missing gauge is debuggable, then leave the
          // gauge hidden (FE's existing "no baseline" surface).
          if (res.status === 400) {
            const body = await res.json().catch(() => null);
            if (body?.error === 'intent-unmapped') {
              console.info(
                `[baseline] intent "${intent}" has no PromptBuilder-based heaviest call ` +
                `(visual / image-generation intents are intentionally unmapped). Gauge hidden.`,
              );
            }
          }
          return;
        }
        const data = (await res.json()) as BaselineEstimate;
        updateBaseline(toPhaseTokenUsage(data));
      } catch {
        // Network error or aborted — leave the gauge in its current state.
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      if (inFlightRef.current) inFlightRef.current.abort();
    };
  }, [intent, refsKey, contextKey, draftText, selectedProject, selectedFeature, updateBaseline]);
}
