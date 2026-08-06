/**
 * ToolFileStreamer — live rendering of file-writing TOOL CALLS.
 *
 * Consumes the adapter-level `tool_use_delta` / `tool_use` events for the
 * file-writing tools (`create_file` / `append_file` / `edit_file`) and drives
 * the live file-card chat surface:
 *
 *   path parsed  → sink.startFileCreation(path)   (card shell opens)
 *   content grows → sink.streamFileContent(path, lines)  (card_output deltas)
 *   terminal tool_use → flushed; the tool HANDLER settles the card
 *                       (completeFileCreation / completeFileEdit) after the
 *                       authoritative write.
 *
 * Disk writes stay with the tool handler (authoritative, conflict-gated).
 * On `max_tokens` truncation the terminal `tool_use` never arrives; callers
 * read `getOpenToolFile()` for the salvage context (path + parsed content
 * prefix).
 *
 * Tier-B providers (Gemini) never emit `tool_use_delta`; every method here
 * degrades to a no-op and rendering is terminal-only (UX policy §1).
 */

import type { LLMStreamEvent } from '../ports/llm';
import { PartialToolInputParser, TOOL_CONTENT_FIELDS } from './partialToolInput';
import { LineBufferManager } from './strategies/common/LineBuffer';

/** Chat surface subset the streamer drives. ChatAPIClient satisfies it. */
export interface ToolFileStreamSink {
  startFileCreation(filePath: string): Promise<void>;
  streamFileContent(filePath: string, content: string): Promise<void>;
  startFileEdit(filePath: string): Promise<void>;
  streamFileDiff(filePath: string, diffBefore: string, diffAfter: string): Promise<void>;
}

export interface OpenToolFileContext {
  toolName: string;
  /** Tool-call id the fragments belonged to. */
  toolUseId: string;
  /** Undefined when truncation hit before the path string closed. */
  path?: string;
  /** Unescaped content prefix parsed so far (create/append: `content`, edit: `new_str`). */
  contentSoFar: string;
  /** Trailing slice of `contentSoFar` for resume hints (bounded by TOOL_TAIL_CAP). */
  tailContent: string;
}

/** Rolling tail cap — resume hints stay bounded. */
const TOOL_TAIL_CAP = 240;

interface ActiveToolStream {
  toolName: string;
  parser: PartialToolInputParser;
  /** Set once the path field closed and the shell was opened. */
  path?: string;
  shellOpened: boolean;
  /** Buffered content deltas received before the path was known (create/append only — path streams first by schema, but never rely on it). */
  preShellContent: string;
  completed: boolean;
}

export class ToolFileStreamer {
  private readonly sink: ToolFileStreamSink;
  private readonly lineBuffer = new LineBufferManager();
  private readonly active = new Map<string, ActiveToolStream>();
  /** Insertion-ordered ids so getOpenToolFile can return the last open stream. */
  private readonly order: string[] = [];
  /** Serializes async sink calls so line batches stay ordered per file. */
  private chain: Promise<void> = Promise.resolve();

  constructor(sink: ToolFileStreamSink) {
    this.sink = sink;
  }

  /**
   * Feed one adapter stream event. Non-file-writing tools and unrelated
   * event types are ignored. Fire-and-forget: sink calls are serialized
   * internally; await `settle()` before finalizing the stream.
   */
  handleEvent(event: LLMStreamEvent): void {
    if (event.type === 'tool_use_delta' && event.toolUseDelta) {
      const { toolUseId, name, partialInput } = event.toolUseDelta;
      const contentField = TOOL_CONTENT_FIELDS[name];
      if (!contentField) return;

      let stream = this.active.get(toolUseId);
      if (!stream) {
        stream = this.createStream(toolUseId, name, contentField);
        this.active.set(toolUseId, stream);
        this.order.push(toolUseId);
      }
      stream.parser.push(partialInput);
      return;
    }

    if (event.type === 'tool_use' && event.toolUse) {
      const stream = this.active.get(event.toolUse.id);
      if (stream) this.finishStream(stream);
    }
  }

