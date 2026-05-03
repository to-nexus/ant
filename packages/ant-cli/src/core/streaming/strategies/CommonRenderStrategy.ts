/**
 * CommonRenderStrategy - Main rendering strategy coordinator
 * 
 * Delegates work to specialized modules:
 * - ResponseRenderer: thinking & text responses
 * - FileRenderer: file operations (create, edit, append, delete)
 */

import { IRenderStrategy } from './IRenderStrategy';
import { ParsedAction } from '../types';
import { FileRegistry } from '../state/FileRegistry';
import { ChatAPIClient } from '../../adapters/ChatAPIClient';
import { SpecialTagTransformer } from '../transformers/SpecialTagTransformer';
import { UserLanguage } from '../../utils/languageDetector';
import { GitPort, FileSystemPort } from '../../ports';
import { FileTreeUpdatePort } from '../../ports/fileTree';
import { ResponseRenderer } from './common/ResponseRenderer';
import { FileRenderer } from './common/FileRenderer';
import { detectCrossAxisLeak, transformAndStrip } from '../OutputTagRegistry';

export class CommonRenderStrategy implements IRenderStrategy {
  private chatAPI: ChatAPIClient;
  private responseRenderer: ResponseRenderer;
  private fileRenderer: FileRenderer;
  private tagTransformer: SpecialTagTransformer;  // ✅ Store for explicitDone access
  private planContentIndex: string | undefined;
  private planTaskTitle: string | undefined;
  // Accumulates every `plan_content` chunk so the terminal `plan` emit
  // can carry the full text in `metadata.content`. Intermediate
  // `plan_generating` emits are LIVE_ONLY (see LLMResponseService
  // PROGRESS_STATUS_TYPES), so the only line persisted to chat.jsonl is
  // the final `plan` one — replay reproduces the card from that single
  // line.
  private planContentBuffer: string = '';
  private parallelTaskName: string | undefined;
  private taskResponseIndex: string | undefined;
  private taskResponseBuffer: string = '';
  private userLanguage: UserLanguage;
  
  constructor(
    chatAPI: ChatAPIClient,
    userLanguage?: UserLanguage,
    gitPort?: GitPort,
    fileSystem?: FileSystemPort,
    writeImmediately: boolean = false,
    jobType?: 'code' | 'design' | 'planner',
    featurePath?: string,
    codebasePath?: string,
    fileTreeUpdate?: FileTreeUpdatePort,
    onFileTouched?: (filePath: string) => void,
    /**
     * For `jobType === 'code'`, distinguishes plan vs execute phase.
     * Plan phase rejects `codebase/` writes via the same gate that
     * design / planner use (see FileRenderer codebase mutation gate).
     * Defaults to `'execute'` semantics when omitted.
     */
    codePhase?: 'plan' | 'execute',
  ) {
    this.chatAPI = chatAPI;
    this.userLanguage = userLanguage || 'en';

    this.tagTransformer = new SpecialTagTransformer(this.userLanguage);

    this.responseRenderer = new ResponseRenderer(chatAPI, this.tagTransformer);
    this.fileRenderer = new FileRenderer({
      chatAPI,
      gitPort,
      fileSystem,
      fileTreeUpdate,
      writeImmediately,
      jobType,
      codePhase,
      featurePath,
      codebasePath,
      onFileTouched,
    });
  }
  
