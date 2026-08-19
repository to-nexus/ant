# Tool System

## Overview

This system unifies the declaration, handlers, and execution orchestration of the tools LLM agents invoke (read_file, run_command, figma_get_design_context, etc.). It is a 2-layer architecture shared by all jobs (code, design, plan, ask).

## Directory Structure

```
agents/common/tool/
├── toolCatalog.ts      # ToolName enum, JOB_TOOL_MATRIX, TOOL_HANDLERS, display names
├── types.ts            # ToolExecutionContext, ToolResult, ToolSideEffect, ToolHandler
├── registry.ts         # ToolRegistry (ToolName→handler mapping)
├── presets.ts          # Per-job registry factories (createCodeToolRegistry, etc.)
├── orchestrator.ts     # ToolOrchestrator (batch execution, cache, truncation, UI)
├── createToolNode.ts   # createToolNode<TState> factory (creates LangGraph nodes)
├── messageBuilder.ts   # Anthropic message builder (buildAssistantMessage + buildToolResultMessage)
├── chatStatusAdapter.ts# ChatAPIClient → ChatStatusReporter adapter
├── index.ts            # public API
└── handlers/
    ├── pathResolver.ts     # Path resolution + auto-correction
    ├── readFile.ts         # read_file
    ├── listFiles.ts        # list_files
    ├── searchCode.ts       # search_code
    ├── deleteFile.ts       # delete_file
    ├── editFile.ts         # edit_file (includes I/O retry)
    ├── createFile.ts       # create_file (shadow tool)
    ├── mkdir.ts            # mkdir
    ├── searchWeb.ts        # search_web
    ├── searchReferenceCode.ts  # search_reference_code
    ├── runCommand.ts       # run_command (pure execution)
    ├── codeCommandPolicy.ts# Code-job-only command guard
    └── figma.ts            # figma_get_* (sideEffect-based error tracking)
```

## Architecture: 2-Layer

```
┌─────────────────────────────────────────┐
│  Job Tool Node (thin wrapper)           │  state ↔ context conversion, hooks
│  createToolNode<TState>(config)         │
├─────────────────────────────────────────┤
│  ToolOrchestrator.executeBatch()        │  cache, truncation, chatStatus, workflow
│     └── ToolRegistry.get(name)          │
│            └── ToolHandler(ctx, args)   │  pure execution (ToolExecutionContext-based)
└─────────────────────────────────────────┘
```

Handlers never read graph state directly. A `buildContext(state)` function performs the state → `ToolExecutionContext` conversion, and handlers read only from the context. State-change intent is returned as a `ToolSideEffect` discriminated union.

## ToolCatalog

`toolCatalog.ts` is the system's Single Source of Truth.

### ToolName enum

All tools are classified by capability:

| Category | Tools | Description |
|----------|-------|------|
| **Read** | `READ_FILE`, `READ_SOURCE_DOC`, `READ_REF_IMAGE`, `READ_ANT_SOURCE`, `READ_WORKSPACE_FILE` | Per-scope file reads |
| **List** | `LIST_FILES`, `LIST_REF_IMAGES`, `LIST_ASSETS`, `LIST_ANT_FILES`, `LIST_WORKSPACE_FILES` | Per-scope file/asset listings |
| **Search** | `SEARCH_CODE`, `SEARCH_WEB`, `SEARCH_REFERENCE`, `SEARCH_ANT_CODE` | Per-scope search |
| **Write** | `EDIT_FILE`, `CREATE_FILE`, `DELETE_FILE`, `MKDIR` | File modification/creation/deletion |
| **Execute** | `RUN_COMMAND` | Shell command execution |
| **Fetch** | `DOWNLOAD_ASSET`, `FIGMA_DESIGN_CTX`, `FIGMA_SCREENSHOT`, `FIGMA_METADATA`, `FIGMA_VARIABLES` | Acquiring external resources |
| **Shadow** | `FILE`, `WRITE_FILE` | Aliases of `CREATE_FILE` (LLM compatibility) |

### JOB_TOOL_MATRIX

Declaratively defines which job uses which tools:

