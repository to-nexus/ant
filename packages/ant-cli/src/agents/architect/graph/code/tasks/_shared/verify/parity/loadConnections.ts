/**
 * `_shared/verify/parity/loadConnections` — extract business `@connection`
 * metadata (name, toggle env var, default URL) from the project's
 * `.env.example` files for parity verification.
 *
 * Annotation grammar, toggle-name derivation, and the scan radius are owned
 * by the connection SSOT (`core/prompt/builder/serviceVirtualization/connectionModel`).
 * This file only adds the parity-specific step of pairing each annotation
 * with the env var line that follows it (the URL parity probes).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import {
  parseAnnotationLine,
  deriveToggleVar,
  collectInScanRadius,
} from '../../../../../../../../core/prompt/builder/serviceVirtualization/connectionModel';

const ENV_LINE_RE = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;

export interface ConnectionRecord {
  name: string;
  toggleEnvVar: string;
  url: string;
}

function parseEnvFile(content: string): ConnectionRecord[] {
  const lines = content.split(/\r?\n/);
  const out: ConnectionRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const annotation = parseAnnotationLine(lines[i]);
    if (annotation?.category !== 'business') continue;
    const name = annotation.name;
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

async function tryLoad(filePath: string): Promise<ConnectionRecord[]> {
  try {
    return parseEnvFile(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Walk the codebase root + monorepo children (connection SSOT radius) for
 * business `@connection` declarations. First occurrence of a name wins.
 */
export async function loadBusinessConnectionsFromDisk(
  featurePath: string | undefined,
): Promise<ConnectionRecord[]> {
  if (!featurePath) return [];
  const all = await collectInScanRadius(path.join(featurePath, 'codebase'), (dir) =>
    tryLoad(path.join(dir, '.env.example')),
  );
  const collected = new Map<string, ConnectionRecord>();
  for (const r of all) {
    if (!collected.has(r.name)) collected.set(r.name, r);
  }
  return Array.from(collected.values());
}
