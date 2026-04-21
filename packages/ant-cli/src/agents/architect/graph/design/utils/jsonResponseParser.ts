/**
 * JSON response parsing for design decompose LLM outputs.
 *
 * Pure module — no state / deps / side effects. Lives in axis ⑧ per
 * NODE_GRAPH_LAYOUT §3 R3.
 */

function sanitizeJsonControlChars(jsonStr: string): string {
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
 * Parse LLM JSON response.
 * Priority: <decompose> tag → raw JSON → ```json fenced → embedded object with "tasks".
 */
export function parseLLMJsonResponse(textResponse: string): any {
  const trimmed = (textResponse || '').trim();

  const tagMatch = trimmed.match(/<decompose>\s*([\s\S]*?)\s*<\/decompose>/);
  if (tagMatch) return JSON.parse(sanitizeJsonControlChars(tagMatch[1]));

  try {
    return JSON.parse(sanitizeJsonControlChars(trimmed));
  } catch {
    const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
    const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*"tasks"[\s\S]*\}/)?.[0];
    if (!candidate) {
      throw new Error('Could not parse task breakdown from LLM response');
    }
    return JSON.parse(sanitizeJsonControlChars(candidate));
  }
}
