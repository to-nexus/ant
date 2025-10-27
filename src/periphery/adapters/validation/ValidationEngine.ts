import { VALIDATION_POLICIES, GUARDRAILS } from "../../../core/policies/validations";

export function validateOutput(filePath: string, content: string, original?: string): { violations: string[]; score: number } {
  const v: string[] = [];
  const p = VALIDATION_POLICIES;
  if (p.ellipsis.test(content)) {
    v.push(`${filePath}: contains ellipsis or skipped code`);
  }
  if (GUARDRAILS.forbidCodeFences && GUARDRAILS.codeFencePattern.test(content)) {
    v.push(`${filePath}: contains code fences`);
  }
  if (original) {
    const o = original.split("\n").length;
    const n = content.split("\n").length;
    if (n < Math.floor(o * p.minLineRatio)) {
      v.push(`${filePath}: excessive deletion (${n}/${o} lines)`);
    }
  }
  return { violations: v, score: v.length ? 0 : 1 };
}
