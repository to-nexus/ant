export interface GuardrailPolicies {
  forbidCodeFences: boolean;
  codeFencePattern: RegExp;
  requireCompleteFiles: boolean;
  requireRealRepoPaths: boolean;
  englishOnly: boolean;
}

export interface ValidationPolicies {
  minLineRatio: number;
  ellipsis: RegExp;
}

export const GUARDRAILS: GuardrailPolicies = {
  forbidCodeFences: true,
  codeFencePattern: /```/,
  requireCompleteFiles: true,
  requireRealRepoPaths: true,
  englishOnly: true,
};

export const VALIDATION_POLICIES: ValidationPolicies = {
  minLineRatio: 0.7,
  ellipsis: /\.{3}|\/\/\s*\.\.\.|\{\s*\/\*.*\.\.\..*\*\/\s*\}/s,
};