  async render(action: ParsedAction, registry: FileRegistry): Promise<void> {
    switch (action.type) {
      case 'thinking':
        await this.responseRenderer.renderThinking(action);
        break;
        
      case 'response':
        if (this.parallelTaskName) {
          const content = action.data.content;
          if (!content || !content.trim()) break;

          // Accumulate the chunk verbatim. Per-chunk `tagTransformer.transform`
          // is unsafe here for two reasons:
          //   (a) toggle-token boundaries split tags (`<rep`, `ly>...`),
          //       so first-match-only transforms drop bodies as raw text;
          //   (b) `consumed=true` in the old branch caused the entire
          //       chunk — including the `<reply>` body the user expected
          //       — to be `break`'d and lost from the card.
          // The terminal `finalize()` runs `transformAndStrip` on the full
          // buffer, where every tag is guaranteed to be complete.
          this.taskResponseBuffer += content;

          // First chunk mints the cardId via the progress status. Subsequent
          // chunks stream into the same TURN_BUFFER pendingCard — they don't
          // append jsonl lines because `task_response_streaming` is a
          // PROGRESS_STATUS type. The terminal `task_response` line is
          // emitted from `finalize()` with the accumulated buffer as
          // `metadata.content`, so chat.jsonl carries exactly one line per
          // task_response card.
          if (this.taskResponseIndex === undefined) {
            this.taskResponseIndex = await this.chatAPI.showChatStatus('task_response_streaming', {
              content: this.taskResponseBuffer,
              taskName: this.parallelTaskName,
            });
          } else {
            await this.chatAPI.streamTaskResponseChunk(this.taskResponseIndex, content);
          }
        } else {
          await this.responseRenderer.renderResponse(action);
        }
        break;
        
      case 'file_start':
        await this.fileRenderer.renderFileStart(action, registry);
        break;
        
      case 'file_content':
        await this.fileRenderer.renderFileContent(action, registry);
        break;
        
      case 'file_end':
        await this.fileRenderer.renderFileEnd(action, registry);
        break;
      
      case 'plan_start':
        this.planContentIndex = await this.chatAPI.showChatStatus('plan_generating', {
          ...(this.planTaskTitle ? { taskName: this.planTaskTitle } : {})
        });
        break;
        
      case 'plan_content': {
        const planChunk = action.data.content || '';
        if (!planChunk) break;
        this.planContentBuffer += planChunk;
        // Defensive lazy-mint: in normal flow `plan_start` lands first
        // and seeds `planContentIndex`. If a parser variant or partial
        // retry stream skips it we still anchor a single cardId here so
        // every subsequent chunk lands on the same pendingCard rather
        // than fragmenting the TURN_BUFFER.
        if (this.planContentIndex === undefined) {
          this.planContentIndex = await this.chatAPI.showChatStatus('plan_generating', {
            ...(this.planTaskTitle ? { taskName: this.planTaskTitle } : {})
          });
        }
        if (this.planContentIndex) {
          await this.chatAPI.streamPlanChunk(this.planContentIndex, planChunk);
        }
        break;
      }
        
      case 'plan_end':
        if (this.planContentIndex !== undefined) {
          // Persist the full accumulated plan text on the terminal `plan`
          // line so the FE projector can reproduce the final
          // card from a single jsonl entry. The live path keeps
          // `_preserveContent` so the already-appended UI content is
          // untouched.
          //
          // `transformAndStrip` is a no-op on a well-formed plan body
          // (JSON without nested canonical literals). When the LLM
          // violates the contract and slips a `<reply>` / `<done>` /
          // `<file>` literal into the JSON, this layer scrubs the raw
          // marker from the persisted card metadata. `detectCrossAxisLeak`
          // additionally surfaces a dev-mode warning so the violation
          // is visible during prompt iteration instead of being silently
          // scrubbed.
          const planLeaks = detectCrossAxisLeak(this.planContentBuffer, 'artifact');
          if (planLeaks.length > 0) {
            console.warn(
              `[CommonRenderStrategy] <plan> body contains cross-axis tags: ${planLeaks.join(', ')}. Stripped from card metadata. (See docs/architecture/36-output-tag-matrix.md Invariant 2.)`,
            );
          }
          const cleanedPlan = transformAndStrip(
            this.planContentBuffer,
            this.userLanguage,
          );
          await this.chatAPI.showChatStatus('plan', {
            content: cleanedPlan,
            ...(this.planTaskTitle ? { taskName: this.planTaskTitle } : {}),
            _mergeIndex: this.planContentIndex,
            _preserveContent: true,
          });
          this.planContentIndex = undefined;
          this.planContentBuffer = '';
        }
        break;
      
      case 'clarify_start':
        // Re-inject placeholder (typing indicator) while clarify content is being generated
        await this.chatAPI.showChatStatus('placeholder');
        break;

      case 'task_added':
        // Side-channel action emitted by the decompose stream parser.
        // Consumed by the decompose llmCaller's `onAction` hook (Kanban
        // partial broadcast). No chat rendering — `<tasks>` is suppressed
        // by `SpecialTagTransformer` and the Kanban board owns the visual.
        break;

      default:
        console.warn(`[CommonRenderStrategy] Unknown action type: ${action.type}`);
    }
  }
  