  /** Await all queued sink calls (call before stream finalize). */
  async settle(): Promise<void> {
    await this.chain;
  }

  /**
   * Salvage context for a tool call truncated before its terminal
   * `tool_use` event (max_tokens). Returns the LAST open stream — at most
   * one tool call can be mid-generation when the stream dies.
   */
  getOpenToolFile(): OpenToolFileContext | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const stream = this.active.get(this.order[i]);
      if (stream && !stream.completed) {
        const content = stream.parser.getContent();
        return {
          toolName: stream.toolName,
          toolUseId: this.order[i],
          path: stream.path,
          contentSoFar: content,
          tailContent: content.slice(-TOOL_TAIL_CAP),
        };
      }
    }
    return null;
  }

  /** Paths whose card shells were opened this stream (open or completed). */
  getStreamedPaths(): string[] {
    const paths: string[] = [];
    for (const id of this.order) {
      const s = this.active.get(id);
      if (s?.path && s.shellOpened) paths.push(s.path);
    }
    return paths;
  }

  private createStream(toolUseId: string, name: string, contentField: string): ActiveToolStream {
    const stream: ActiveToolStream = {
      toolName: name,
      parser: undefined as unknown as PartialToolInputParser,
      shellOpened: false,
      preShellContent: '',
      completed: false,
    };
    stream.parser = new PartialToolInputParser({
      contentField,
      events: {
        onField: (key, value) => {
          if (key === 'path' && !stream.path && value) {
            stream.path = value;
            this.openShell(stream, toolUseId);
          }
        },
        onContentDelta: (delta) => {
          if (!stream.shellOpened) {
            // Path not parsed yet (schema orders path first, but a provider
            // may reorder) — buffer until the shell can open.
            stream.preShellContent += delta;
            return;
          }
          this.emitContent(stream, delta);
        },
      },
    });
    return stream;
  }

  private openShell(stream: ActiveToolStream, _toolUseId: string): void {
    const path = stream.path!;
    stream.shellOpened = true;
    this.enqueue(async () => {
      if (stream.toolName === 'edit_file') {
        await this.sink.startFileEdit(path);
      } else {
        await this.sink.startFileCreation(path);
      }
    });
    if (stream.preShellContent) {
      const buffered = stream.preShellContent;
      stream.preShellContent = '';
      this.emitContent(stream, buffered);
    }
  }

  private emitContent(stream: ActiveToolStream, delta: string): void {
    const path = stream.path!;
    const lines = this.lineBuffer.addContent(path, delta);
    if (lines.length === 0) return;
    const batch = lines.join('\n') + '\n';
    this.enqueue(async () => {
      if (stream.toolName === 'edit_file') {
        // Live edit preview: new_str streams into the green (after) block.
        await this.sink.streamFileDiff(path, '', batch);
      } else {
        await this.sink.streamFileContent(path, batch);
      }
    });
  }

  private finishStream(stream: ActiveToolStream): void {
    if (stream.completed) return;
    stream.completed = true;
    if (!stream.path || !stream.shellOpened) return;
    const path = stream.path;
    const remaining = this.lineBuffer.getRemainingBuffer(path);
    this.lineBuffer.clear(path);
    if (remaining) {
      this.enqueue(async () => {
        if (stream.toolName === 'edit_file') {
          await this.sink.streamFileDiff(path, '', remaining);
        } else {
          await this.sink.streamFileContent(path, remaining);
        }
      });
    }
    // Terminal card settlement (completeFileCreation / completeFileEdit)
    // belongs to the tool handler after the authoritative disk write.
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((error) => {
      // Chat-surface failures must never break the LLM stream — log and
      // keep the chain alive.
      console.warn('⚠️ [ToolFileStreamer] sink call failed:', error);
    });
  }
}