| Tool | code | design | plan | ask |
|------|:----:|:------:|:----:|:---:|
| READ_FILE | O | O | O | |
| READ_SOURCE_DOC | | O | | |
| READ_REF_IMAGE | | O | | |
| READ_ANT_SOURCE | | | | O |
| READ_WORKSPACE_FILE | | | | O |
| LIST_FILES | O | O | O | |
| LIST_REF_IMAGES | | O | | |
| LIST_ASSETS | | O | | |
| LIST_ANT_FILES | | | | O |
| LIST_WORKSPACE_FILES | | | | O |
| SEARCH_CODE | O | O | O | |
| SEARCH_WEB | O | O | O | |
| SEARCH_REFERENCE | O | | | |
| SEARCH_ANT_CODE | | | | O |
| EDIT_FILE | O | O | O | |
| CREATE_FILE | O | | O | |
| DELETE_FILE | O | O | | |
| MKDIR | O | O | O | |
| RUN_COMMAND | O* | O | | |
| DOWNLOAD_ASSET | | O | | |
| FIGMA_* (4 tools) | O | O | | |

`*` = wrapped by CodeCommandPolicy

### TOOL_HANDLERS

The `ToolName → ToolHandler` mapping. Only tools with a common handler are included. Artifact-scope readers (READ_SOURCE_DOC, etc.) and ant-source readers (READ_ANT_SOURCE, etc.) are registered at runtime by the job's tool node wrapper via `registry.register(ToolName.XXX, handler)`.

### Other Declarative Data

| Constant | Type | Role |
|------|------|------|
| `TOOL_DISPLAY_NAMES` | `Record<ToolName, string>` | UI status display text |
| `SHADOW_ALIASES` | `Map<ToolName, ToolName>` | alias → canonical mapping |
| `CACHEABLE_TOOLS` | `Set<ToolName>` | Result-cache targets (read-only tools) |
| `FIGMA_TOOLS` | `ToolName[]` | Figma MCP tool group |

## ToolRegistry

The runtime `ToolName → ToolHandler` mapping. The factories in `presets.ts` build it automatically from `JOB_TOOL_MATRIX` + `TOOL_HANDLERS`.

| Method | Role |
|--------|------|
| `register(name: ToolName, handler)` | Register a handler |
| `get(name: string)` | Look up a handler by the tool name the LLM sent |
| `wrap(name: ToolName, wrapper)` | Wrap an existing handler with middleware (e.g., CodeCommandPolicy) |
| `merge(other: ToolRegistry)` | Merge another registry |

## Presets

| Factory | Job | Notes |
|--------|-----|---------|
| `createCodeToolRegistry()` | code | Wraps `RUN_COMMAND` with `CodeCommandPolicy` |
| `createDesignToolRegistry()` | design | Artifact-scope handlers registered at runtime |
| `createPlanToolRegistry()` | plan | - |
| `createAskToolRegistry()` | ask | ant-source/workspace handlers registered at runtime |

## ToolExecutionContext

The unified context handlers receive instead of graph state. Fields are grouped by handler need:

| Field group | Fields | Used by |
|-----------|------|--------|
| Common | `fileSystem`, `chatStatus`, `workingDir`, `featurePath`, `project`, `featureFolder` | All handlers |
| Ports | `command`, `git`, `redis`, `fileTreeUpdate` | Command execution, git integration, file-tree refresh (orchestrator-driven — see below) |
| Figma | `figmaFileKey`, `figmaConfig`, `figmaAvailable` | Figma fetch handlers |
| Command policy | `activePhase`, `currentTaskType`, `verificationTracker`, `depFileHash`, `retries` | runCommand + CodeCommandPolicy |
| Reference search | `referenceRequests`, `resolvedActionMode`, `retriever`, `vectorDB`, `workspaceResolver`, `userId`, `organizationId` | search_reference_code |
| Artifact reads | `sourceDocuments`, `files` | read_source_doc, etc. |

## ToolResult + ToolSideEffect

The handler return type.

`sideEffects` is also the file-tree refresh channel: `ToolOrchestrator` is the
single owner of `notifyFileTreeUpdate` and fires it after any call reporting
`fileCreated` / `fileModified` / `fileDeleted` / `directoryCreated` /
`commandExecuted` / `serverStarted`. A handler that mutates the tree but reports
no side effect gets no refresh — that is how `mkdir` and `run_command` stayed
invisible to the FE. Do not call `ctx.fileTreeUpdate.notifyFileTreeUpdate` from a
handler; report what happened and let the orchestrator decide.
`fileNotChanged` is deliberately excluded (nothing the tree renders changed).

