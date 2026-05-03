/**
 * Chat SSE handler — Phase 10 chat-SSOT model.
 *
 * Five event types only (mirror of `@ant/shared` ChatSseEvent):
 *
 *   chat_initial_state          — full snapshot on SSE open / reconnect.
 *   chat_event_appended         — single ChatLine appended to chat.jsonl.
 *   streaming_delta             — in-flight chunk for text/thinking/card_output.
 *   streaming_buffer_snapshot   — per-(turnId,workerScope) buffer reset.
 *   events_cleared              — Hard Reset / Chat Clear.
 *
 * Other events that share the same SSE channel today (`job_status`,
 * `inline_ask_complete`) keep their existing routing because they are
 * NOT chat-events under the chat-SSOT (they live on the kanban /
 * inline-ask contracts but are bridged through the chat handler for
 * historical reasons — see `useJobExecution`).
 */

import type {
  BufferKey,
  StreamingBuffer,
} from '@/domain/store/selectors/chat';
import type { ChatSseEvent, ChatLine, TurnBufferSnapshotMap } from '@ant/shared';
import {
  enqueueStreamingDelta,
  flushStreamingDeltaBatch,
} from './streamingDeltaBatch';

const MAIN_WORKER_SCOPE = '_main_';

function bufferKey(turnId: string, workerScope?: string | null): BufferKey {
  return `${turnId}:${workerScope || MAIN_WORKER_SCOPE}`;
}

function snapshotsToMap(turnBuffers: TurnBufferSnapshotMap): Record<BufferKey, StreamingBuffer> {
  const out: Record<BufferKey, StreamingBuffer> = {};
  for (const snap of Object.values(turnBuffers)) {
    const key = bufferKey(snap.turnId, snap.workerScope);
    out[key] = {
      turnId: snap.turnId,
      workerScope: snap.workerScope || MAIN_WORKER_SCOPE,
      text: snap.text,
      thinking: snap.thinking,
      pendingCards: snap.pendingCards,
    };
  }
  return out;
}

