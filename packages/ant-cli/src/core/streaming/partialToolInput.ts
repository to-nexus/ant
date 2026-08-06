/**
 * PartialToolInputParser — incremental extraction from a STREAMING tool-call
 * argument JSON string.
 *
 * Providers stream tool-call arguments as raw JSON fragments
 * (`tool_use_delta.partialInput`). For file-writing tools
 * (`create_file` / `append_file` / `edit_file`) live rendering needs two
 * things BEFORE the JSON is complete:
 *
 *   1. `path` as soon as its string value closes → open the file card shell.
 *   2. The content field's unescaped prefix as it streams → card_output
 *      deltas + progressive disk write.
 *
 * The parser is a character-level scanner over a FLAT JSON object whose
 * values are strings / numbers / booleans / null (file-writing tool inputs
 * are flat by schema). Nested objects/arrays are skipped by depth counting —
 * their contents are never surfaced incrementally.
 *
 * Fragment boundaries are arbitrary: a fragment may end mid-escape
 * (`...\`), mid-`\uXXXX`, or mid-key. All states carry across `push()`
 * calls. Consumers must still treat the terminal `tool_use` event's parsed
 * input as authoritative — this parser is a rendering/progress channel,
 * not the execution channel.
 */

export interface PartialToolInputEvents {
  /** A non-content top-level string field completed (e.g. `path`). */
  onField?: (key: string, value: string) => void;
  /** Unescaped fragment of the designated content field. */
  onContentDelta?: (delta: string) => void;
  /** The designated content field's string value closed. */
  onContentComplete?: () => void;
}

type ScanState =
  | 'before_object'   // consume until `{`
  | 'expect_key'      // inside object, before a key string (or `}`)
  | 'in_key'          // inside key string
  | 'expect_colon'
  | 'expect_value'
  | 'in_string'       // inside a string VALUE
  | 'in_primitive'    // number / true / false / null
  | 'in_nested'       // skipping a nested object/array value
  | 'after_value'     // expect `,` or `}`
  | 'done';

export class PartialToolInputParser {
  private readonly contentField: string;
  private readonly events: PartialToolInputEvents;

  private state: ScanState = 'before_object';
  private currentKey = '';
  private currentValue = '';
  private isContentValue = false;
  /** Escape carry-over: '' none; '\\' seen backslash; '\\u' + hex digits so far. */
  private pendingEscape = '';
  private nestedDepth = 0;
  private nestedInString = false;
  private nestedEscape = false;

  private fields = new Map<string, string>();
  private contentSoFar = '';
  private contentComplete = false;
  private rawSoFar = '';

  constructor(opts: { contentField: string; events?: PartialToolInputEvents }) {
    this.contentField = opts.contentField;
    this.events = opts.events ?? {};
  }

  /** All completed top-level string fields (content field included once complete). */
  getField(key: string): string | undefined {
    return this.fields.get(key);
  }

  /** Unescaped content streamed so far (prefix of the final value). */
  getContent(): string {
    return this.contentSoFar;
  }

  isContentComplete(): boolean {
    return this.contentComplete;
  }

  /** Raw JSON accumulated so far (for diagnostics / fallback parse). */
  getRaw(): string {
    return this.rawSoFar;
  }

