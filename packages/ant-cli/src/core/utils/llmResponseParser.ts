/**
 * Shared LLM Response Parser — single SSOT.
 *
 * Extracts structured JSON from LLM text responses with three layered
 * tolerance guards that every consumer needs:
 *
 *   1. **XML tag** (`<tag> ... </tag>`) — most reliable boundary.
 *   2. **Markdown fence** (` ```json ... ``` `) — common LLM habit even
 *      when the prompt forbids it.
 *   3. **Brace-balanced extraction** — last resort. Picks the FIRST
 *      complete `{ ... }` (string-state + brace-depth aware) so prose
 *      surrounding the JSON does not poison `JSON.parse`.
 *
 * Within every tier the body is also `stripCodeFence`-d (in case the
 * LLM doubled up the wrapper) and `sanitizeJsonControlChars`-ed (to
 * escape raw control bytes inside string literals before parsing).
 *
 * Consolidates the identical pattern duplicated across:
 *   - classifyParser.ts (<classify>)
 *   - triage/parser.ts (<triage>)
 *   - detection.ts (<detect>)
 *   - decompose/helpers.ts (<decompose>)
 *   - decompose/responseParser.ts (per-`<task>` JSON)
 *   - design/utils/jsonResponseParser.ts (<decompose>)
 *   - design/.../specDecompose.ts (raw JSON only)
 *   - direct.ts (raw JSON only — original motivation)
 */

export interface ExtractJsonOptions {
  /**
   * Optional XML tag name. When provided the extractor first looks for
   * `<tag> ... </tag>`. Omit to skip Tier 1 and try fence + raw only.
   */
  tag?: string;
  /**
   * Escape raw control characters inside JSON string literals before
   * parsing (default: false). Recommended whenever the LLM may emit
   * multi-line strings.
   */
  sanitize?: boolean;
}

/**
 * Escape unescaped control characters (0x00-0x1F) inside JSON string
 * literals. Matches quoted strings (handling escaped chars), then
 * replaces raw control bytes inside them with proper JSON escape
 * sequences. `JSON.parse` rejects raw `\n` / `\t` / etc. inside string
 * literals, so this is the standard pre-processing step for every LLM
 * JSON payload.
 */
export function sanitizeJsonControlChars(jsonStr: string): string {
  return jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/[\x00-\x1f]/g, (ch) => {
      switch (ch) {
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '\t': return '\\t';
        case '\b': return '\\b';
        case '\f': return '\\f';
        default: {
          const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
          return `\\u${code}`;
        }
      }
    });
  });
}

/**
 * Strip a markdown code fence wrapping the body. Handles the three
 * variants observed in the wild:
 *   - Triple-backtick with language hint: ```json\n{...}\n```
 *   - Triple-backtick bare: ```\n{...}\n```
 *   - Single-backtick wrap: `{...}`
 *
 * No-op when no fence is present.
 *
 * The decompose / `<specClarify>` prompts explicitly forbid `\`\`\``
 * fences inside XML tag bodies, but LLMs occasionally violate this.
 * Without this cleanup `JSON.parse` would fail on the leading backtick
 * and the silent `null` branch would drop the payload (`late-fading-cross`
 * regression).
 */
export function stripCodeFence(body: string): string {
  const trimmed = body.trim();
  const tripleFence = trimmed.match(/^```(?:[a-zA-Z0-9_+-]*)\s*([\s\S]*?)\s*```$/);
  if (tripleFence) return tripleFence[1].trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Tolerant extractor for the first complete JSON object inside a body
 * that may also contain analytical prose or markdown commentary.
 *
 * `JSON.parse` rejects any non-whitespace after the closing `}`
 * ("Unexpected non-whitespace character after JSON at position N"),
 * which turns a benign prose leak into a job-killing SyntaxError. The
 * symptom appears whenever an LLM uses an XML element as a "document
 * section" (e.g. per-`<task>` wrappers in decompose, `<decompose>`
 * around design JSON) and slips reasoning text alongside the JSON.
 *
 * Strategy: locate the first `{`, then scan forward tracking string
 * state (with escape handling) and brace depth until the matching `}`.
 * Return that exact substring; the caller still runs it through
 * `sanitizeJsonControlChars` and `JSON.parse` so every JSON validity
 * guarantee is preserved.
 *
 * Behaviour notes:
 *   - When no `{` is present, returns the body unchanged so callers
 *     keep the same diagnostic on truly malformed bodies.
 *   - String escapes (`\\"`, `\\\\`) are honoured so a `}` inside a
 *     JSON string literal does not prematurely close the scan.
 */
export function extractFirstJsonObject(body: string): string {
  const src = body;
  let i = 0;
  while (i < src.length && src[i] !== '{') i++;
  if (i === src.length) return body;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return body;
}

/**
 * Canonical pre-processing for any tag body that carries JSON.
 * Order is critical: stripping the code fence FIRST means
 * `sanitizeJsonControlChars` (which only escapes control chars inside
 * matched string literals) cannot be defeated by a body that starts
 * with a raw backtick.
 */
export function prepareTagJson(body: string): string {
  return sanitizeJsonControlChars(stripCodeFence(body));
}

/**
 * Extract a JSON object from an LLM text response, tolerating prose
 * leaks at every tier.
 *
 * Tier order:
 *   1. `<tag> ... </tag>` (when `tag` provided)
 *   2. `` ```json ... ``` `` markdown fence
 *   3. Brace-balanced extraction of the first `{ ... }` from the raw text
 *
 * Each candidate body passes through `stripCodeFence` (in case of a
 * doubled wrapper), `extractFirstJsonObject` (prose-tolerance), and
 * `sanitizeJsonControlChars` (when `sanitize` is true) before
 * `JSON.parse`.
 *
 * Returns `null` on any extraction or parse failure (never throws) so
 * callers can layer their own diagnostics / retry framing on top.
 */
export function extractJsonFromLlmResponse<T = any>(
  raw: string,
  options: ExtractJsonOptions = {},
): T | null {
  if (!raw || !raw.trim()) return null;

  const { tag, sanitize = false } = options;

  if (tag) {
    const tagRegex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`);
    const tagMatch = raw.match(tagRegex);
    if (tagMatch) {
      const parsed = tryParseJson<T>(tagMatch[1], sanitize);
      if (parsed !== null) return parsed;
    }
  }

  const fenceMatch = raw.match(/```(?:[a-zA-Z0-9_+-]*)\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const parsed = tryParseJson<T>(fenceMatch[1], sanitize);
    if (parsed !== null) return parsed;
  }

  return tryParseJson<T>(raw, sanitize);
}

function tryParseJson<T>(candidate: string, sanitize: boolean): T | null {
  try {
    const stripped = stripCodeFence(candidate);
    const isolated = extractFirstJsonObject(stripped);
    const cleaned = sanitize ? sanitizeJsonControlChars(isolated) : isolated;
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