export function createChatSseHandler(set: any, get: any): (event: any) => void {
  return (event: any) => {
    const currentState = get();
    const isChatEvent =
      event &&
      typeof event.type === 'string' &&
      (event.type === 'chat_initial_state' ||
        event.type === 'chat_event_appended' ||
        event.type === 'streaming_delta' ||
        event.type === 'streaming_buffer_snapshot' ||
        event.type === 'events_cleared');

    // Non-chat events (job_status, inline_ask_complete) still arrive on
    // this channel for legacy reasons. Forward to the dedicated
    // handlers and skip projector logic.
    if (!isChatEvent) {
      handleNonChatEvent(event, set, get);
      return;
    }

    const isCorrectContext =
      event.projectId === currentState.selectedProject &&
      event.featureName === currentState.selectedFeature;

    if (!isCorrectContext) {
      console.log(`[Store] 💬 Ignoring chat event from different context: ${event.projectId}/${event.featureName}`);
      return;
    }

    const chatEvent = event as ChatSseEvent;

    switch (chatEvent.type) {
      case 'chat_initial_state': {
        // Hydration replaces the substrate wholesale — drop any in-flight
        // batched deltas to avoid them landing on top of the new snapshot.
        flushStreamingDeltaBatch(get);
        const buffers = snapshotsToMap(chatEvent.turnBuffers);
        get().replaceChatEvents(chatEvent.events, buffers, chatEvent.serverTs);
        console.log(
          `[Store] 💬 chat_initial_state: ${chatEvent.events.length} events, ${Object.keys(buffers).length} buffers`,
        );
        break;
      }

      case 'chat_event_appended': {
        const line: ChatLine = chatEvent.event;
        // Drop snapshot-stale events (producedAt < lastChatSnapshotTs).
        const last = get().lastChatSnapshotTs as string | undefined;
        if (last && chatEvent.producedAt < last) {
          console.debug(`[Store] 💬 dropping stale chat_event_appended (${chatEvent.producedAt} < ${last})`);
          break;
        }
        // Finalize MUST observe every preceding delta so the durable
        // line never appears before its accumulated streaming chunks.
        flushStreamingDeltaBatch(get);
        get().appendChatEvent(line);
        // file_create / file_edit / downloaded refresh the file tree.
        if (line.type === 'chat_status') {
          if (
            line.statusType === 'file_create' ||
            line.statusType === 'file_edit' ||
            line.statusType === 'file_delete' ||
            line.statusType === 'downloaded'
          ) {
            setTimeout(() => get().refreshFileTree?.(), 1000);
          }
        }
        break;
      }

      case 'streaming_delta': {
        enqueueStreamingDelta(get, {
          turnId: chatEvent.turnId,
          workerScope: chatEvent.workerScope,
          kind: chatEvent.kind,
          cardId: chatEvent.cardId,
          chunk: chatEvent.chunk,
          producedAt: chatEvent.producedAt,
        });
        break;
      }

      case 'streaming_buffer_snapshot': {
        // The snapshot OVERWRITES the buffer for this scope, so any
        // chunks we have queued are about to be invalidated. Flush them
        // first so they land before the snapshot replaces the entry —
        // then the snapshot wins as the authoritative state.
        flushStreamingDeltaBatch(get);
        get().replaceStreamingBuffer({
          turnId: chatEvent.turnId,
          workerScope: chatEvent.workerScope,
          text: chatEvent.text,
          thinking: chatEvent.thinking,
          pendingCards: chatEvent.pendingCards,
          producedAt: chatEvent.producedAt,
        });
        break;
      }

      case 'events_cleared': {
        flushStreamingDeltaBatch(get);
        get().clearChatEvents(chatEvent.scope);
        // `scope='full'` means the BE collapsed feature.jsonl too;
        // wipe FE breadcrumb cache so the Timeline tab drops stale rows.
        if (chatEvent.scope === 'full') {
          get().clearFeatureLog?.();
        }
        get().refreshFileTree?.();
        break;
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Non-chat events sharing the channel (job_status, inline_ask_complete).
// Phase 14 will move these onto their own SSE topic; for now we keep
// the historical routing intact.
// ═══════════════════════════════════════════════════════════════════════

function handleNonChatEvent(event: any, set: any, get: any) {
  if (!event) return;
  const currentState = get();
  if (
    event.projectId !== undefined &&
    event.projectId !== currentState.selectedProject
  ) {
    return;
  }
  if (
    event.featureName !== undefined &&
    event.featureName !== currentState.selectedFeature
  ) {
    return;
  }

  switch (event.type) {
    case 'job_status': {
      console.log('[Store] 📡 Received job_status event:', event.status, event.jobId);
      if (event.status === 'completed' || event.status === 'failed') {
        const cs = get();

        // Timeline + file tree refresh always run for events on the
        // selected feature — `loadFeatureBreadcrumbs` re-reads the entire
        // feature.jsonl (idempotent), so stale jobIds and pending starts
        // do not invalidate the refresh. The stale / pending guards
        // below only protect the run-state transition (setRunning false)
        // from being clobbered by an out-of-order completion.
        get().refreshFileTree?.();
        const project = cs.selectedProject;
        const feature = cs.selectedFeature;
        if (project && feature) {
          void get().loadFeatureBreadcrumbs?.(project, feature);
        }

        if (cs.jobStartPending && cs.isRunning) {
          console.log('[Store] 🛡️ Skipping setRunning(false) - new job start pending');
          break;
        }
        if (event.jobId && cs.currentJobId && event.jobId !== cs.currentJobId) {
          console.log(`[Store] 🛡️ Skipping setRunning(false) for stale job ${event.jobId} (current: ${cs.currentJobId})`);
          break;
        }
        cs.setRunning?.(false);
      } else if (event.status === 'running' || event.status === 'started') {
        if (get().jobStartPending) {
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

        // chat-SSOT — when the user pivots to a fresh job, the
        // interrupted job's cancelled card must flip to "Dismissed".
        // BE `/job/dismiss` runs `resolveAllCancelledForJob` so the
        // server emits a `choice_resolved` SSE that folds the card.
        const dismissInterruptedJobIfAny = async () => {
          if (!inlineAskContext.interruptedJobId) return;
          try {
            const { dismissInterruptedJob } = await import('@/infrastructure/http/api');
            await dismissInterruptedJob(
              inlineAskContext.projectId,
              inlineAskContext.featureName,
              inlineAskContext.interruptedJobId,
            );
          } catch (err) {
            console.warn('[Store] dismissInterruptedJob failed (non-blocking):', err);
          }
        };

        const startFreshJob = (jobType?: string, agent?: string) => {
          dismissInterruption();
          get().setInlineAskContext(null);

          const state = get() as any;
          const effectiveJobType = jobType || state.selectedJobType || 'design';
          const effectiveAgent = agent || state.selectedAgent || 'architect';

          (async () => {
            await dismissInterruptedJobIfAny();
            try {
              const { executeJob } = await import('@/infrastructure/http/api');
              const result = await executeJob({
                projectId: inlineAskContext.projectId,
                featureName: inlineAskContext.featureName,
                jobType: effectiveJobType,
                agent: effectiveAgent,
                overrideDirective: inlineAskContext.message,
                chatSource: true,
              });
              console.log('[Store] ✅ Fresh job started:', result.jobId);
              get().setRunning(true, result.jobId);
              get().setLastJobFailed(false);
            } catch (error) {
              console.error('[Store] ❌ Fresh job start failed:', error);
              get().setRunning(false);
            }
          })();
        };

        if (noSession) {
          console.log('[Store] ⚠️ Work intent + noSession → starting fresh job');
          startFreshJob();
        } else if (action === 'redirect') {
          console.log('[Store] 🔀 Work + redirect → dismissing interruption, awaiting choice card');
          dismissInterruption();
          // Cancelled card cleanup arrives via SSE choice_resolved once
          // BE finishes the dismiss → see dismissInterruptedJobIfAny.
          void dismissInterruptedJobIfAny();
          get().setRunning(false);
          get().setInlineAskContext(null);
        } else if (action === 'newJob') {
          console.log('[Store] 🆕 Work + newJob → clear session, start fresh');
          startFreshJob();
        } else {
          console.log('[Store] 🔧 Work + continue → auto-continuing interrupted job:', inlineAskContext.interruptedJobId);
          dismissInterruption();
          get().setRunning(true, inlineAskContext.interruptedJobId);
          get().setInlineAskContext(null);

          import('@/infrastructure/http/api').then(({ continueJob }) => {
            continueJob(
              inlineAskContext.interruptedJobId,
              inlineAskContext.projectId,
              inlineAskContext.featureName,
              inlineAskContext.message,
              true,
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
}
