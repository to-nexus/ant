/**
 * Extract `<plan>...</plan>` JSON block from raw LLM text response.
 *
 * Returns the trimmed inner text when present and at least `minLength`
 * characters long; otherwise `null`. Length gating prevents accepting
 * accidental empty `<plan></plan>` blocks (e.g. from interrupted streams)
 * as a sealed plan.
 *
 * The helper is regex-only — it does NOT JSON.parse the inner text. JSON
 * shape validation is task-type specific (e.g. code's empty-impl shortcut
 * vs design's documentOutline schema) and stays in the caller.
 */

const PLAN_TAG_RE = /<plan>([\s\S]*?)<\/plan>/;

export function extractPlanText(textResponse: string, minLength = 50): string | null {
  const match = textResponse.match(PLAN_TAG_RE);
  if (!match) return null;
  const planText = match[1].trim();
  if (planText.length < minLength) return null;
  return planText;
}
