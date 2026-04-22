/**
 * detectFigmaSource
 *
 * Single entry point for detecting the figma workfile reference + MCP
 * availability from a feature workspace. Replaces the two near-identical
 * blocks that previously lived inside the resolve node's `onResume` and
 * `loadArtifacts` branches, which had drifted on:
 *   - which path to read (`inputs/figma.json` vs new canonical location)
 *   - whether to run `migrateFigmaConfig` (only triage/design/HTTP did)
 *   - how to reset state fields on failure
 *
 * Output shape is a flat metadata object; the caller projects it onto
 * state (figmaFileKey / figmaStartNodeId) and onto the RAC
 * (`mcpSources.figma`) as needed.
 */

import * as path from 'path';
import type { FileSystemPort } from '../../../../../../core/ports/filesystem';
import {
  FIGMA_CONFIG_PATH,
  isFigmaDataPopulated,
  migrateFigmaConfig,
  extractFigmaUrlParts,
} from '@ant/shared';

export interface FigmaSourceDetectionResult {
  /** True when figma.json is populated AND the MCP endpoint responded available AND a fileKey was parsed. */
  available: boolean;
  /** Normalised workfile URL from migrated figma.json (never stored in cache on disk). */
  fileUrl?: string;
  fileKey?: string;
  startNodeId?: string;
}

export interface DetectFigmaSourceDeps {
  fileSystem?: FileSystemPort;
  /** Optional redis instance for cloud MCP reachability check. */
  redis?: unknown;
  /** User id used for cloud MCP session lookup. */
  userId?: string;
}

/**
 * Read and interpret the figma workfile reference at the canonical location
 * (`outputs/design/ui/figma/figma.json`). All branches are tolerant —
 * missing file / malformed JSON / offline MCP / missing fileKey all return
 * `{ available: false }` rather than throwing; figma is always optional.
 */
export async function detectFigmaSource(
  featurePath: string | undefined,
  deps: DetectFigmaSourceDeps,
): Promise<FigmaSourceDetectionResult> {
  if (!featurePath) return { available: false };

  try {
    const figmaJsonPath = path.join(featurePath, FIGMA_CONFIG_PATH);
    const figmaRaw = await deps.fileSystem?.readFile?.(figmaJsonPath);
    if (!figmaRaw) return { available: false };

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(figmaRaw);
    } catch {
      return { available: false };
    }
    const figmaConfig = migrateFigmaConfig(parsedRaw);
    if (!isFigmaDataPopulated(figmaConfig) || !figmaConfig.file) {
      return { available: false };
    }

    const parts = extractFigmaUrlParts(figmaConfig.file);
    if (!parts.fileKey) return { available: false };

    const serverMode = process.env.ANT_SERVER_MODE || 'local';
    let mcpUp = false;
    if (serverMode === 'local') {
      const { checkLocalMCPAvailability } = await import(
        '../../../../../../periphery/adapters/figma/MCPTransport'
      );
      mcpUp = await checkLocalMCPAvailability();
    } else {
      const { createMCPTransport } = await import(
        '../../../../../../periphery/adapters/figma/MCPTransport'
      );
      const transport = createMCPTransport({
        serverMode: 'cloud',
        userId: deps.userId,
        redis: deps.redis as any,
      });
      mcpUp = await transport.isAvailable();
    }

    if (!mcpUp) return { available: false, fileUrl: figmaConfig.file, fileKey: parts.fileKey, startNodeId: parts.nodeId };

    return {
      available: true,
      fileUrl: figmaConfig.file,
      fileKey: parts.fileKey,
      startNodeId: parts.nodeId,
    };
  } catch {
    return { available: false };
  }
}
