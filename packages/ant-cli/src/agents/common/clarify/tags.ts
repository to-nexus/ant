/**
 * Canonical `<clarify>` tag parser for LLM response text.
 *
 * Absorbs the former `planner/.../generate/clarify.ts` (local duplicate)
 * and the inline regex in `design/.../docGen/index.ts`. Every node that
 * parses `<clarify>` out of free-form LLM output routes through here.
 *
 * Supports two surface syntaxes actually emitted by different prompts:
 *
 *   1. `<clarify question="...">`
 *      `  <option>...</option>`
 *      `  <option>...</option>`
 *      `</clarify>`
 *      — planner PRD-gap clarify (question in attribute, options as children)
 *
 *   2. `<clarify>`
 *      `  - ...`
 *      `  - ...`
 *      `</clarify>`
 *      — design spec docGen clarify (free-form bullet list inside the tag)
 *
 * Both surfaces yield a `ClarifyBlock` with `question` (possibly the whole
 * body when no attribute is present) and `options` (possibly empty).
 * Callers decide how to present a block without options (e.g. docGen
 * forwards it as a chat message; planner requires ≥1 option to render
 * a choice card).
 */

import type { ClarifyBlock } from './types';

const CLARIFY_TAG_RE = /<clarify(?:\s+question="([^"]*)")?\s*>([\s\S]*?)<\/clarify>/g;
const OPTION_TAG_RE = /<option>([\s\S]*?)<\/option>/g;

/**
 * Parse every `<clarify>` tag out of `text`. See module docstring for the
 * two supported surface syntaxes.
 */
export function parseClarifyTags(text: string): ClarifyBlock[] {
  const blocks: ClarifyBlock[] = [];
  let match: RegExpExecArray | null;
  CLARIFY_TAG_RE.lastIndex = 0;
  while ((match = CLARIFY_TAG_RE.exec(text)) !== null) {
    const attributeQuestion = (match[1] ?? '').trim();
    const body = match[2] ?? '';

    const options: string[] = [];
    OPTION_TAG_RE.lastIndex = 0;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = OPTION_TAG_RE.exec(body)) !== null) {
      const optText = optMatch[1].trim();
      if (optText) options.push(optText);
    }

    const bodyWithoutOptions = body.replace(OPTION_TAG_RE, '').trim();
    // Prefer the attribute question; fall back to the tag body when no
    // attribute was emitted (docGen syntax).
    const question = attributeQuestion || bodyWithoutOptions;

    if (question) {
      blocks.push({ question, options });
    }
  }
  return blocks;
}

/**
 * Strip every `<clarify>...</clarify>` occurrence from `text` for clean
 * chat display. Both surface syntaxes are covered by the shared regex.
 */
export function stripClarifyTags(text: string): string {
  return text.replace(CLARIFY_TAG_RE, '').trim();
}
