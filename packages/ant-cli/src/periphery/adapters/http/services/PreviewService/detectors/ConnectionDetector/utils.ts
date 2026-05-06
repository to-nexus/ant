import * as fs from 'fs';
import * as path from 'path';
import { ServiceConnection } from '../../../../../../../core/ports/portRegistry';

/**
 * Parse a single `KEY=VALUE` line from a .env file.
 * Strips matching surrounding quotes from the value. Returns `[null, null]`
 * when the line has no `=` sign.
 */
export function parseEnvLine(line: string): [string, string] | [null, null] {
  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) return [null, null];
  const key = line.substring(0, eqIndex).trim();
  let value = line.substring(eqIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/**
 * Convert hyphen-separated `name` into a Title-cased display string.
 * `stripe-api` → `"Stripe Api"`.
 */
export function formatDisplayName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Override placeholder `value`s with concrete values from the project `.env`
 * (when present) and resolve Service Virtualization toggle state.
 *
 * Two responsibilities, deliberately co-located because both inputs come from
 * the same `.env` file scan:
 *
 *   1. For `url`-resolution connections, replace `value` with whatever
 *      `.env` declares for the matching env var (so the diagnostics layer
 *      sees the live URL the runtime will consume).
 *   2. For connections with `virtualization.mockKind === 'available'`,
 *      compute `virtualization.active` using the priority chain
 *      `USE_MOCK_<NAME>` > master `USE_MOCK` > `false`.
 *
 * `mockKind === 'inline'` connections keep `active = true` (set at parse
 * time) — there is no external toggle for inline fakes.
 */
export function overrideWithEnvFile(
  connections: ServiceConnection[],
  projectPath: string,
  subdir?: string,
): void {
  const envPath = subdir
    ? path.join(projectPath, subdir, '.env')
    : path.join(projectPath, '.env');

  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  const envMap = new Map<string, string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, value] = parseEnvLine(trimmed);
    if (key) envMap.set(key, value);
  }

  const masterUseMock = envMap.get('USE_MOCK') === 'true';

  for (const conn of connections) {
    const actualValue = envMap.get(conn.envVar);
    if (actualValue !== undefined) {
      conn.value = actualValue;
      if (conn.resolution.type === 'url') {
        conn.resolution = { type: 'url', url: actualValue };
      }
    }

    if (conn.virtualization?.mockKind === 'available') {
      const toggleVar = conn.virtualization.toggleEnvVar;
      const perPort = toggleVar ? envMap.get(toggleVar) : undefined;
      conn.virtualization.active = perPort !== undefined ? perPort === 'true' : masterUseMock;
    }
  }
}