```typescript
interface ToolResult {
  content: string | any[];       // Result delivered to the LLM (multimodal supported)
  error?: string;
  sideEffects?: ToolSideEffect[];
}
```

`ToolSideEffect` is a discriminated union through which a handler declares its state-change intent:

| type | Purpose |
|------|------|
| `fileModified` / `fileCreated` / `fileDeleted` | File change tracking |
| `commandExecuted` | Command result (exitCode, success, hasWarnings) |
| `depFileHashChanged` | Dependency file hash refresh (install skip guard) |
| `serverStarted` | Register a long-running server process (for cleanup) |
| `figmaError` / `figmaSuccess` | Figma error counter (consecutive failures → connection-lost verdict) |
| `verificationInvalidated` | Verification re-run required due to file changes |

## ToolOrchestrator

`executeBatch(ctx, opts)` — executes the tool calls from a single LLM response sequentially.

Processing order:
1. `workflowUpdate.enterNode()` (per batch)
2. For each tool call:
   - Cache-hit check (`CACHEABLE_TOOLS`)
   - `chatStatus.showStatus()` (UI status card)
   - `registry.get(name)` → execute handler
   - `ToolResultManager.truncateResult()` (truncate within token budget)
   - Update cache
3. `chatStatus.flush()` (per batch)
4. `workflowUpdate.exitNode()` (per batch)
5. `buildToolResultMessage()` → return Anthropic-format blocks

## createToolNode

`createToolNode<TState>(config)` — a generic factory that creates a LangGraph node function.

| config field | Role |
|-------------|------|
| `getPendingCalls(state)` | Read `state.pendingToolCalls` |
| `buildContext(state)` | state → `ToolExecutionContext` conversion |
| `registry` | Pre-configured `ToolRegistry` |
| `resultManager` | `ToolResultManager` instance |
| `getHistory(state)` | Access to conversation history |
| `getCache(state)` | Access to cache state |
| `hooks.afterExecution` | Per-tool sideEffect handling |
| `hooks.afterBatch` | State updates after batch completion |
| `hooks.buildExtraUserContent` | Extra content such as task reminders |
| `buildReturn(state, result)` | Assemble the final `Partial<TState>` |

### Message Responsibility Split

The tool node appends only user messages (tool_result blocks). The assistant message (thinking + text + tool_use) is constructed directly by the LLM node using `buildAssistantMessage()`. This split applies identically to all jobs:

| Job | LLM node (assistant push) | tool node (user push) |
|-----|---------------------------|----------------------|
| Code (execute) | `execute/index.ts` | `tool/index.ts` |
| Code (plan) | `planGeneration.ts` | `tool/index.ts` |
| Design | `execute/index.ts` | `tool/index.ts` |
| Ask | `ask/nodes/agent.ts` | `ask/nodes/tool.ts` |
| Plan | `generate/index.ts` | `plan/nodes/tool.ts` |

## MessageBuilder

`messageBuilder.ts` — bidirectional Anthropic-format message builder.

| Function | Direction | Role |
|------|------|------|
| `buildAssistantMessage(options)` | LLM node → history | Assembles thinking + text + tool_use blocks into an Anthropic assistant message. Returns a string shorthand when there is only a single text block |
| `buildToolResultMessage(events)` | tool node → history | `ToolExecutionEvent[]` → returns tool_use + tool_result block pairs |

## RUN_COMMAND — long-running detection + fact report

`runCommand.ts` determines whether a command is long-running like a dev server / watch mode, and if so branches to `handleLongRunningCommand`. This function's return value is an **objective fact report** the LLM can judge directly — the wrapper synthesizes no verdict of any kind.

### Return Shape

```ts
{
  success: boolean;     // exitCode∈{0,null} && (httpProbe?.ok ?? true)
  output: string;       // fact report (no verdict prefix)
  exitCode: number | null;  // null = stayed alive through the verification window and was force-killed
  httpProbe?: { ok: boolean; status?: number; error?: string };
  serverPid?: number;   // only when keepRunning + success
}
```

The body structure of `output` (identical across all result branches):

```
command: <command>
duration_ms: <int>
exit: <code | "signal:..." | "killed-after-verification">
http_probe: <status | "failed: ..." | "skipped">
stdout:
<stdout, ≤8000 chars>
stderr:
<stderr, ≤4000 chars>
```

### Behavior

