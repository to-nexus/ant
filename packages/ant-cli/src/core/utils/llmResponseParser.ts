/**
 * Shared LLM Response Parser
 *
 * Extracts structured JSON from LLM text responses using a 3-tier fallback chain:
 *   1. XML tag: <tag>{ ... }</tag>
 *   2. Markdown fence: ```json\n{ ... }\n```
 *   3. Greedy brace match: first { to last } (last resort)
 *
 * Consolidates the identical pattern duplicated across:
 *   - classifyParser.ts (<classify>)
 *   - triage/parser.ts (<triage>)
 *   - detection.ts (<detect>)
 *   - decompose/helpers.ts (<decompose>)
 *   - decompose/responseParser.ts (<tasks>, <techTier>, etc.)
 *   - direct.ts (raw JSON only — the motivation for this module)
 */

export interface ExtractJsonOptions {
  /** XML tag name to look for, e.g. 'direct', 'classify', 'triage' */
  tag: string;
  /** Escape raw control characters inside JSON string literals before parsing (default: false) */
  sanitize?: boolean;
}

/**
 * Escape unescaped control characters (0x00-0x1F) inside JSON string literals.
 * Prevents JSON.parse failures caused by raw newlines/tabs in LLM output.
 */
export function sanitizeJsonControlChars(jsonStr: string): string {
  return jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/[\x00-\x1f]/g, (ch) => {
      switch (ch) {
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '\t': return '\\t';
        default: return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      }
    });
  });
}

/**
 * Extract a JSON object from an LLM text response.
 *
 * Fallback order:
 *   1. `<tag> ... </tag>` — most reliable, unique boundary
 *   2. `` ```json ... ``` `` — common LLM formatting habit
 *   3. `{ ... }` greedy — last resort, fragile with nested braces
 *
 * Returns `null` on any extraction or parse failure (never throws).
 */
export function extractJsonFromLlmResponse<T = any>(
  raw: string,
  options: ExtractJsonOptions,
): T | null {
  if (!raw || !raw.trim()) return null;

  const { tag, sanitize = false } = options;

  // Tier 1: XML tag
  const tagRegex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`);
  const tagMatch = raw.match(tagRegex);
  if (tagMatch) {
    const parsed = tryParseJson<T>(tagMatch[1], sanitize);
    if (parsed !== null) return parsed;
  }

  // Tier 2: Markdown fence
  const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    const parsed = tryParseJson<T>(fenceMatch[1], sanitize);
    if (parsed !== null) return parsed;
  }

  // Tier 3: Greedy brace match (first { to last })
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    return tryParseJson<T>(braceMatch[0], sanitize);
  }

  return null;
}

function tryParseJson<T>(candidate: string, sanitize: boolean): T | null {
  try {
    const cleaned = sanitize ? sanitizeJsonControlChars(candidate.trim()) : candidate.trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
