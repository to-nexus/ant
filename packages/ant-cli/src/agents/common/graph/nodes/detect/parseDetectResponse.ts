/**
 * Detect LLM response parser — Phase C SSOT.
 *
 * Expected output shape (single response, sealed at `</slots>` or `</detect>`):
 *
 *   <slots>
 *     <target>architecture/spec/auth.md</target>
 *     <refs>plan/prd.md</refs>
 *     <context>codebase/apps/auth/</context>
 *   </slots>
 *
 *   <!-- Optional, emitted instead of (or alongside) <slots> when the LLM
 *        concludes a required prerequisite is missing. -->
 *   <missingPrereq required="spec" recommended="design-system"/>
 *
 * Each slot tag may contain one path per line OR comma-separated paths.
 * The parser is tolerant of whitespace, trailing commas, and per-line
 * `- ` bullet prefixes (the prompt encourages bullet lists in some
 * variants).
 *
 * The parser deliberately does NOT validate paths against any whitelist —
 * that is `inferRacWithTools`'s job (it gates each tool call, and the
 * final slot values still flow through `resolveToRAC` which has its own
 * matrix-based validation).
 */

export interface ParsedDetectResponse {
  target?: string[];
  refs?: string[];
  context?: string[];
  missingPrereq?: {
    required: string[];
    recommended?: string[];
  };
}

const SLOTS_TAG = /<slots>\s*([\s\S]*?)\s*<\/slots>/i;
const TARGET_TAG = /<target>\s*([\s\S]*?)\s*<\/target>/i;
const REFS_TAG = /<refs>\s*([\s\S]*?)\s*<\/refs>/i;
const CONTEXT_TAG = /<context>\s*([\s\S]*?)\s*<\/context>/i;
const MISSING_PREREQ_TAG =
  /<missingPrereq\b([^>]*?)\/?>(?:\s*<\/missingPrereq>)?/i;

function splitPaths(raw: string): string[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/\r\n/g, '\n')
    .split(/[,\n]+/)
    .map(s => s.trim().replace(/^[-*•]\s*/, '').replace(/^['"`]|['"`]$/g, '').trim())
    .filter(s => s.length > 0 && !/^(none|n\/a|n_a|-)$/i.test(s));
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of cleaned) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function parseAttributeList(attrBlob: string, attrName: string): string[] {
  // Match attrName="..." or attrName='...' with relaxed whitespace.
  const re = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrBlob.match(re);
  if (!m) return [];
  const value = m[1] ?? m[2] ?? '';
  return splitPaths(value);
}

export function parseDetectResponse(raw: string): ParsedDetectResponse {
  if (!raw) return {};
  const result: ParsedDetectResponse = {};

  const missingMatch = raw.match(MISSING_PREREQ_TAG);
  if (missingMatch) {
    const attrs = missingMatch[1] ?? '';
    const required = parseAttributeList(attrs, 'required');
    const recommended = parseAttributeList(attrs, 'recommended');
    if (required.length > 0 || recommended.length > 0) {
      result.missingPrereq = {
        required,
        ...(recommended.length > 0 ? { recommended } : {}),
      };
    }
  }

  const slotsMatch = raw.match(SLOTS_TAG);
  const slotsBody = slotsMatch ? slotsMatch[1] : raw;

  const targetMatch = slotsBody.match(TARGET_TAG);
  if (targetMatch) {
    const t = splitPaths(targetMatch[1]);
    if (t.length > 0) result.target = t;
  }
  const refsMatch = slotsBody.match(REFS_TAG);
  if (refsMatch) {
    const r = splitPaths(refsMatch[1]);
    if (r.length > 0) result.refs = r;
  }
  const contextMatch = slotsBody.match(CONTEXT_TAG);
  if (contextMatch) {
    const c = splitPaths(contextMatch[1]);
    if (c.length > 0) result.context = c;
  }

  return result;
}

/**
 * True when the parse produced no usable signal — neither slot values nor
 * a missingPrereq tag. Callers use this to gate the 1-retry policy.
 */
export function isEmptyDetectResponse(parsed: ParsedDetectResponse): boolean {
  return (
    !parsed.target?.length &&
    !parsed.refs?.length &&
    !parsed.context?.length &&
    !parsed.missingPrereq
  );
}