- The child process's stdout/stderr are only accumulated, **with no regex judgments**. The old `ERROR_PATTERNS` regex / `hasError` flag / 3s `EARLY_ERROR_TIMEOUT` branch are all retired.
- When `STARTUP_VERIFICATION_TIMEOUT` (or `COMPILE_RUN_STARTUP_TIMEOUT` for compile-and-run commands) expires, poll once via `infrastructure/ide/readiness::probeHttp`. The result (`status` or `error`) is stored verbatim in `httpProbe`.
- If `keepRunning=false`, the child is force-killed after the verification window ends. If the child exits on its own, `child.on('exit')` joins the same finalizer.
- `success` is a single deterministic predicate (`exitCode∈{0,null} && (httpProbe?.ok ?? true)`). The caller (`runCommand.ts:578`) reads `r.success` directly to fill the `success` field of the `commandExecuted` side-effect — it never sniffs string prefixes.

### LLM-side Contract

The LLM **directly reads** the `exit:` / `http_probe:` lines of `output` and the framework error glyphs inside stdout/stderr (`⨯`, `❌`, `Failed to compile`, etc.) to decide its next actions. Since the wrapper never bakes in a verdict, the verification task's `<done>` decision stays consistent with the SSOT that it is an LLM judgment from conversation history (17-code-verification-task.md §1.2).

### HTTP Probe SSOT

`infrastructure/ide/readiness.ts` is the single polling-loop SSOT:

| API | Returns | Purpose |
|---|---|---|
| `probeHttp(host, port, path?, timeoutMs?)` | `{ ok, status?, error? }` | For fact reports (called from the wrapper) |
| `waitForHttpReady(host, port, path?, timeoutMs?)` | `void` (throws on timeout) | Wait-gate (called by IDEService / KubernetesIDEOrchestrator) |
| `waitForTcpReady(host, port, timeoutMs?)` | `void` (throws on timeout) | TCP-stage readiness |

`waitForHttpReady` is a thin wrapper over `probeHttp` — a single internal loop, two public contracts.

## CodeCommandPolicy

`codeCommandPolicy.ts` — a pre-execution guard applied only to the code job's `RUN_COMMAND`.

| Guard | Condition | Action |
|------|------|------|
| Go build block | `go build/test/run/vet` + taskType !== verification/error | rejection |
| Execute-phase block | verification task + activePhase !== plan + build/test/typecheck | rejection |
| Plan loop block | activePhase === plan + command already attempted | rejection |
| tsc-first ordering | build attempted + typecheckRequired + !typecheckAttempted | rejection |
| Cross-guard | build attempted + typecheck failed | rejection |

## ChatStatusReporter

The interface handlers use to update the UI. It is injected via context instead of importing the `ChatAPIClient` singleton directly.

| Implementation | Purpose |
|--------|------|
| `createChatStatusReporter()` | ChatAPIClient adapter (production) |
| `createNoopChatStatusReporter()` | No-op (tests, environments without UI) |

## Adding a Tool

1. Add a value to the `ToolName` enum in `toolCatalog.ts`
2. Write a handler file in the `handlers/` directory (`ToolExecutionContext, args → ToolResult`)
3. Add a re-export in `handlers/index.ts`
4. Add `[ToolName.XXX, handler]` to the `TOOL_HANDLERS` map in `toolCatalog.ts`
5. Add UI text to `TOOL_DISPLAY_NAMES` in `toolCatalog.ts`
6. Add it to the relevant job(s) in `JOB_TOOL_MATRIX` in `toolCatalog.ts`
7. Update `CACHEABLE_TOOLS`, `SHADOW_ALIASES` if needed

For handlers that depend on graph state, such as artifact-scope/ant-source-scope handlers, do not add them to `TOOL_HANDLERS`; register them at runtime in the job's tool node wrapper via `registry.register(ToolName.XXX, handler)`.

## Boundaries

- Agent architecture: [11-agent-architecture.md](11-agent-architecture.md)
- Code job graph: [14-code-job.md](14-code-job.md)
- Design job graph: [15-design-job.md](15-design-job.md)
- Planner job graph: [16-planner-job.md](16-planner-job.md)
- Ask system: [17-ask-system.md](17-ask-system.md)
- Figma infrastructure: [26-figma-integration-infra.md](26-figma-integration-infra.md)
- Prompt system: [13-prompt-system.md](13-prompt-system.md)
