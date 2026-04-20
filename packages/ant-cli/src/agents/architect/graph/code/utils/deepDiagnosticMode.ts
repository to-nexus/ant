/**
 * Deep-Diagnostic Mode — consolidated module for all "deep diagnostic" behaviours.
 *
 * Before this module, the deep-diagnostic feature was spread across five Axes
 * (G-2 / G-3 / G-4 / G-5 / G-6 / G-7) and two separate files
 * (`deepDiagnosticConfig.ts` for config snapshots, `diagnosticInspect.ts` for
 * the command allow-list) with inline code in `codeCommandPolicy.ts`.
 *
 * Responsibilities (formerly scattered):
 *
 *   1. **Activation predicate** (was G-2, G-6): when does deep-diagnostic mode
 *      activate? Now derived from `_verificationAttempts >= DEEP_DIAGNOSTIC_THRESHOLD`
 *      via `verificationAttempts.inDeepDiagnosticMode`.
 *
 *   2. **Prompt injection** (was G-3): snapshot root config files and render
 *      them as a markdown block the plan prompt appends to `projectCodeContext`.
 *
 *   3. **Command guard relaxation** (was G-4): in deep mode, `*Attempted` guards
 *      soften so the LLM can retry failed commands with different arguments.
 *
 *   4. **Inspection allow-list** (was G-5): read-only commands (cat/ls/pnpm why/
 *      tsc --version/etc.) always bypass the loop guard regardless of mode.
 *
 *   5. **Budget bump** (was G-7): absorbed into the unified attempt counter —
 *      `MAX_VERIFICATION_ATTEMPTS` is the single ceiling; no one-shot bump
 *      needed because the counter is monotonic and ceiling is higher than the
 *      historical 8 + 3 combination.
 *
 * All five facets now live in one module so "what does deep-diagnostic mode
 * actually do?" has a single, greppable answer.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ArchitectGraphState } from '../state';

export { inDeepDiagnosticMode, DEEP_DIAGNOSTIC_THRESHOLD } from './verificationAttempts';

// ────────────────────────────────────────────────────────────────────────────
// (2) Prompt injection — config snapshot
//     (absorbed from deepDiagnosticConfig.ts)
// ────────────────────────────────────────────────────────────────────────────

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
 * appending to the `projectCodeContext` prompt variable.
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

// ────────────────────────────────────────────────────────────────────────────
// (3) Command guard relaxation — single predicate for `codeCommandPolicy`
// ────────────────────────────────────────────────────────────────────────────

/**
 * True when the current state is in deep-diagnostic mode and therefore should
 * relax the `*Attempted` loop guards in `codeCommandPolicy`. Pure function;
 * mirrors the historical `ctx.isDeepDiagnostic` boolean.
 */
export function shouldRelaxCommandGuards(state: ArchitectGraphState): boolean {
  // Local re-import to avoid circular: verificationAttempts → deepDiagnosticMode
  // is one-way, so this import is safe inside the function body.
  return (state._verificationAttempts || 0) >= 2;
}

// ────────────────────────────────────────────────────────────────────────────
// (4) Diagnostic inspect allow-list
//     (absorbed from diagnosticInspect.ts)
// ────────────────────────────────────────────────────────────────────────────

const DIAGNOSTIC_INSPECT_PATTERNS: RegExp[] = [
  /^\s*cat\s+/,
  /^\s*ls\b/,
  /^\s*head\s+/,
  /^\s*tail\s+/,
  /^\s*find\s+/,
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*wc\s+/,
  /^\s*stat\s+/,
  /^\s*which\s+/,
  /^\s*file\s+/,
  /^\s*echo\s+\$/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*npm\s+(why|ls|list|view|config|prefix|root|bin)\b/,
  /^\s*pnpm\s+(why|list|ls|view|config|store|root|bin)\b/,
  /^\s*yarn\s+(why|list|info|config)\b/,
  /^\s*bun\s+(pm\s+ls|pm\s+view|info)\b/,
  /^\s*go\s+(list|env|version|version\s+-m)\b/,
  /^\s*node\s+-v\b/,
  /^\s*node\s+--version\b/,
  /^\s*npx\s+(tsc\s+--version|tsc\s+-v)\b/,
  /^\s*tsc\s+--version\b/,
  /^\s*tsc\s+-v\b/,
  /^\s*git\s+(status|log|diff|show)\b/,
];

/**
 * Whether the command is a pure read-only inspection that should bypass the
 * loop-guard and budget counter regardless of deep-diagnostic mode.
 */
export function isDiagnosticInspectCommand(command: string): boolean {
  if (!command) return false;
  return DIAGNOSTIC_INSPECT_PATTERNS.some(p => p.test(command));
}