  push(fragment: string): void {
    this.rawSoFar += fragment;
    for (let i = 0; i < fragment.length; i++) {
      const ch = fragment[i];
      switch (this.state) {
        case 'before_object':
          if (ch === '{') this.state = 'expect_key';
          break;

        case 'expect_key':
          if (ch === '"') {
            this.currentKey = '';
            this.state = 'in_key';
          } else if (ch === '}') {
            this.state = 'done';
          }
          // ignore whitespace / commas
          break;

        case 'in_key': {
          const out = this.consumeStringChar(ch);
          if (out === null) break;             // escape in progress
          if (out === END_OF_STRING) {
            this.state = 'expect_colon';
          } else {
            this.currentKey += out;
          }
          break;
        }

        case 'expect_colon':
          if (ch === ':') this.state = 'expect_value';
          break;

        case 'expect_value':
          if (ch === '"') {
            this.currentValue = '';
            this.isContentValue = this.currentKey === this.contentField;
            this.state = 'in_string';
          } else if (ch === '{' || ch === '[') {
            this.nestedDepth = 1;
            this.nestedInString = false;
            this.nestedEscape = false;
            this.state = 'in_nested';
          } else if (!/\s/.test(ch)) {
            this.currentValue = ch;
            this.state = 'in_primitive';
          }
          break;

        case 'in_string': {
          const out = this.consumeStringChar(ch);
          if (out === null) break;             // escape in progress
          if (out === END_OF_STRING) {
            this.finishStringValue();
          } else if (this.isContentValue) {
            this.contentSoFar += out;
            this.events.onContentDelta?.(out);
          } else {
            this.currentValue += out;
          }
          break;
        }

        case 'in_primitive':
          if (ch === ',' || ch === '}') {
            this.fields.set(this.currentKey, this.currentValue.trim());
            this.events.onField?.(this.currentKey, this.currentValue.trim());
            this.state = ch === '}' ? 'done' : 'expect_key';
          } else {
            this.currentValue += ch;
          }
          break;

        case 'in_nested':
          if (this.nestedInString) {
            if (this.nestedEscape) this.nestedEscape = false;
            else if (ch === '\\') this.nestedEscape = true;
            else if (ch === '"') this.nestedInString = false;
          } else if (ch === '"') {
            this.nestedInString = true;
          } else if (ch === '{' || ch === '[') {
            this.nestedDepth++;
          } else if (ch === '}' || ch === ']') {
            this.nestedDepth--;
            if (this.nestedDepth === 0) this.state = 'after_value';
          }
          break;

        case 'after_value':
          if (ch === ',') this.state = 'expect_key';
          else if (ch === '}') this.state = 'done';
          break;

        case 'done':
          break;
      }
    }
  }

  /**
   * Consume one character of an in-progress JSON string (key or value).
   * Returns:
   *  - a decoded string chunk (possibly multi-char for surrogate-free \uXXXX)
   *  - `null` when the char was absorbed into a pending escape sequence
   *  - END_OF_STRING sentinel when the closing quote was reached
   */
  private consumeStringChar(ch: string): string | null | typeof END_OF_STRING {
    if (this.pendingEscape) {
      if (this.pendingEscape === '\\') {
        switch (ch) {
          case '"': this.pendingEscape = ''; return '"';
          case '\\': this.pendingEscape = ''; return '\\';
          case '/': this.pendingEscape = ''; return '/';
          case 'b': this.pendingEscape = ''; return '\b';
          case 'f': this.pendingEscape = ''; return '\f';
          case 'n': this.pendingEscape = ''; return '\n';
          case 'r': this.pendingEscape = ''; return '\r';
          case 't': this.pendingEscape = ''; return '\t';
          case 'u': this.pendingEscape = '\\u'; return null;
          default:
            // Invalid escape — emit verbatim rather than dropping bytes.
            this.pendingEscape = '';
            return ch;
        }
      }
      // \uXXXX accumulation
      this.pendingEscape += ch;
      if (this.pendingEscape.length === 6) { // "\u" + 4 hex
        const hex = this.pendingEscape.slice(2);
        this.pendingEscape = '';
        const code = Number.parseInt(hex, 16);
        return Number.isNaN(code) ? '' : String.fromCharCode(code);
      }
      return null;
    }
    if (ch === '\\') {
      this.pendingEscape = '\\';
      return null;
    }
    if (ch === '"') return END_OF_STRING;
    return ch;
  }

  private finishStringValue(): void {
    if (this.isContentValue) {
      this.fields.set(this.currentKey, this.contentSoFar);
      this.contentComplete = true;
      this.events.onContentComplete?.();
    } else {
      this.fields.set(this.currentKey, this.currentValue);
      this.events.onField?.(this.currentKey, this.currentValue);
    }
    this.isContentValue = false;
    this.state = 'after_value';
  }
}

const END_OF_STRING = Symbol('end-of-string');

/**
 * Content field per file-writing tool. Tools not listed here have no
 * live-renderable content field (their inputs render terminally).
 */
export const TOOL_CONTENT_FIELDS: Record<string, string> = {
  create_file: 'content',
  append_file: 'content',
  edit_file: 'new_str',
};
