import * as fs from 'fs';
import * as path from 'path';
import {
  ConnectionResolution,
  ServiceCategory,
  ServiceConnection,
  VirtualizationStrategy,
} from '../../../../../../../core/ports/portRegistry';
import { logger } from '../../../../../../../utils/logger';
import { formatDisplayName, overrideWithEnvFile, parseEnvLine } from './utils';
import { parseMockModifier, parseResolutionModifier } from './parseModifiers';

const ANNOTATION_REGEX = /^#\s*@connection\s+(business|infrastructure)\s+(\S+)(?:\s+(.+))?/;

/**
 * Parse `@connection` annotations from `<projectPath>[/<subdir>]/.env.example`.
 *
 * Annotation grammar (after the `# @connection {category} {name}` header):
 *   - any number of optional whitespace-separated tokens, dispatched per-token
 *     to (a) `parseResolutionModifier` (claims at most one) and
 *        (b) `parseMockModifier`        (claims at most one).
 *   - tokens neither layer claims are silently ignored at the dispatch level
 *     (`parseMockModifier` already warn-logs unknown `mock:*` tokens).
 *
 * Each annotation MUST be immediately followed by a `KEY=VALUE` line — that
 * line names the env var the platform injects. Annotations whose next env
 * line is missing are skipped (matches legacy behavior).
 */
export function detectFromAnnotations(projectPath: string, subdir?: string): ServiceConnection[] {
  const connections: ServiceConnection[] = [];
  const envExamplePath = subdir
    ? path.join(projectPath, subdir, '.env.example')
    : path.join(projectPath, '.env.example');

  if (!fs.existsSync(envExamplePath)) {
    return connections;
  }

  const content = fs.readFileSync(envExamplePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(ANNOTATION_REGEX);
    if (!match) continue;

    const category = match[1] as ServiceCategory;
    const name = match[2];
    const modifier = match[3]?.trim();

    const nextLine = findNextEnvLine(lines, i + 1);
    if (!nextLine) continue;

    const [envVar, value] = parseEnvLine(nextLine);
    if (!envVar) continue;

    const { resolution, virtualization } = dispatchModifierTokens(modifier, name, value || '');

    // Local infrastructure (DB / cache / queue via docker-compose) is real
    // and is NOT a virtualization target. Mirror the boundary documented in
    // design's Infrastructure Independence Guardrail by warn-dropping any
    // mock token attached to an `infrastructure` connection.
    let effectiveVirtualization = virtualization;
    if (effectiveVirtualization && category === 'infrastructure') {
      logger.warn(
        `[ConnectionDetector] Ignoring mock modifier on infrastructure connection "${name}" ` +
        `(${envVar}). Local infrastructure is provisioned via docker-compose, not virtualized.`,
        { component: 'ConnectionDetector' },
      );
      effectiveVirtualization = undefined;
    }

    connections.push({
      id: name,
      name: formatDisplayName(name),
      category,
      envVar,
      value: value || '',
      resolution,
      source: subdir || '*',
      configSource: 'env',
      ...(effectiveVirtualization ? { virtualization: effectiveVirtualization } : {}),
    });
  }

  overrideWithEnvFile(connections, projectPath, subdir);

  return connections;
}

/**
 * Multi-token modifier dispatch shared by .env and TOML annotation parsers.
 * Each token is offered to the resolution layer and the virtualization
 * layer; first claim wins. Resolution falls back to `url` when no token
 * claims it (matches legacy `parseResolutionModifier` undefined behavior).
 *
 * Exported so `parseTomlAnnotations.ts` reuses the same dispatch loop —
 * keeping the multi-token contract symmetric across both annotation
 * formats and avoiding drift if the grammar gains a new layer later.
 */
export function dispatchModifierTokens(
  modifier: string | undefined,
  name: string,
  defaultValue: string,
): { resolution: ConnectionResolution; virtualization: VirtualizationStrategy | undefined } {
  const tokens = (modifier ?? '').split(/\s+/).filter(Boolean);
  let resolution: ConnectionResolution | null = null;
  let virtualization: VirtualizationStrategy | undefined;

  for (const tok of tokens) {
    resolution ??= parseResolutionModifier(tok, defaultValue);
    virtualization ??= parseMockModifier(tok, name) ?? undefined;
  }

  resolution ??= { type: 'url', url: defaultValue };

  return { resolution, virtualization };
}

/**
 * Skip blank lines and comments to find the next `KEY=VALUE` candidate.
 */
export function findNextEnvLine(lines: string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}
