/**
 * detectFigmaSource
 *
 * Single entry point for detecting the figma workfile reference + MCP
 * availability from a feature workspace. The workfile reference lives on the
 * workspace's own design surface (`figmaConfigPathFor` — `visual/ui/figma/` for
 * service, `visual/game-art/figma/` for game), and `migrateFigmaConfig` runs
 * unconditionally so resume / loadArtifacts branches cannot drift on schema.
 *
 * Output shape is a flat metadata object; the caller projects it onto
 * state (figmaFileKey / figmaStartNodeId) and onto the RAC
 * (`mcpSources.figma`) as needed.
 */

import * as path from 'path';
import type { FileSystemPort } from '../../../../../../core/ports/filesystem';
import {
  type Domain,
  type FigmaDataConfig,
  FIGMA_CONFIG_PATHS,
  figmaConfigPathFor,
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
  /**
   * Workspace domain — decides which design surface holds figma.json. When
   * omitted, both surfaces are probed (they are mutually exclusive per
   * workspace, so at most one is ever populated).
   */
  domain?: Domain;
}

/** Surface locations to probe, domain-preferred first. */
function candidatePaths(domain: Domain | undefined): string[] {
  const preferred = figmaConfigPathFor(domain);
  return [preferred, ...FIGMA_CONFIG_PATHS.filter(p => p !== preferred)];
}

/**
 * Read and interpret the figma workfile reference from the workspace's design
 * surface (`figmaConfigPathFor`). All branches are tolerant — missing file /
 * malformed JSON / offline MCP / missing fileKey all return
 * `{ available: false }` rather than throwing; figma is always optional.
 */
export async function detectFigmaSource(
  featurePath: string | undefined,
  deps: DetectFigmaSourceDeps,
): Promise<FigmaSourceDetectionResult> {
  if (!featurePath) return { available: false };

  try {
    let figmaConfig: FigmaDataConfig | undefined;
    for (const rel of candidatePaths(deps.domain)) {
      const figmaRaw = await deps.fileSystem?.readFile?.(path.join(featurePath, rel));
      if (!figmaRaw) continue;
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(figmaRaw);
      } catch {
        continue;
      }
      const migrated = migrateFigmaConfig(parsedRaw);
      if (isFigmaDataPopulated(migrated) && migrated.file) {
        figmaConfig = migrated;
        break;
      }
    }
    if (!figmaConfig?.file) return { available: false };

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
