/**
 * Salvage for GLM-family text tool-call markup leaking into the structured
 * tool_calls channel (marble-curling-clasp RCA).
 *
 * GLM converts the model's text markup
 * `<tool_call>{name}<arg_key>{k}</arg_key><arg_value>{v}</arg_value>` into
 * OpenAI-shaped tool_calls server-side. When the model emits malformed markup
 * (e.g. a dangling `</arg_key>` with no opener), that conversion stuffs the
 * ENTIRE payload into `function.name` and returns empty arguments — a ghost
 * tool call that silently drops the payload (a design job lost its sealed
 * plan this way and then blew the message token budget re-exploring).
 *
 * This module re-splits such a name at the ingestion boundary. It never
 * guesses: pairs are recovered only from well-formed `<arg_key>/<arg_value>`
 * segments, and a lone dangling `<arg_value>{object}</arg_value>` is adopted
 * as the whole arguments object only when it parses to a plain object (the
 * OpenAI contract — arguments IS one JSON object). Anything else keeps the
 * raw name so dispatch fails loudly as an unknown tool instead of silently.
 */

const MARKUP_MARKER = /<\/?(?:tool_call|arg_key|arg_value)>/;
const PAIR_RE = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
const LONE_VALUE_RE = /<arg_value>([\s\S]*?)<\/arg_value>/g;

export interface SalvagedToolCall {
  name: string;
  input: Record<string, unknown> | null;
  /** true when markup markers were found in the raw name. */
  malformed: boolean;
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * @param rawName    `function.name` as received from the provider.
 * @returns salvaged name and (when recoverable) the arguments object.
 *          `input: null` means the arguments could not be recovered —
 *          the caller keeps whatever it parsed from `function.arguments`.
 */
export function salvageMarkupToolCall(rawName: string): SalvagedToolCall {
  if (!MARKUP_MARKER.test(rawName)) {
    return { name: rawName, input: null, malformed: false };
  }

  const markerIdx = rawName.indexOf('<');
  const name = rawName.slice(0, markerIdx).trim();
  if (!name) {
    // Nothing usable before the markup — keep the raw name so the dispatch
    // layer reports an explicit unknown-tool error (loud, not silent).
    return { name: rawName, input: null, malformed: true };
  }

  const remainder = rawName.slice(markerIdx);

  // Well-formed key/value pairs → build the arguments object from them.
  const pairs: Record<string, unknown> = {};
  let pairCount = 0;
  for (const m of remainder.matchAll(PAIR_RE)) {
    pairs[m[1].trim()] = parseValue(m[2]);
    pairCount++;
  }
  if (pairCount > 0) {
    return { name, input: pairs, malformed: true };
  }

  // No named pairs — a single dangling value that parses to a plain object is
  // adopted as the whole arguments object (dangling `</arg_key>` case).
  const loneValues = [...remainder.matchAll(LONE_VALUE_RE)];
  if (loneValues.length === 1) {
    const parsed = parseValue(loneValues[0][1]);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { name, input: parsed as Record<string, unknown>, malformed: true };
    }
  }

  return { name, input: null, malformed: true };
}
