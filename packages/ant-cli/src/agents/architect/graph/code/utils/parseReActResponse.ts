/**
 * parseReActResponse — extract termination signals from an assistant turn.
 *
 * Direct-node output grammar recognises:
 *   <done>true</done>                     → task finished; exit loop success
 *   <needsEscalation>true</needsEscalation> → scope exceeds loop; promote
 *
 * Tags are case-insensitive and may have surrounding whitespace. `cleanedText`
 * strips the recognised tags so the assistant turn can be appended to history
 * without duplicating signals the LLM already consumed.
 */

const DONE_RE = /<done>\s*true\s*<\/done>/i;
const ESCALATE_RE = /<needsEscalation>\s*true\s*<\/needsEscalation>/i;

export interface ParsedReActResponse {
  done: boolean;
  needsEscalation: boolean;
  cleanedText: string;
}

export function parseReActResponse(textResponse: string): ParsedReActResponse {
  const text = textResponse || '';
  const done = DONE_RE.test(text);
  const needsEscalation = ESCALATE_RE.test(text);
  const cleanedText = text
    .replace(DONE_RE, '')
    .replace(ESCALATE_RE, '')
    .trim();
  return { done, needsEscalation, cleanedText };
}