  async finalize(hasToolCalls: boolean = false): Promise<void> {
    await this.fileRenderer.finalize();

    if (this.taskResponseIndex !== undefined) {
      // `<done>true</done>` side-effect — the parallel task_response
      // buffer path never runs per-chunk `tagTransformer.transform`
      // (see `render` case 'response' rationale above), so
      // `_explicitDone` would stay false even when the LLM emitted a
      // terminal `<done>` marker. Downstream routers (design/code
      // docGen / execute) branch on `llmResponse.done` which is
      // sourced from `getExplicitDone()`; missing this scan keeps the
      // node looping until the call-budget safety net fires. See the
      // `spare-keeping-metal` RCA.
      this.tagTransformer.scanExplicitDone(this.taskResponseBuffer);

      // Persist the full accumulated text on the terminal line so the FE
      // projector can reproduce the card from this single jsonl entry.
      // `_mergeIndex` keeps the cardId stable so `appendChatStatus` clears
      // the matching pendingCard from the TURN_BUFFER on transition.
      //
      // `transformAndStrip` runs the registry's transform hooks over the
      // full buffer — at this point every tag is complete (the streaming
      // ambiguity that breaks per-chunk transform is gone). Result: the
      // `<reply>` body is rendered verbatim, suppressed-axis tags
      // disappear, and no raw `<reply>` / `<done>` / `<plan>` literal
      // ever reaches `chat.jsonl`'s task_response card.
      const cleanedContent = transformAndStrip(
        this.taskResponseBuffer,
        this.userLanguage,
      ).trim();
      await this.chatAPI.showChatStatus('task_response', {
        content: cleanedContent,
        taskName: this.parallelTaskName,
        _mergeIndex: this.taskResponseIndex,
      });
      this.taskResponseIndex = undefined;
      this.taskResponseBuffer = '';
    }
    
    if (!hasToolCalls) {
      await this.chatAPI.finalizeMessage();
    }
  }
  
  /**
   * Get FileRenderer instance for direct access
   * Used by StreamOrchestrator to wait for file operations
   */
  getFileRenderer(): FileRenderer {
    return this.fileRenderer;
  }
  
  /**
   * Check if LLM explicitly output <done>true</done>
   * Used by execute to determine task completion
   */
  getExplicitDone(): boolean {
    return this.tagTransformer.explicitDone;
  }
  
  /**
   * Pin the design-job target filename guard for the current task.
   * Delegates to the underlying `FileRenderer` so callers don't have to
   * reach into `getFileRenderer()`.
   */
  setExpectedTargetFile(expectedTargetFile: string | undefined): void {
    this.fileRenderer.setExpectedTargetFile(expectedTargetFile);
  }

  /**
   * Set task title for plan card header display
   */
  setPlanTaskTitle(title: string): void {
    this.planTaskTitle = title;
  }
  
  /**
   * Enable TaskResponseCard routing for worker graph nodes.
   * When set, `response` actions are routed to task_response cards
   * instead of plain text, providing parallel-safe contained output.
   */
  setParallelTaskName(name: string): void {
    this.parallelTaskName = name;
  }
  
  /**
   * Reset state for stream retry
   */
  reset(): void {
    this.fileRenderer.reset();
    this.taskResponseIndex = undefined;
    this.taskResponseBuffer = '';
    this.planContentIndex = undefined;
    this.planContentBuffer = '';
  }
}
