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
 *   - code/.../decompose/responseParser.ts (per-`<task>` JSON + meta tags)
 *   - design/utils/jsonResponseParser.ts (per-`<task>` JSON + meta tags)
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
 * section" (e.g. per-`<task>` wrappers in decompose, `<classify>` /
 * `<triage>` payload tags) and slips reasoning text alongside the JSON.
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

/**
 * Violation channel for callers that DO want to escalate a JSON
 * syntax error (instead of the silent-`null` `extractJsonFromLlmResponse`
 * fallback) — typically because they own a retry loop and need a
 * framing payload to drive the next LLM attempt.
 *
 * Mirrors the prior-art `ExecutionTierViolation` (with detail +
 * framing builder pair) so retry-aware nodes share one shape:
 *   1. native parse → `asJsonSyntaxViolation(err, body, source)` wrap
 *   2. caller `instanceof JsonSyntaxViolation` branch
 *   3. `buildJsonSyntaxViolationFraming(violation)` appended to prompt
 */
export interface JsonSyntaxViolationDetail {
  /** Position N from the native SyntaxError message; -1 when not parsable. */
  position: number;
  /** ±100 char window around `position` taken from the original raw body. */
  context: string;
  /**
   * Optional human label for the parse site (e.g. `<task>[3] body`,
   * `<tasks> legacy array body`). Surfaced in framing so the LLM knows
   * which payload to fix.
   */
  source?: string;
  /** Original `SyntaxError.message`, preserved for diagnostics. */
  message: string;
}

export class JsonSyntaxViolation extends Error {
  readonly detail: JsonSyntaxViolationDetail;
  constructor(detail: JsonSyntaxViolationDetail) {
    super(
      `JsonSyntaxViolation: ${detail.message}${detail.source ? ` (in ${detail.source})` : ''}`,
    );
    this.detail = detail;
    this.name = 'JsonSyntaxViolation';
  }
}

/**
 * Wrap a native `SyntaxError` thrown by `JSON.parse` into a typed
 * `JsonSyntaxViolation`, extracting the `position N` window from the
 * original body so the retry framing can include surrounding bytes.
 * Non-`SyntaxError` inputs are wrapped too (with `position = -1`) for
 * uniform caller handling.
 */
export function asJsonSyntaxViolation(
  error: unknown,
  rawBody: string,
  source?: string,
): JsonSyntaxViolation {
  if (!(error instanceof SyntaxError)) {
    return new JsonSyntaxViolation({
      position: -1,
      context: rawBody.slice(0, 200),
      source,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const positionMatch = error.message.match(/position (\d+)/);
  const position = positionMatch ? parseInt(positionMatch[1], 10) : -1;
  const context =
    position >= 0
      ? rawBody.substring(
          Math.max(0, position - 100),
          Math.min(rawBody.length, position + 100),
        )
      : rawBody.slice(0, 200);
  return new JsonSyntaxViolation({ position, context, source, message: error.message });
}

/**
 * Build a short framing block to append to the LLM user prompt for the
 * next retry attempt. Mirrors `buildExecutionTierViolationFraming` /
 * `buildBatchSplitSchemaViolationFraming` — concrete enough to tell
 * the LLM where the parse failed without re-asking the entire breakdown.
 */
export function buildJsonSyntaxViolationFraming(v: JsonSyntaxViolation): string {
  const { position, context, source, message } = v.detail;
  const head = '\n\n---\n\n## Retry: previous response failed JSON parsing\n';
  const where = source ? ` inside ${source}` : '';
  const ctxBlock =
    position >= 0
      ? `\nContext around position ${position}:\n\`\`\`\n${context}\n\`\`\`\n`
      : '';
  return (
    head +
    `Your previous response contained a JSON syntax error${where}: ${message}.` +
    ctxBlock +
    '\nRe-emit the SAME breakdown — same `<executionTier>`, same `<techTier>`, same task IDs / names / priorities — with VALID JSON in every `<task>` body. Do NOT change semantic content; only fix the syntax.\n\n' +
    'Common causes to avoid:\n' +
    '- Unescaped double quote inside a string field (use `\\"` or single quotes).\n' +
    '- Trailing comma before `}` or `]`.\n' +
    '- Raw newline inside a string literal (escape as `\\n`).\n' +
    '- Missing comma between key-value pairs.\n'
  );
}
