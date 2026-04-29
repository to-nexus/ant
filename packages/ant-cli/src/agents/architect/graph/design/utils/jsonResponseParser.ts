/**
 * Design decompose JSON response parser.
 *
 * Single contract — external meta tags + per-`<task>` wrappers:
 *
 *   ```
 *   <executionTier>4</executionTier>
 *   <targetFiles>["fe-system-main.md"]</targetFiles>
 *   <documentType>contract-first</documentType>
 *   <techTier>{"stack":"backend","language":"typescript"}</techTier>
 *   <tasks>
 *     <task>{"id":"design-arch","name":"...","targetFile":"fe-system-main.md",...}</task>
 *     <task>{...}</task>
 *   </tasks>
 *   ```
 *
 * Each `<task>` body is a single JSON object; the parser composes a
 * synthetic `{ ...meta, tasks: [...] }` object so callers see one shape.
 * This is the format the streaming pipeline renders task-by-task as
 * each `</task>` arrives (see `XMLStreamParser.task_added` and
 * `decomposeWithToolLoop`'s `onTaskParsed` hook).
 *
 * Legacy `<decompose>{...}</decompose>` and bare-JSON contracts are
 * NOT accepted — the prompt rules.md / inline prompts forbid them and
 * the system-design repair-call re-prompts in the new contract on
 * mismatch. A non-recoverable response throws
 * `Could not parse task breakdown from LLM response`, which the
 * caller's repair-call / outer try-catch surfaces.
 *
 * Inherits the SSOT prep — `stripCodeFence`, `sanitizeJsonControlChars`,
 * `prepareTagJson`, `extractFirstJsonObject` — from
 * `core/utils/llmResponseParser` so prose-tolerance, fence stripping,
 * and brace-balanced extraction guards still apply at every level.
 */

import {
  extractFirstJsonObject,
  prepareTagJson,
  sanitizeJsonControlChars,
  stripCodeFence,
} from '../../../../../core/utils/llmResponseParser';

/**
 * External meta-tag names emitted alongside `<tasks>` in the contract.
 *
 * Each sub-decompose variant uses a different subset:
 *   - ui / game-art       : `targetFiles`, `strategy`
 *   - system-design       : `documentType`, `services`, `fePackages`,
 *                           `techTier`, `packageTiers`, `targetFiles`,
 *                           `references`
 *   - spec (inline prompt): `slug`, `title`
 *
 * Adding a new meta tag here is the only change needed to surface it on
 * the parsed object. Callers see `parsed[tagName]`.
 */
const META_TAG_NAMES = [
  'targetFiles',
  'services',
  'fePackages',
  'techTier',
  'packageTiers',
  'documentType',
  'strategy',
  'slug',
  'title',
  'references',
  'jobMode',
] as const;

/**
 * Parse the body of a single meta tag. Tries JSON first (so arrays /
 * objects round-trip cleanly), then falls back to the trimmed raw
 * string for scalar tags like `<documentType>unified</documentType>`.
 *
 * Inherits the SSOT prep — `stripCodeFence` (in case the LLM doubled up
 * the wrapper) and `sanitizeJsonControlChars` before `JSON.parse`.
 */
function parseMetaValue(body: string): unknown {
  const cleaned = stripCodeFence(body).trim();
  if (!cleaned) return undefined;
  try {
    return JSON.parse(sanitizeJsonControlChars(cleaned));
  } catch {
    return cleaned;
  }
}

function extractMetaTags(raw: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const name of META_TAG_NAMES) {
    const re = new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`);
    const m = raw.match(re);
    if (!m) continue;
    const value = parseMetaValue(m[1]);
    if (value !== undefined) meta[name] = value;
  }
  return meta;
}

/**
 * Extract the `<tasks><task>{json}</task>...</tasks>` sequence.
 *
 * Returns `null` when no `<tasks>` block is present at all (signal for
 * the caller to throw the canonical contract-mismatch error). Returns
 * an array — possibly empty — when `<tasks>` IS present, so an empty
 * `<tasks></tasks>` is treated as "contract followed, zero tasks"
 * (caller's coverage / shape validation surfaces emptiness as its own
 * domain error rather than a parser failure).
 *
 * Each `<task>` body goes through the same SSOT prep used by
 * code-decompose's per-task wrapper parser — `extractFirstJsonObject` +
 * `prepareTagJson` + `JSON.parse`. Malformed `<task>` bodies are
 * skipped silently; the caller's coverage / shape validation surfaces
 * the resulting gap.
 */
function extractTaskSequence(raw: string): unknown[] | null {
  const tasksMatch = raw.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
  if (!tasksMatch) return null;
  const inner = tasksMatch[1];
  const taskMatches = [...inner.matchAll(/<task>\s*([\s\S]*?)\s*<\/task>/g)];
  if (taskMatches.length === 0) {
    // Empty `<tasks></tasks>` — treat as zero tasks (contract followed).
    // We do NOT silently fall through to "parse `inner` as a JSON array"
    // any more — the only legal body is `<task>...</task>` elements;
    // any other body is a contract violation that the caller should
    // surface via repair-call rather than parser-side coercion.
    return [];
  }
  const tasks: unknown[] = [];
  for (const m of taskMatches) {
    const body = m[1];
    try {
      const obj = JSON.parse(prepareTagJson(extractFirstJsonObject(body)));
      tasks.push(obj);
    } catch {
      // Malformed task body — skip; caller's coverage check will surface
      // the resulting gap.
    }
  }
  return tasks;
}

/**
 * Parse a design decompose LLM response in the v2 contract.
 *
 * Throws `Could not parse task breakdown from LLM response` on any
 * response that does not contain a `<tasks>` block — the caller's
 * repair-call / outer try-catch then re-prompts with explicit contract
 * guidance.
 */
export function parseLLMJsonResponse(textResponse: string): any {
  const tasks = extractTaskSequence(textResponse);
  if (tasks === null) {
    throw new Error('Could not parse task breakdown from LLM response');
  }
  const meta = extractMetaTags(textResponse);
  return { ...meta, tasks };
}
