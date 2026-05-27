/**
 * Design detect augment — Figma MCP reachability + URL parsing.
 *
 * Phase C SSOT split — the job-blind `inferRacWithTools` produces RAC slots
 * + progressibility status; design jobs additionally need to:
 *
 *   1. For `design-ui` figma-mode intents (`gen-ui-figma`, `rev-ui` with
 *      figma populated): verify MCP reachability and short-circuit the
 *      pipeline with a `designError` when the Figma Desktop bridge is down.
 *   2. For `design-spec` figma-augmented intents: best-effort fill
 *      `figmaAvailable` / `figmaFileKey` / `figmaStartNodeId` so the worker
 *      subgraph can opt-in to Figma-driven flows when available, fall back
 *      to text-only when not.
 *
 * Both branches preserve the exact decision tree from the legacy
 * `designDetectStrategy.checkFigmaMCPReachable` / `checkSpecFigma`.
 */

import type { DetectAugment, DetectResult } from '../../../../../common/graph/nodes/detect/types.js';
import type { DesignGraphState } from '../../state.js';
import { isFigmaDataPopulated } from '@ant/shared';

export const augmentDesignFigma: DetectAugment<DesignGraphState> = async ({
  intentId,
  detectResult,
  state,
}) => {
  // Skip when detect itself decided we cannot proceed — Figma reachability
  // is only meaningful on the proceed path.
  if (detectResult.status !== 'proceed') return {};

  const figmaPopulated = isFigmaDataPopulated(state.figmaConfig);

  // ── design-ui figma-mode branch ──
  if ((intentId === 'gen-ui-figma' || intentId === 'rev-ui') && figmaPopulated) {
    const figmaError = await checkFigmaMCPReachable(state);
    if (figmaError) {
      // Surface the failure via the legacy `stateUpdates.designError` channel
      // so the existing chat-error rendering keeps working unchanged.
      return {
        skipRACCreation: true,
        status: 'blocked',
        displayMessage: figmaError.message,
        stateUpdates: {
          designError: figmaError,
          tokenUsage: state.tokenUsage,
        } as Partial<DesignGraphState>,
      } satisfies Partial<DetectResult<DesignGraphState>>;
    }
    return {};
  }

  // ── design-spec figma-augmented branch ──
  if (intentId === 'rev-spec' || intentId === 'gen-spec' || intentId === 'explain-spec') {
    if (!figmaPopulated) return {};
    const specFigma = await checkSpecFigma(state);
    if (!specFigma) return {};
    return {
      stateUpdates: {
        figmaAvailable: specFigma.available,
        figmaFileKey: specFigma.fileKey,
        figmaStartNodeId: specFigma.startNodeId,
      } as Partial<DesignGraphState>,
    };
  }

  return {};
};

async function checkFigmaMCPReachable(
  state: DesignGraphState,
): Promise<DesignGraphState['designError'] | undefined> {
  const { checkLocalMCPAvailability } = await import(
    '../../../../../../periphery/adapters/figma/MCPTransport.js'
  );
  const serverMode = process.env.ANT_SERVER_MODE || 'local';
  if (serverMode === 'local') {
    const ok = await checkLocalMCPAvailability();
    if (!ok) {
      return {
        type: 'figma_mcp_unavailable',
        message: 'Figma Desktop이 실행되지 않았습니다.',
      };
    }
    return undefined;
  }
  const userId = state.context?.userId;
  const redis = state.deps?.redis;
  if (!userId || !redis) {
    return {
      type: 'figma_bridge_unavailable',
      message: !userId ? 'Context missing.' : 'Redis unavailable.',
    };
  }
  try {
    const { createMCPTransport } = await import(
      '../../../../../../periphery/adapters/figma/MCPTransport.js'
    );
    const transport = createMCPTransport({ serverMode: 'cloud', userId, redis });
    if (!(await transport.isAvailable())) {
      return {
        type: 'figma_bridge_unavailable',
        message:
          'Ant Desktop 앱이 연결되지 않았거나 Figma Desktop이 응답하지 않습니다.',
      };
    }
  } catch {
    return { type: 'figma_bridge_unavailable', message: 'Ant Desktop 확인 실패.' };
  }
  return undefined;
}

async function checkSpecFigma(
  state: DesignGraphState,
): Promise<{ available: boolean; fileKey?: string; startNodeId?: string } | undefined> {
  const { checkLocalMCPAvailability } = await import(
    '../../../../../../periphery/adapters/figma/MCPTransport.js'
  );
  const serverMode = process.env.ANT_SERVER_MODE || 'local';
  let mcpReachable = false;
  try {
    if (serverMode === 'local') {
      mcpReachable = await checkLocalMCPAvailability();
    } else {
      const userId = state.context?.userId;
      const redis = state.deps?.redis;
      if (userId && redis) {
        const { createMCPTransport } = await import(
          '../../../../../../periphery/adapters/figma/MCPTransport.js'
        );
        const transport = createMCPTransport({ serverMode: 'cloud', userId, redis });
        mcpReachable = await transport.isAvailable();
      }
    }
  } catch {
    /* non-critical */
  }

  if (mcpReachable && state.figmaConfig?.file) {
    const { extractFigmaUrlParts } = await import('@ant/shared');
    const parts = extractFigmaUrlParts(state.figmaConfig.file);
    if (parts.fileKey) {
      return { available: true, fileKey: parts.fileKey, startNodeId: parts.nodeId };
    }
  }
  return undefined;
}
