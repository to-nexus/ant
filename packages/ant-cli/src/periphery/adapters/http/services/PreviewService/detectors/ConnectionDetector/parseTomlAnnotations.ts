import * as fs from 'fs';
import * as path from 'path';
import { ServiceCategory, ServiceConnection } from '../../../../../../../core/ports/portRegistry';
import { logger } from '../../../../../../../utils/logger';
import { formatDisplayName, overrideWithEnvFile } from './utils';
import { autoAttachVirtualization, dispatchResolutionTokens } from './parseEnvAnnotations';

const ANNOTATION_REGEX = /^#\s*@connection\s+(business|infrastructure)\s+(\S+)(?:\s+(.+))?/;

/**
 * Parse `@connection` annotations from `<projectPath>[/<subdir>]/config.example.toml`.
 *
 * Same resolution-token dispatch as `.env.example` (`dispatchResolutionTokens`)
 * with the additional REQUIRED `env:VAR_NAME` token — TOML keys are
 * dotted (e.g. `database.url`) and don't map to a flat env var name, so
 * the annotation must declare which env var the platform should inject.
 *
 * Same Service Virtualization auto-attach: every `business` connection
 * receives `virtualization`, `infrastructure` connections do not.
 */
export function detectFromTomlAnnotations(projectPath: string, subdir?: string): ServiceConnection[] {
  const connections: ServiceConnection[] = [];
  const tomlPath = subdir
    ? path.join(projectPath, subdir, 'config.example.toml')
    : path.join(projectPath, 'config.example.toml');

  if (!fs.existsSync(tomlPath)) {
    return connections;
  }

  const content = fs.readFileSync(tomlPath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(ANNOTATION_REGEX);
    if (!match) continue;

    const category = match[1] as ServiceCategory;
    const name = match[2];
    const rest = match[3]?.trim();

    const { envVar, modifier } = parseTomlAnnotationRest(rest);
    if (!envVar) {
      logger.debug(
        `[ConnectionDetector] Skipping TOML annotation without env: token at ${tomlPath}:${i + 1}`,
        { component: 'ConnectionDetector' },
      );
      continue;
    }

    const nextLine = findNextMeaningfulLine(lines, i + 1);
    const defaultValue = nextLine ? parseTomlValue(nextLine) : '';

    const resolution = dispatchResolutionTokens(modifier, defaultValue);
    const virtualization = autoAttachVirtualization(category, name);

    connections.push({
      id: name,
      name: formatDisplayName(name),
      category,
      envVar,
      value: defaultValue,
      resolution,
      source: subdir || '*',
      configSource: 'toml',
      ...(virtualization ? { virtualization } : {}),
    });
  }

  overrideWithEnvFile(connections, projectPath, subdir);

  return connections;
}

/**
 * Extract the required `env:VAR_NAME` token from the rest-of-line and
 * collect every other token into a single `modifier` string for the
 * shared resolution-token dispatch.
 *
 * Examples:
 *   "env:DATABASE_URL"                 → { envVar: "DATABASE_URL" }
 *   "self env:API_BASE_URL"            → { envVar: "API_BASE_URL", modifier: "self" }
 *   "ant-project:be:main env:API_URL"  → { envVar: "API_URL", modifier: "ant-project:be:main" }
 */
export function parseTomlAnnotationRest(rest: string | undefined): { envVar?: string; modifier?: string } {
  if (!rest) return {};

  const tokens = rest.split(/\s+/).filter(Boolean);
  const envToken = tokens.find(t => /^env:\w+$/.test(t));
  if (!envToken) return {};

  const envVar = envToken.substring(4);
  const modifierTokens = tokens.filter(t => t !== envToken);
  const modifier = modifierTokens.length > 0 ? modifierTokens.join(' ') : undefined;

  return { envVar, modifier };
}

/**
 * Extract a primitive scalar from a TOML line. Section headers and
 * unparseable lines collapse to `''`, matching legacy semantics.
 *
 * Handles: `key = "value"`, `key = 'value'`, `key = bare_value`.
 */
export function parseTomlValue(line: string): string {
  if (/^\[/.test(line)) return '';

  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) return '';

  const rawValue = line.substring(eqIndex + 1).trim();

  const doubleQuoteMatch = rawValue.match(/^"([^"]*)"$/);
  if (doubleQuoteMatch) return doubleQuoteMatch[1];

  const singleQuoteMatch = rawValue.match(/^'([^']*)'$/);
  if (singleQuoteMatch) return singleQuoteMatch[1];

  const bareMatch = rawValue.match(/^(\S+)/);
  return bareMatch ? bareMatch[1] : '';
}

/**
 * Skip blanks and comments to find the next meaningful line — shared by
 * the TOML default-value scan with `findNextEnvLine`'s purpose for .env.
 */
export function findNextMeaningfulLine(lines: string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}
