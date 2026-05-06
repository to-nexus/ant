/**
 * `_shared/verify/parity/loadConnections` — extract business `@connection`
 * metadata from the project's `.env.example` for parity verification.
 *
 * The Phase-2 `state.virtualizationSnapshot` channel only stores a boolean
 * (`hasBusinessConnection`). Parity needs the concrete per-connection
 * metadata — name, toggle env var, default URL — to drive the two
 * variants and probe the production endpoint. Reading `.env.example`
 * here keeps parity's runtime concerns decoupled from PreviewService
 * (which is a different process and not addressable from the job runner).
 *
 * Annotation grammar (preview-env-contract §4 / Phase 1):
 *   `# @connection business {name} [resolution-token]`
 *   `<ENV_VAR>=<default-url>`
 *
 * The next non-comment line after a business `@connection` annotation
 * carries the env var name and its default value — that value is the
 * URL parity probes. Toggle env var derivation mirrors Phase 1's
 * `deriveToggleVar(name)` (uppercase snake of the connection name with
 * hyphens replaced).
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const ANNOTATION_RE = /^\s*#\s*@connection\s+business\s+(\S+)/;
const ENV_LINE_RE = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;

export interface ConnectionRecord {
  name: string;
  toggleEnvVar: string;
  url: string;
}

export function deriveToggleVar(name: string): string {
  return `USE_MOCK_${name.replace(/-/g, '_').toUpperCase()}`;
}

function parseEnvFile(content: string): ConnectionRecord[] {
  const lines = content.split(/\r?\n/);
  const out: ConnectionRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANNOTATION_RE);
    if (!m) continue;
    const name = m[1];
    // Walk forward to the next non-comment, non-blank line.
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (next.trim() === '' || next.trim().startsWith('#')) {
        j++;
        continue;
      }
      const envMatch = next.match(ENV_LINE_RE);
      if (envMatch) {
        out.push({
          name,
          toggleEnvVar: deriveToggleVar(name),
          // Strip surrounding quotes so the value is a usable URL.
          url: envMatch[2].replace(/^['"]|['"]$/g, ''),
        });
      }
      break;
    }
  }
  return out;
}

const ENV_FILE_NAMES = ['.env.example'];

async function tryLoad(filePath: string): Promise<ConnectionRecord[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseEnvFile(content);
  } catch {
    return [];
  }
}

/**
 * Walk the codebase root + a single level of monorepo children looking
 * for business `@connection` declarations. Mirrors the scan radius used
 * by `buildVirtualizationSnapshot` so the gate boolean and the
 * connection list never disagree.
 */
export async function loadBusinessConnectionsFromDisk(
  featurePath: string | undefined,
): Promise<ConnectionRecord[]> {
  if (!featurePath) return [];
  const codebaseRoot = path.join(featurePath, 'codebase');

  const collected = new Map<string, ConnectionRecord>();
  const ingest = (records: ConnectionRecord[]): void => {
    for (const r of records) {
      if (!collected.has(r.name)) collected.set(r.name, r);
    }
  };

  for (const f of ENV_FILE_NAMES) {
    ingest(await tryLoad(path.join(codebaseRoot, f)));
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(codebaseRoot);
  } catch {
    return Array.from(collected.values());
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const child = path.join(codebaseRoot, name);
    let stat;
    try {
      stat = await fs.stat(child);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const f of ENV_FILE_NAMES) {
      ingest(await tryLoad(path.join(child, f)));
    }
    let nested: string[] = [];
    try {
      nested = await fs.readdir(child);
    } catch {
      continue;
    }
    for (const nestedName of nested) {
      if (nestedName.startsWith('.') || nestedName === 'node_modules') continue;
      const nestedDir = path.join(child, nestedName);
      let nestedStat;
      try {
        nestedStat = await fs.stat(nestedDir);
      } catch {
        continue;
      }
      if (!nestedStat.isDirectory()) continue;
      for (const f of ENV_FILE_NAMES) {
        ingest(await tryLoad(path.join(nestedDir, f)));
      }
    }
  }

  return Array.from(collected.values());
}
