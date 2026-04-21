import type { ChatMessage, MessageContent } from '@/domain/models/chat';

/**
 * Creates the unified chat SSE event handler. Routes event.type to the
 * appropriate message mutation: initial_state merge, streaming, tool_call,
 * job_status, inline_ask completion, etc.
 */
export function createChatSseHandler(set: any, get: any): (event: any) => void {
  return (event: any) => {
    const currentState = get();
    const isCorrectContext =
      event.projectId === currentState.selectedProject &&
      event.featureName === currentState.selectedFeature;

    if (!isCorrectContext) {
      console.log(`[Store] 💬 Ignoring chat event from different context: ${event.projectId}/${event.featureName}`);
      return;
    }

    switch (event.type) {
      case 'initial_state': {
        const current = get().chatMessages;
        if (current.length === 0) {
          console.log('[Store] 💬 Loading initial chat messages:', event.messages.length);
          set({ chatMessages: event.messages });
          break;
        }
        const currentById = new Map<string, ChatMessage>(current.map((m: ChatMessage) => [m.id, m] as [string, ChatMessage]));
        const merged: ChatMessage[] = [];
        const seen = new Set<string>();

        for (const incoming of event.messages as ChatMessage[]) {
          const existing = currentById.get(incoming.id);
          if (existing && existing.contents.length > incoming.contents.length) {
            merged.push(existing);
          } else {
            merged.push(incoming);
          }
          seen.add(incoming.id);
        }

        for (const msg of current) {
          if (!seen.has(msg.id)) {
            merged.push(msg);
          }
        }

        console.log(`[Store] 💬 initial_state merge: ${event.messages.length} incoming, ${current.length} existing → ${merged.length} merged`);
        set({ chatMessages: merged });
        break;
      }

      case 'user_message':
        if (!get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
          get().addChatMessage(event.message);
        } else {
          console.log('[Store] 💬 Ignoring duplicate user_message event:', event.message.id);
        }
        break;

      case 'message_start':
        if (!get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
          get().addChatMessage(event.message);
        } else {
          console.log('[Store] 💬 Ignoring duplicate message_start event:', event.message.id);
        }
        break;

      case 'content_add': {
        if (!event.content) {
          console.warn('[Store] 💬 content_add: event.content is undefined, skipping');
          break;
        }
        const existingMsg = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
        if (existingMsg) {
          const isDuplicate = existingMsg.contents.some((c: MessageContent) =>
            c && c.type === event.content.type &&
            c.content === event.content.content &&
            c.metadata?.filePath === event.content.metadata?.filePath &&
            c.metadata?.timestamp === event.content.metadata?.timestamp
          );
          if (isDuplicate) {
            console.log('[Store] 💬 Ignoring duplicate content_add event');
            break;
          }
          get().updateChatMessage(event.messageId, {
            contents: [...existingMsg.contents, event.content]
          });
        } else {
          console.warn('[Store] 💬 content_add: message not found, creating placeholder:', event.messageId);
          get().addChatMessage({
            id: event.messageId,
            role: 'assistant',
            contents: [event.content],
            timestamp: new Date().toISOString(),
            isStreaming: true
          } as ChatMessage);
        }
        if (event.content?.type === 'downloaded') {
          setTimeout(() => get().refreshFileTree(), 1000);
        }
        break;
      }

      case 'message_snapshot': {
        const existing = get().chatMessages.find(
          (m: ChatMessage) => m.id === event.messageId
        );
        if (existing) {
          if (event.contentsCount >= existing.contents.length) {
            get().updateChatMessage(event.messageId, {
              contents: event.contents,
              isStreaming: true,
            });
            console.debug(`[Store] 💬 message_snapshot applied: ${event.contentsCount} contents (was ${existing.contents.length})`);
          }
        } else {
          get().addChatMessage({
            id: event.messageId,
            role: 'assistant',
            contents: event.contents,
            timestamp: new Date().toISOString(),
            isStreaming: true,
          } as ChatMessage);
          console.debug(`[Store] 💬 message_snapshot: created new message ${event.messageId}`);
        }
        break;
      }

      case 'content_update': {
        const message = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
        if (message) {
          if (event.contentIndex >= message.contents.length) {
            console.debug(`[Store] 💬 content_update: index ${event.contentIndex} out of bounds (length ${message.contents.length}), awaiting snapshot`);
            break;
          }
          const updatedContents = [...message.contents];
          const existing = updatedContents[event.contentIndex];
          updatedContents[event.contentIndex] = {
            ...existing,
            ...event.content,
            metadata: {
              ...existing?.metadata,
              ...event.content?.metadata,
            },
          };
          get().updateChatMessage(event.messageId, {
            contents: updatedContents,
            isStreaming: true
          });
        } else if (event.content) {
          console.warn('[Store] 💬 content_update: message not found, creating placeholder:', event.messageId);
          get().addChatMessage({
            id: event.messageId,
            role: 'assistant',
            contents: [event.content],
            timestamp: new Date().toISOString(),
            isStreaming: true
          } as ChatMessage);
        }
        break;
      }

      case 'content_append': {
        const appendMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
        if (appendMessage) {
          const appendContents = [...appendMessage.contents];
          if (appendContents[event.contentIndex]) {
            const oldContent = appendContents[event.contentIndex].content;
            const newContent = oldContent + event.delta;

            appendContents[event.contentIndex] = {
              ...appendContents[event.contentIndex],
              content: newContent
            };
            get().updateChatMessage(event.messageId, {
              contents: appendContents,
              isStreaming: true
            });
          }
        }
        break;
      }

      case 'content_remove': {
        const deleteMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
        if (deleteMessage) {
          const deletedContents = [...deleteMessage.contents];
          deletedContents.splice(event.contentIndex, 1);
          get().updateChatMessage(event.messageId, {
            contents: deletedContents,
            isStreaming: true
          });
        }
        break;
      }

      case 'thinking_collapse': {
        const collapseMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
        if (collapseMessage) {
          const collapseContents = [...collapseMessage.contents];
          if (collapseContents[event.contentIndex] && collapseContents[event.contentIndex].type === 'thinking') {
            collapseContents[event.contentIndex] = {
              ...collapseContents[event.contentIndex],
              metadata: {
                ...collapseContents[event.contentIndex].metadata,
                collapsed: true,
                durationMs: event.durationMs
              }
            };
            get().updateChatMessage(event.messageId, {
              contents: collapseContents,
              isStreaming: true
            });
          }
        }
        break;
      }

      case 'message_complete':
        get().updateChatMessage(event.messageId, { isStreaming: false });
        break;

      case 'messages_cleared': {
        set({ chatMessages: [] });
        // `scope` tells us how aggressive the backend collapse was:
        // - 'full' (Hard Reset / §17 hard_reset): BOTH trace.jsonl and
        //   feature.jsonl were collapsed + a user_reset boundary was
        //   appended. Wipe all feature-log caches (trace, breadcrumbs,
        //   user_turns, user_turn_metas) so stale rows do not linger in the
        //   Activity / Timeline tabs until a feature switch.
        // - 'chat' (DELETE /chat/messages, default): only trace.jsonl was
        //   collapsed. feature.jsonl (breadcrumbs, user_turn, user_turn_meta)
        //   is preserved so the LLM still remembers the conversation for the
        //   next turn. Drop only the local trace cache; keep breadcrumb and
        //   tier-badge data so they stay visible.
        // Falls back to 'chat' when older servers omit the field — the
        //   conservative, less destructive choice.
        const scope: 'chat' | 'full' = event.scope === 'full' ? 'full' : 'chat';
        if (scope === 'full') {
          get().clearFeatureLog?.();
        } else {
          set({
            traceLines: [],
            traceStatus: 'idle',
            traceError: undefined,
            traceKey: undefined,
          });
        }
        get().refreshFileTree();
        break;
      }

      case 'cancelled_message': {
        if (get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
          console.log('[Store] 💬 Ignoring duplicate cancelled_message (same ID):', event.message.id);
          break;
        }
        const incomingJobId = event.message.contents?.[0]?.metadata?.jobId;
        if (incomingJobId) {
          const unresolvedMsgs = get().chatMessages.filter((m: ChatMessage) =>
            m.contents.some((c: MessageContent) =>
              c && c.type === 'cancelled' &&
              c.metadata?.jobId === incomingJobId &&
              !c.metadata?.choiceSelected &&
              !c.metadata?.resolved
            )
          );
          for (const oldMsg of unresolvedMsgs) {
            const contentIndex = oldMsg.contents.findIndex((c: MessageContent) =>
              c && c.type === 'cancelled' && c.metadata?.jobId === incomingJobId
            );
            if (contentIndex !== -1) {
              const updatedContents = [...oldMsg.contents];
              updatedContents[contentIndex] = {
                ...updatedContents[contentIndex],
                metadata: {
                  ...updatedContents[contentIndex].metadata,
                  choiceSelected: 'resume',
                  resolvedLabel: 'Resumed',
                },
              };
              get().updateChatMessage(oldMsg.id, { contents: updatedContents });
              console.log('[Store] 💬 Auto-resolved stale cancelled_message for jobId:', incomingJobId, 'msgId:', oldMsg.id);
            }
          }
        }
        get().addChatMessage(event.message);
        break;
      }

      case 'job_status': {
        console.log('[Store] 📡 Received job_status event:', event.status, event.jobId);
        if (event.status === 'completed' || event.status === 'failed') {
          const currentState = get();
          if (currentState.jobStartPending && currentState.isRunning) {
            console.log('[Store] 🛡️ Ignoring job_status completion - new job start pending');
            get().refreshFileTree();
            break;
          }
          if (event.jobId && currentState.currentJobId && event.jobId !== currentState.currentJobId) {
            console.log(`[Store] 🛡️ Ignoring job_status for stale job ${event.jobId} (current: ${currentState.currentJobId})`);
            get().refreshFileTree();
            break;
          }
          const setRunning = currentState.setRunning;
          if (setRunning) {
            console.log('[Store] ✅ Job completed/failed, setting isRunning=false');
            setRunning(false);
          }
          get().refreshFileTree();
        } else if (event.status === 'running' || event.status === 'started') {
          if (get().jobStartPending) {
            console.log('[Store] ✅ Job started on worker, clearing jobStartPending via job_status');
            set({ jobStartPending: false });
          }
        }
        break;
      }

      case 'inline_ask_complete': {
        const intent = event.intent as 'ask' | 'work';
        const action = event.action as 'continue' | 'newJob' | 'redirect' | undefined;
        const inlineAskContext = get().inlineAskContext;
        console.log(`[Store] 💬 Inline ask complete: intent=${intent}, action=${action}, jobId=${event.jobId}`);

        if (intent === 'work' && inlineAskContext) {
          const noSession = event.noSession === true;

          const dismissInterruption = () => {
            const kanbanData = get().kanban;
            if (kanbanData?.interruption?.timestamp) {
              get().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
            }
          };

          const cleanupCancelledCard = () => {
            if (inlineAskContext.interruptedJobId) {
              get().removeCancelledMessage(inlineAskContext.interruptedJobId);
            }
          };

          const startFreshJob = (jobType?: string, agent?: string) => {
            dismissInterruption();
            cleanupCancelledCard();
            get().setInlineAskContext(null);

            const state = get() as any;
            const effectiveJobType = jobType || state.selectedJobType || 'design';
            const effectiveAgent = agent || state.selectedAgent || 'architect';

            import('@/infrastructure/http/api').then(({ clearSessionData, executeJob }) => {
              clearSessionData(
                inlineAskContext.projectId,
                inlineAskContext.featureName,
                state.selectedJobType || 'code'
              ).then(() => {
                console.log('[Store] ✅ Session cleared for fresh start');
              }).catch(() => {
                console.warn('[Store] ⚠️ Session clear failed, proceeding anyway');
              }).finally(() => {
                executeJob({
                  projectId: inlineAskContext.projectId,
                  featureName: inlineAskContext.featureName,
                  jobType: effectiveJobType,
                  agent: effectiveAgent,
                  overrideDirective: inlineAskContext.message,
                  chatSource: true,
                }).then((result) => {
                  console.log('[Store] ✅ Fresh job started:', result.jobId);
                  get().setRunning(true, result.jobId);
                  get().setLastJobFailed(false);
                }).catch((error) => {
                  console.error('[Store] ❌ Fresh job start failed:', error);
                  get().setRunning(false);
                });
              });
            });
          };

          if (noSession) {
            console.log('[Store] ⚠️ Work intent + noSession → starting fresh job');
            startFreshJob();
          } else if (action === 'redirect') {
            console.log('[Store] 🔀 Work + redirect → dismissing interruption, awaiting choice card');
            dismissInterruption();
            cleanupCancelledCard();
            get().setRunning(false);
            get().setInlineAskContext(null);
          } else if (action === 'newJob') {
            console.log('[Store] 🆕 Work + newJob → clear session, start fresh');
            startFreshJob();
          } else {
            console.log('[Store] 🔧 Work + continue → auto-continuing interrupted job:', inlineAskContext.interruptedJobId);

            dismissInterruption();
            cleanupCancelledCard();
            get().setRunning(true, inlineAskContext.interruptedJobId);
            get().setInlineAskContext(null);

            import('@/infrastructure/http/api').then(({ continueJob }) => {
              continueJob(
                inlineAskContext.interruptedJobId,
                inlineAskContext.projectId,
                inlineAskContext.featureName,
                inlineAskContext.message,
                true
              ).then((result) => {
                console.log('[Store] ✅ Auto-continue succeeded:', result.jobId);
                get().setRunning(true, result.jobId);
                get().setLastJobFailed(false);
              }).catch((error) => {
                console.error('[Store] ❌ Auto-continue failed:', error);
                get().setRunning(false);
              });
            });
          }
        } else {
          console.log('[Store] 💬 Ask intent → keeping interruption state, isRunning=false');
          get().setRunning(false);
          get().setInlineAskContext(null);
        }
        break;
      }
    }
  };
}
