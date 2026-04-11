import type { LLMContext } from '../LLMClientFactory';

export function detectResponse(jobType?: string): string {
  if (jobType === 'design') {
    return `<detect>
{
  "intentGroup": "design-system",
  "jobMode": "generate",
  "jobModeReasoning": "Mock: generating new design from directive.",
  "domain": "service",
  "environment": "frontend"
}
</detect>`;
  }

  return `<detect>
{
  "jobMode": "generate",
  "jobModeReasoning": "Mock: generating new code from directive.",
  "requireRagForDecompose": false,
  "primarySources": [],
  "primarySourcesReasoning": "Mock: no sources needed.",
  "decomposeKeywords": {
    "errorFiles": [],
    "keywords": ["mock"],
    "references": []
  }
}
</detect>`;
}
