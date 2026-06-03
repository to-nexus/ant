import * as fs from 'fs';
import * as path from 'path';
import {
  ConnectionResolution,
  ServiceCategory,
  ServiceConnection,
  VirtualizationStrategy,
} from '../../../../../../../core/ports/portRegistry';
import { formatDisplayName, overrideWithEnvFile, parseEnvLine } from './utils';
import { parseResolutionModifier } from './parseModifiers';
import {
  parseAnnotationLine,
  deriveToggleVar,
} from '../../../../../../../core/prompt/builder/serviceVirtualization/connectionModel';

/**
 * Parse `@connection` annotations from `<projectPath>[/<subdir>]/.env.example`.
 *
 * Annotation grammar (after the `# @connection {category} {name}` header):
 *   - any number of optional whitespace-separated resolution tokens
 *     (`self`, `ant-project:p:f[:svc]`); first claim wins, fallback = `url`.
 *
 * Service Virtualization is NOT a token — every `business` connection
 * receives a `VirtualizationStrategy` automatically (single SSOT for the
 * "every external dep is virtualizable" philosophy). `infrastructure`
 * connections never receive one (docker-compose owns the real backing
 * service).
 *
 * Each annotation MUST be immediately followed by a `KEY=VALUE` line —
 * that line names the env var the platform injects. Annotations whose
 * next env line is missing are skipped (matches legacy behavior).
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
    const annotation = parseAnnotationLine(lines[i]);
    if (!annotation) continue;

    const category = annotation.category as ServiceCategory;
    const name = annotation.name;
    const modifier = annotation.modifier?.trim();

    const nextLine = findNextEnvLine(lines, i + 1);
    if (!nextLine) continue;

    const [envVar, value] = parseEnvLine(nextLine);
    if (!envVar) continue;

    const resolution = dispatchResolutionTokens(modifier, value || '');
    const virtualization = autoAttachVirtualization(category, name);

    connections.push({
      id: name,
      name: formatDisplayName(name),
      category,
      envVar,
      value: value || '',
      resolution,
      source: subdir || '*',
      configSource: 'env',
      ...(virtualization ? { virtualization } : {}),
    });
  }

  overrideWithEnvFile(connections, projectPath, subdir);

  return connections;
}

/**
 * Multi-token resolution dispatch shared by .env and TOML annotation
 * parsers. Each token is offered to the resolution layer; first claim
 * wins. Falls back to `url` when no token claims the slot.
 *
 * Exported so `parseTomlAnnotations.ts` reuses the same dispatch loop.
 */
export function dispatchResolutionTokens(
  modifier: string | undefined,
  defaultValue: string,
): ConnectionResolution {
  const tokens = (modifier ?? '').split(/\s+/).filter(Boolean);
  let resolution: ConnectionResolution | null = null;

  for (const tok of tokens) {
    resolution ??= parseResolutionModifier(tok, defaultValue);
  }

  resolution ??= { type: 'url', url: defaultValue };

  return resolution;
}

/**
 * Auto-attach a `VirtualizationStrategy` for every business connection.
 * Single source of truth: connection category. No annotation token, no
 * per-connection opt-in — the category IS the contract.
 *
 * Returns `undefined` for `infrastructure` connections (docker-compose
 * owns the real backing service; virtualization is not a concern).
 */
export function autoAttachVirtualization(
  category: ServiceCategory,
  name: string,
): VirtualizationStrategy | undefined {
  if (category !== 'business') return undefined;
  return {
    toggleEnvVar: deriveToggleVar(name),
    active: false, // resolved by overrideWithEnvFile against `.env`
  };
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
