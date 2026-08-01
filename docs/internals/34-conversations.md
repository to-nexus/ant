# 34. Conversations Record — Unified Conversation State

## Overview

Conversation data for all agent graphs is unified into a single `conversations: Record<string, ConversationMessage[]>` field.
The key convention, in `level:id` form, distinguishes session-level from node-level conversations.

## Structure

```typescript
// packages/ant-cli/src/agents/common/graph/conversations.ts
type ConversationLevel = 'session' | 'node';
type ConversationKey = `${ConversationLevel}:${string}`;

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContentBlock[];  // session uses string, node uses string|ContentBlock[]
  timestamp?: string;                       // used at the session level
  metadata?: { ... };                       // used at the session level
}
```

## Key Constants (CONV_KEYS)

| Key | Level | Description | Producers | Consumers |
|---|---|---|---|---|
| `session:main` | session | Semantic user-agent conversation (cross-run) | planner resolve/generate, visual resolve/direct | planner generate (compaction), triage (sessionDigest) |
| `node:execute` | node | Code job execute tool loop | code execute, code tool | code execute, code checkTaskStatus |
| `node:plan` | node | **Shared by code + design**: plan↔tool tool loop. Code always uses it. Design uses it only when `intentGroup ∈ {design-spec, design-system-design}` (ui-design / game-art-design take the dispatcher-only path and do not use NODE_PLAN) | code plan, code tool, design plan, design tool | code plan, design plan |
| `node:execute` | node | Design job execute tool loop | design execute, design tool | design execute, design checkTaskStatus |
| `node:generate` | node | Planner generate tool loop | planner generate, planner tool | planner generate |
| `node:agent` | node | Ask job agent loop | ask agent, ask tool | ask agent |
| `node:direct` | node | Code job direct ReAct loop | code direct | code direct |

**Design tool node branching**: routes to NODE_PLAN when `state._activePhase === 'plan'`, otherwise to NODE_EXECUTE. The plan↔tool and execute↔tool loops share the same physical tool node, but their conv keys are kept separate. See [15-design-job.md](./15-design-job.md) for the detailed graph structure.

## LangGraph Annotation

```typescript
// ResolvableFields (annotationHelpers.ts)
conversations: Annotation<Conversations>({
  reducer: conversationsReducer,  // shallow merge: { ...prev, ...next }
  default: () => ({}),
})
```

Because it operates as a shallow-merge reducer, a node returning only its own key preserves the other keys:
```typescript
return { conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedMessages } };
// → existing keys like session:main, node:plan are retained
```

## Helper Functions

- `getConv(convs, key)` — type-safe read (empty array if absent)
- `setConv(key, entries)` — return-value builder
- `isSessionEntry(msg)` / `isNodeMessage(msg)` — type guards

## Session File Storage Format

```json
{
  "state": {
    "conversations": {
      "session:main": [ { "role": "user", "content": "...", "timestamp": "..." } ],
      "node:generate": [ { "role": "user", "content": "..." } ]
    }
  }
}
```

Legacy compatibility: the resolve node also reads the `sessionData.state.conversation` (array) format as a fallback.

## sessionDigest

Injects recent session conversation context into the triage prompt to prevent misclassification:
- `buildSessionDigest(entries)` — builds a compact string by truncating the most recent 2-3 turns
- Derived from `conversations[session:main]` in each agent's resolve
- Inserted into the `{{#if hasSessionDigest}}` section of triage base.md
