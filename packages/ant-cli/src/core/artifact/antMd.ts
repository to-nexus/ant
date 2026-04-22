/**
 * `codebase/ANT.md` loader — ant-agent settings file for the target
 * codebase.
 *
 * See `docs/architecture/35-codebase-meta-policy.md` for the full policy:
 * ANT.md is the SSOT for conventions that ant must follow when creating
 * or modifying files in a given codebase (export style, React import
 * style, test setup, file naming, ...). setup tasks create it, every
 * other task reads it.
 *
 * The loader is intentionally trivial: read the file, cap the size,
 * hand back `{ has, content }`. PromptBuilder call sites decide whether
 * to inject `hasAntMd` / `antMdContent` variables from this result.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Policy-driven size ceiling for ANT.md content that gets injected into
 * every plan / execute prompt. Content above this is truncated with a
 * pointer so the LLM knows to `read_file` the full file.
 *
 * The 1500-character limit is documented in the policy (see
 * docs/architecture/35-codebase-meta-policy.md §2 "크기 상한: 1500자").
 */
export const ANT_MD_MAX_CHARS = 1500;

/**
 * Filename resolved relative to a feature workspace's root. The policy
 * mandates the file lives at `codebase/ANT.md` exactly — no hidden
 * directories, no nested paths. Callers pass the feature workspace root
 * (the parent of `codebase/`).
 */
export const ANT_MD_RELATIVE_PATH = 'codebase/ANT.md';

export interface LoadedAntMd {
  /** True when `codebase/ANT.md` exists and was successfully read. */
  has: boolean;
  /**
   * Prompt-ready content. Empty string when `has === false`. When the
   * original file exceeded `ANT_MD_MAX_CHARS`, this string is truncated
   * and a `[...truncated; read_file codebase/ANT.md for full content]`
   * footer is appended.
   */
  content: string;
  /** True when the original file exceeded the cap and was truncated. */
  truncated: boolean;
}

/**
 * Synchronously load `codebase/ANT.md` from a feature workspace root.
 *
 * Returns `{ has: false, content: '', truncated: false }` when:
 *   - `featureRoot` is undefined / empty,
 *   - the file does not exist,
 *   - the file cannot be read (permission error, etc.).
 *
 * Failure is silent by design — ANT.md is optional and missing is a
 * legitimate state for projects that have not yet adopted the policy.
 * Callers should treat `has === false` as "no project-wide agent
 * settings; fall back to sibling observation".
 */
export function loadAntMd(featureRoot: string | undefined): LoadedAntMd {
  if (!featureRoot) return { has: false, content: '', truncated: false };
  const full = path.join(featureRoot, ANT_MD_RELATIVE_PATH);
  let raw: string;
  try {
    raw = fs.readFileSync(full, 'utf8');
  } catch {
    return { has: false, content: '', truncated: false };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { has: false, content: '', truncated: false };
  }

  if (trimmed.length <= ANT_MD_MAX_CHARS) {
    return { has: true, content: trimmed, truncated: false };
  }

  const clipped = trimmed.slice(0, ANT_MD_MAX_CHARS).trimEnd();
  const footer = `\n\n[...truncated; file exceeds ${ANT_MD_MAX_CHARS}-char cap. Call \`read_file codebase/ANT.md\` for the full content.]`;
  console.warn(
    `⚠️ [ANT.md] Content exceeds ${ANT_MD_MAX_CHARS}-char cap (${trimmed.length} chars). Truncated for prompt injection.`,
  );
  return { has: true, content: `${clipped}${footer}`, truncated: true };
}

/**
 * Convenience — merge `hasAntMd` / `antMdContent` into a vars object
 * destined for `promptBuilder.render(...)`. Does NOT clobber existing
 * keys; call sites that already set these variables win.
 */
export function mergeAntMdVars<T extends Record<string, unknown>>(
  vars: T,
  loaded: LoadedAntMd,
): T & { hasAntMd: boolean; antMdContent: string } {
  return {
    ...vars,
    hasAntMd: 'hasAntMd' in vars ? (vars as any).hasAntMd : loaded.has,
    antMdContent: 'antMdContent' in vars ? (vars as any).antMdContent : loaded.content,
  };
}
