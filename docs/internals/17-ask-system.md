# Ask System

## Overview

The Ask system answers users' Ant-related questions by combining **static knowledge** with **dynamic code exploration**. It comes in two forms: Agentic Ask (a standalone graph) and Inline Ask (inside an interrupted Job's context).

## Two-Layer Knowledge Structure

### Layer 1: Static Knowledge (System Prompt)

Knowledge included in the LLM system prompt that enables immediate answers without tool calls.

**Components:**

| Source | Content | Nature |
|------|------|------|
| `ask/base.md` fixed sections | Ant overview, core principles, constraints, Feature/Session concepts, UI structure | Stable, rarely changes |
| `{{{jobKnowledge}}}` | Job type table, per-mode descriptions/Outputs/Scope, Workflow Decision Principles | **Generated at runtime from YAML** |
| `ask/rules.md` | Tool usage policy, evaluation protocol, security constraints, response principles | Stable |

**YAML single-source principle**: Job/Mode descriptions are defined in `core/data/triage/jobs/*.yaml`. `AgentRegistry.generateAskKnowledge()` renders the YAML into markdown and injects it into `{{{jobKnowledge}}}`. Since the same YAML is used by both triage routing (`generatePromptContext()`) and ask knowledge, updating the YAML propagates to both.

```
YAML (core/data/triage/jobs/*.yaml)
  ├─ AgentRegistry.generatePromptContext() → triage/base.md {{{jobCapabilities}}}
  └─ AgentRegistry.generateAskKnowledge()  → ask/base.md {{{jobKnowledge}}}
```

### Layer 2: Dynamic Code Exploration (Tool Calls)

When static knowledge alone is insufficient, the LLM reads Ant source code and documentation directly to answer.

**Decision criteria** (`rules.md`):

| Question type | Behavior |
|-----------|------|
| "What is X?" (concept) | Answerable from static knowledge |
| "How does X work?" | Must verify with tools before answering |
| "Why does X behave like this?" | Must verify with tools before answering |
| Evaluation request | Must read the rubric + target document with tools before scoring |

## Agentic Ask

When Triage classifies the input as `intent: ask, inScope: true`, the Ask graph runs.

### LangGraph Workflow

```
agent (LLM + system prompt) → [router]
    +→ tool (code exploration) → agent (loop)
    +→ respond (final answer, chat streaming)
```

### Node Roles

| Node | Role |
|------|------|
| agent | Loads base.md + rules.md + YAML knowledge, LLM judgment, tool call decisions |
| tool | Tool execution, security validation, result return |
| respond | Streams the final response to the Chat UI |

### Tools

Tools are split into Ant source exploration tools and workspace exploration tools.

| Tool | Category | Description |
|------|----------|------|
| `read_ant_source` | Ant source | Read file (path, source: cli/ui/docs) |
| `list_ant_files` | Ant source | List directory (source: cli/ui/docs) |
| `search_ant_code` | Ant source | Search code/docs (query, source, filePattern) |
| `read_workspace_file` | Workspace | Read file inside the feature directory |
| `list_workspace_files` | Workspace | List inside the feature directory |

**Source options:**

| Source | Root | Target |
|--------|------|------|
| `cli` | ant-cli/src | Backend source (agents, core, infrastructure) |
| `ui` | ant-ui/src | Frontend source (components, stores) |
| `docs` | docs/ | Rubrics, architecture docs, guides |

### Access Control

Ant source tools block sensitive paths via blacklist patterns. Workspace tools allow only the `plan/`, `architecture/`, `visual/`, `assets/`, `meta/`, and `sessions/` directories (whitelist).

**Blacklist (FORBIDDEN_PATTERNS)**: `.env`, `secret`, `credentials`, `password`, `private_key`, `api_key`, `infrastructure/auth/`, `infrastructure/networking/`, `node_modules/`, `.git/`, `dist/`

### Security Layers

| Layer | Location | Function |
|------|------|------|
| Path validation | tools.ts | Blacklist matching, traversal prevention, workspace allowed-directory validation |
| Output filtering | tools.ts | Masking of Base64 and API key patterns |
| LLM guardrails | rules.md | No sensitive information, no exposing Ant source code to the user |

## Inline Ask

Runs when the user chats in an interrupted Job session (`POST /inline-ask`). It uses the same tools and security layers as Agentic Ask, but injects the interrupted Job's task context (`existingTaskSummary`) into triage to decide whether to resume the work.

## Triage Integration

```
User input
    → Triage (intent classification)
    → intent: ask + inScope → runAskGraph()
    → chat response streaming
```

While Ask runs, the Kanban and Workflow UI do not change. Only the chat response is streamed.

## Boundaries

- Tool system (tool catalog, registry, orchestrator): [19-tool-system.md](19-tool-system.md)
- Triage classification: [12-triage-routing.md](12-triage-routing.md)
- YAML Job definitions: `core/data/triage/jobs/*.yaml`
- Prompt structure: [13-prompt-system.md](13-prompt-system.md)
- Chat streaming: [31-chat-system.md](31-chat-system.md)
