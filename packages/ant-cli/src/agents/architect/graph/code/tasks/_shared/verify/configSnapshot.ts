/**
 * configSnapshot — deep-diagnostic config-file snapshot for the plan prompt.
 *
 * When `VerificationSession.inDeepMode()` activates (retries >=
 * `DEEP_DIAGNOSTIC_THRESHOLD`), the plan prompt is augmented with a shallow
 * snapshot of project-root config files (package.json, tsconfig*.json,
 * lockfiles, framework configs, etc.) so the LLM can rule out
 * config/dependency-version root causes before touching source code.
 *
 * Pure I/O helper with no Session coupling — the only verification-specific
 * thing about it is that it is gated by `Session.inDeepMode()`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const MAX_FILE_BYTES = 8 * 1024; // 8 KiB per file — config files are usually small
const MAX_TOTAL_BYTES = 48 * 1024; // 48 KiB aggregate cap

const CONFIG_EXACT_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
]);

const CONFIG_PREFIX_PATTERNS: RegExp[] = [
  /^tsconfig\.[^.]+\.json$/i,
  /^jest\.config\.(ts|js|mjs|cjs|json)$/i,
  /^vitest\.config\.(ts|js|mjs|cjs)$/i,
  /^vite\.config\.(ts|js|mjs|cjs)$/i,
  /^next\.config\.(ts|js|mjs|cjs)$/i,
  /^nuxt\.config\.(ts|js|mjs|cjs)$/i,
  /^playwright\.config\.(ts|js|mjs|cjs)$/i,
  /^cypress\.config\.(ts|js|mjs|cjs)$/i,
  /^tsup\.config\.(ts|js|mjs|cjs)$/i,
  /^rollup\.config\.(ts|js|mjs|cjs)$/i,
  /^webpack\.config\.(ts|js|mjs|cjs)$/i,
  /^rspack\.config\.(ts|js|mjs|cjs)$/i,
  /^tailwind\.config\.(ts|js|mjs|cjs)$/i,
  /^postcss\.config\.(ts|js|mjs|cjs)$/i,
];

function shouldIncludeConfigFile(basename: string): boolean {
  if (CONFIG_EXACT_NAMES.has(basename)) return true;
  return CONFIG_PREFIX_PATTERNS.some(p => p.test(basename));
}

async function safeReadBounded(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
      await fd.read(buf, 0, buf.length, 0);
      return buf.toString('utf-8');
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}

export interface CollectedConfig {
  relativePath: string;
  content: string;
  truncated: boolean;
}

/**
 * Shallow-scan the feature's codebase root and return the contents of config
 * files relevant for diagnosing build/type/test failures. Scan is bounded by
 * `MAX_TOTAL_BYTES` so the injection remains prompt-budget-friendly.
 */
export async function collectConfigSnapshot(
  featureRootPath: string | undefined,
): Promise<CollectedConfig[]> {
  if (!featureRootPath) return [];
  const codebasePath = path.join(featureRootPath, 'codebase');
  let entries: string[];
  try {
    entries = await fs.readdir(codebasePath);
  } catch {
    return [];
  }

  const collected: CollectedConfig[] = [];
  let totalBytes = 0;
  for (const base of entries) {
    if (!shouldIncludeConfigFile(base)) continue;
    const abs = path.join(codebasePath, base);
    const content = await safeReadBounded(abs);
    if (content == null) continue;
    if (totalBytes + content.length > MAX_TOTAL_BYTES) break;
    totalBytes += content.length;
    const stat = await fs.stat(abs).catch(() => null);
    const truncated = !!stat && stat.size > content.length;
    collected.push({ relativePath: `codebase/${base}`, content, truncated });
  }
  return collected;
}

/**
 * Render the collected config contents as a markdown block suitable for
 * appending to the verification plan prompt's code-context section.
 */
export function renderConfigBlock(collected: CollectedConfig[]): string {
  if (!collected.length) return '';
  const parts: string[] = [];
  parts.push('### Deep-Diagnostic Config Snapshot');
  parts.push('Configuration files observed at the project root. Use these to rule out config/dependency-version root causes before touching source code.');
  for (const c of collected) {
    parts.push('');
    parts.push(`#### ${c.relativePath}${c.truncated ? ' (truncated)' : ''}`);
    parts.push('```');
    parts.push(c.content);
    parts.push('```');
  }
  return parts.join('\n');
}
