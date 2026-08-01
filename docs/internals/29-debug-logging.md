# Debug Logging

## Overview

During Job execution, ANT records debug information — LLM prompt structure, token usage, execution events, tool calls — under the `sessions/{agent}/debug/` directory. This information is used to diagnose missing prompt injections, detect token blow-ups, and trace failure causes.

### Design Principles

| Principle | Description |
|------|------|
| **MECE categories** | Each concern is recorded in exactly one log category. No duplicate recording. |
| **Cross-referenceable** | Every entry includes a `correlationKey` (`jobId:taskId:callIndex`) so categories can be joined. |
| **Append-only** | All logs are append-only. Existing content is never read and modified (no prepend, no truncate). |
| **Dynamic agent resolution** | Agent names are never hard-coded into log paths. They are resolved via `getAgentForJob(jobType)`. |
| **Job Summary** | On Job completion, a single summary file is generated so the overall picture can be grasped without directory traversal. |
| **Non-blocking** | A logging failure never interrupts Job execution. |
| **JobId = filename** | Filenames consist of `{jobId}.ext` only. The directory identifies the category, so no prefix is added. |

## Directory Structure

```
sessions/{agent}/debug/
    summary/                  Job-wide summary (index + key metrics)
        {jobId}.json
    prompts/                  LLM prompt structure trace
        {jobId}.jsonl
    logs/                     Job/Task lifecycle events
        {jobId}.jsonl
    tokens/                   Per-LLM-call token usage
        {jobId}.jsonl
    plans/                    Code task generation plans
        {jobId}.json
    figma/                    Figma MCP call debug
        {jobId}.json
        screenshots/{nodeId}.*
```

### File Naming Convention

Since the directory identifies the category, filenames carry no category prefix. A filename consists of `{jobId}` plus the extension only.

```
sessions/architect/debug/tokens/abc-123.jsonl    (O)
sessions/architect/debug/tokens/token-abc-123.json  (X — redundant prefix, mismatched extension)
```

With this rule, files can be found across all categories by the same `jobId`:

```bash
ls sessions/architect/debug/*/{jobId}.*
```

Path SSOT: `DEBUG_SUBDIRS` in `sessionPaths.ts`. Canonical directories: `CANONICAL_DIR_DEFS` in `@ant/shared/canonical.ts`.

Per-agent debug subdirectories:

| Agent | Subdirectories |
|-------|--------------|
| architect | summary, prompts, plans, logs, tokens, figma |
| planner | summary, prompts |
| creator | summary, prompts |

## Log Categories

Concerns are separated into 5 categories. Each category is independent and never duplicates information from another category.

### 1. Job Summary (`summary/{jobId}.json`)

A single JSON file generated automatically on Job completion (success/interruption/failure). The entry point for "what happened in this Job".

```json
{
  "jobId": "abc-123",
  "jobType": "code",
  "agent": "architect",
  "status": "completed",
  "startedAt": "2025-01-15T10:00:00Z",
  "completedAt": "2025-01-15T10:05:30Z",
  "elapsedMs": 330000,

  "tokens": {
    "totalInput": 125000,
    "totalOutput": 42000,
    "totalCacheRead": 98000,
    "totalCacheCreation": 27000,
    "billableInput": 62200,
    "cacheHitRatio": 0.784
  },

  "tasks": {
    "total": 5,
    "completed": 4,
    "failed": 1,
    "failedTaskIds": ["task-3"]
  },

  "issues": [
    { "type": "low_cache_hit", "taskId": "task-2", "callIndex": 3, "ratio": 0.12 },
    { "type": "high_iteration", "taskId": "task-3", "callCount": 18 },
    { "type": "contract_violation", "node": "execute", "missing": ["designTokens"] }
  ],

  "files": {
    "prompts": "prompts/abc-123.jsonl",
    "logs": "logs/abc-123.jsonl",
    "tokens": "tokens/abc-123.jsonl",
    "plans": "plans/abc-123.json"
  }
}
```

The `files` field is a list of relative paths to the debug files actually generated for this Job. Related files can be identified without directory traversal.

The `issues` array summarizes anomalies detected during execution:

| Issue Type | Detection condition | Description |
|------------|----------|------|
| `low_cache_hit` | `cacheHitRatio < 0.5` (iterative node, callIndex > 0) | Prompt cache instability |
| `high_iteration` | `callIndex >= 15` (iterative node) | Possible task convergence failure |
| `contract_violation` | Missing variable detected during template rendering | Missing prompt injection |
| `task_failure` | Task execution failure | Retry exhaustion, recursion limit, etc. |
| `profile_missing` | Language/framework profile not found | Incomplete environment detection |

### 2. Prompt Trace (`prompts/{jobId}.jsonl`)

Structural metadata of the prompts sent to the LLM. Prompt bodies are NOT recorded — only which templates were composed and which variables were injected.

```jsonl
{"correlationKey":"abc-123:triage:0","node":"triage","timestamp":"...","templatePath":"triage/base","usedTemplates":["triage/rules"],"promptLength":4200,"tokenEstimate":1200,"injectedVariables":{"workspaceState":"[STRING: 2340 chars]"},"contractViolations":[]}
{"correlationKey":"abc-123:task-1:0","node":"decompose","taskId":"task-1","timestamp":"...","templatePath":"code/phases/decompose/base","promptLength":8500,"tokenEstimate":2428}
{"correlationKey":"abc-123:task-1:1","node":"execute","taskId":"task-1","callIndex":1,"timestamp":"...","templatePath":"code/phases/execute/base","promptLength":12000,"tokenEstimate":3428}
```

Fields recorded per entry:

| Field | Required | Description |
|------|------|------|
| `correlationKey` | Y | `{jobId}:{taskId}:{callIndex}` |
| `node` | Y | Graph node name (triage, decompose, execute, etc.) |
| `taskId` | N | Task ID (triage has no task) |
| `callIndex` | N | n-th LLM call within the same task |
| `timestamp` | Y | ISO 8601 |
| `templatePath` | N | Main Handlebars template path |
| `usedTemplates` | N | Additional template files used |
| `resolvedPartials` | N | Handlebars partials resolved during rendering |
| `injectedVariables` | N | Summary of injected variables (large values abbreviated as `[STRING: N chars]`) |
| `contractViolations` | N | List of missing variables/partials |
| `hardcodedContent` | N | Content injected directly outside of templates (2000-char limit) |
| `promptLength` | N | Total prompt character count |
| `tokenEstimate` | N | Estimated token count (`chars / 3.5`) |

### 3. Execution Events (`logs/{jobId}.jsonl`)

Records Job and Task lifecycle events. Focuses on "what started/completed/failed and when".

```jsonl
{"correlationKey":"abc-123::0","type":"job_start","timestamp":"...","data":{"jobType":"code","taskCount":5}}
{"correlationKey":"abc-123:task-1:0","type":"task_start","timestamp":"...","taskId":"task-1","data":{"taskName":"Create UserService","priority":1}}
{"correlationKey":"abc-123:task-1:0","type":"task_complete","timestamp":"...","taskId":"task-1","data":{"elapsedMs":45000,"llmCallCount":3}}
{"correlationKey":"abc-123::0","type":"job_complete","timestamp":"...","data":{"totalTasks":5,"elapsedMs":330000}}
```

Event types:

| Type | Scope | Description |
|------|--------|------|
| `job_start` | Job | Job start, environment info |
| `job_complete` | Job | Normal completion, aggregate metrics |
| `job_interrupted` | Job | User interruption |
| `job_resumed` | Job | Interrupted Job resumed |
| `task_start` | Task | Task execution start |
| `task_complete` | Task | Task completed normally |
| `task_fail` | Task | Task failure (retry exhaustion, recursion limit) |
| `task_retry` | Task | Retry after verification failure |
| `parallel_start` | Batch | Parallel batch start |
| `parallel_complete` | Batch | Parallel batch completion |
| `violation_detected` | Task | Output verification violation detected |
| `tool_call` | Task | Tool call (name, argument summary, result size) |
| `phase_complete` | Job | Graph phase completion (decompose, execute, etc.) |
| `execute_interrupted` | Task | Execution interrupted within a task (budget exhaustion) |

### 4. Token Ledger (`tokens/{jobId}.jsonl`)

Token usage per LLM call. Used for cost analysis and cache efficiency monitoring.

```jsonl
{"correlationKey":"abc-123:task-1:0","type":"call","taskId":"task-1","node":"execute","callIndex":0,"timestamp":"...","inputTokens":8500,"outputTokens":2100,"cacheReadTokens":6200,"cacheCreationTokens":2300,"billableInputTokens":3470,"cacheHitRatio":0.729,"taskCumulativeInput":8500,"taskCumulativeOutput":2100}
{"correlationKey":"abc-123:task-1:1","type":"call","taskId":"task-1","node":"execute","callIndex":1,"timestamp":"...","inputTokens":9200,"outputTokens":1800,"cacheReadTokens":8700,"cacheCreationTokens":500,"billableInputTokens":1795,"cacheHitRatio":0.946,"taskCumulativeInput":17700,"taskCumulativeOutput":3900}
```

Entry types:

| Type | Description |
|------|------|
| `call` | Token detail for one LLM call |
| `resume_marker` | Marker at Job resume point (marks a Run boundary) |

Fields of a `call` entry:

| Field | Description |
|------|------|
| `inputTokens` | Input tokens actually sent |
| `outputTokens` | LLM response tokens |
| `cacheReadTokens` | Tokens read from cache |
| `cacheCreationTokens` | Tokens used for cache creation |
| `billableInputTokens` | Cost-weighted (`input*1.0 + creation*1.25 + cacheRead*0.1`) |
| `cacheHitRatio` | `cacheRead / (cacheRead + input)`, 0-1 |
| `taskCumulativeInput` | Cumulative input tokens for this task |
| `taskCumulativeOutput` | Cumulative output tokens for this task |
| `taskCumulativeBillableInput` | Cumulative billable input for this task |

### 5. Plan Dump (`plans/{jobId}.json`)

Per-task execution plans generated by the code Job's `planGeneration` node. Tasks accumulate in a JSON array format.

```json
[
  {
    "taskId": "task-1",
    "taskName": "Create UserService",
    "taskType": "implementation",
    "priority": 1,
    "plan": { "steps": ["..."], "targetFiles": ["..."] }
  }
]
```

This file is also used as input for the package coverage check after parallel orchestration ends.

### 6. Figma MCP (`figma/`)

Cache hits, deduplication, rate limits, and error summaries for Figma MCP calls.

| File | Format | Description |
|------|------|------|
| `{jobId}.json` | Single JSON | Call summary + event array |
| `screenshots/{nodeId}.*` | Binary | Figma node screenshots |

## File Format Conventions

| Category | Format | Extension | Reason |
|----------|------|--------|------|
| Summary | JSON | `.json` | Single object, parseable as complete JSON |
| Prompts | JSONL | `.jsonl` | Append-only, line-oriented parsing |
| Logs | JSONL | `.jsonl` | Append-only, line-oriented parsing |
| Tokens | JSONL | `.jsonl` | Append-only, line-oriented parsing |
| Plans | JSON Array | `.json` | Task accumulation (read-modify-write pattern) |
| Figma MCP | JSON | `.json` | Written in one batch at Job end |

JSONL rules:

- One line = one complete JSON object (compact, no line breaks)
- The only write operation on the file is `appendFile(line + '\n')`
- No truncate/rewrite logic to maintain a JSON Array
- Extension is unified as `.jsonl` to prevent format/extension mismatches

## Cross-Reference Scheme

Every JSONL entry includes a `correlationKey` field.

```
{jobId}:{taskId}:{callIndex}
```

| Situation | correlationKey example |
|------|-------------------|
| Job-level event (job_start, etc.) | `abc-123::0` |
| Triage (no task) | `abc-123:triage:0` |
| Task-level, first LLM call | `abc-123:task-1:0` |
| Task-level, third LLM call | `abc-123:task-1:2` |

Joining entries with the same `correlationKey` across categories links, for a single LLM call, "what prompt was sent (`prompts/`), how many tokens were used (`tokens/`), and what events occurred (`logs/`)".

```
prompts/{jobId}.jsonl  ──┐
tokens/{jobId}.jsonl   ──┼── JOIN on correlationKey
logs/{jobId}.jsonl     ──┘
```

## Logger Lifecycle

### Instance Management

Each logger (`PromptLogger`, `ExecutionLogger`, `TokenLogger`) is managed as a `jobId`-keyed singleton Map.

```
getXxxLogger(options)  →  look up/create in Map<jobId, Logger>
  ↓
log(entry)             →  appendFile (one JSONL line)
  ↓
clearXxxLogger(jobId)  →  remove from Map (after finalize)
```

Lifecycle guarantee rules:

1. **Creation**: lazily created on `get*Logger()` call. Exactly one exists per `jobId`.
2. **Usage**: `log()` calls are non-blocking. On failure, `console.warn` and continue.
3. **Cleanup**: `clear*Logger(jobId)` MUST be called on Job completion/failure/interruption. Cleaned up in bulk in the `learn` node or the `job_complete` handler.
4. **Leak prevention**: the Job Worker process spawns a child process per Job, so the Map is automatically released on process exit. An explicit `clear` call is still required — in case execution happens directly in the API server process.

### Write Serialization

Concurrent writes to the same file are serialized with a Promise queue (`writeQueue`).

```typescript
private enqueue(fn: () => Promise<void>): Promise<void> {
  this.writeQueue = this.writeQueue.then(fn, fn);
  return this.writeQueue;
}
```

## Triage Logging Rules

The Triage node runs first in the graph, but uses the same `appendFile` pattern as every other node.

- Triage logs are appended to `prompts/{jobId}.jsonl` (prepend is forbidden).
- Since Triage runs first, it naturally becomes the file's first entry.
- The append approach is kept on Job resume as well. A `resume_marker` marks the Run boundary.
- Asynchronous I/O is used instead of synchronous I/O (`readFileSync`, `writeFileSync`).

## Summary Generation

### Generation Timing

`JobSummaryWriter` writes `summary/{jobId}.json` at the following points:

| Point | Trigger |
|------|--------|
| Job completes normally | After the `learn` node runs |
| Job interrupted | After the `job_interrupted` event fires |
| Job failed | In the Worker's `failed` handler |

### Aggregation Logic

The Summary does not read the other log files. It uses metrics accumulated in memory during execution:

- Token totals: `TokenLogger`'s `taskBillableCumulative` Map
- Issue list: `TokenLogger`'s monitoring warnings + `PromptLogger`'s `contractViolations`
- Task status: `ExecutionLogger`'s `task_complete`/`task_fail` counts
- File list: actual paths verified via each logger's `getLogFilePath()`

## Consumption Interfaces

### API

| Endpoint | Method | Description |
|----------|--------|------|
| `/api/features/{featureId}/debug/summary/{jobId}` | GET | Returns the Job Summary JSON |
| `/api/features/{featureId}/debug/{category}/{jobId}` | GET | Returns the per-category log file content |
| `/api/features/{featureId}/debug/summary/{jobId}/issues` | GET | Returns only the Issues array |

### CLI

```bash
ant debug summary <jobId>          # Print summary overview
ant debug tokens <jobId>           # Token usage table
ant debug issues <jobId>           # List of detected issues
ant debug prompts <jobId>          # List of prompt structures
```

### UI

After Job completion, the debug panel shows warnings based on the Summary's `issues` array.

- Low cache-hit-ratio warning
- High iteration count warning
- Prompt contract violation warning
- Task failure details

## Agent Path Resolution

Every logger resolves its agent via `getAgentForJob(jobType)` at construction time.

```typescript
constructor(options: { featurePath: string; jobId: string; jobType: string }) {
  const agent = getAgentForJob(options.jobType);
  this.logDirPath = getSessionDebugDir(options.featurePath, agent, 'logs');
}
```

| jobType | Agent | Debug path |
|---------|-------|------------|
| code | architect | `sessions/architect/debug/` |
| design | architect | `sessions/architect/debug/` |
| learn | architect | `sessions/architect/debug/` |
| ask | architect | `sessions/architect/debug/` |
| plan | planner | `sessions/planner/debug/` |
| visual | creator | `sessions/creator/debug/` |

## Job Verification Protocol

The standard procedure for verifying debug logs after Job execution. Followed identically by agents and humans.

### Inputs

- `featurePath`: absolute path to the feature directory
- `jobId`: Job ID under verification
- `agent`: agent name (architect / planner / creator)

Debug root: `{featurePath}/sessions/{agent}/debug/`

### Step 1: Check Summary (entry point)

Read `summary/{jobId}.json`.

| Check | Criterion | Severity |
|-----------|----------|--------|
| `status` | Report immediately if not `completed` | CRITICAL |
| `issues` array | If non-empty, go to Step 2 | WARNING ~ CRITICAL |
| `tasks.failed` | If >= 1, proceed to Step 4 with `failedTaskIds` | CRITICAL |
| `tokens.cacheHitRatio` | Below 0.5 indicates token efficiency anomaly | WARNING |
| `tokens.billableInput` | Check for abnormal size relative to the job type | WARNING |
| `files` | Whether all expected category files exist | WARNING |

If the Summary is missing, the Job terminated abnormally. Start from Step 3.

### Step 2: Classify Issues

Classify each item in the `issues` array by type and move to the corresponding category log.

| Issue Type | Next action | Log category |
|------------|----------|--------------|
| `contract_violation` | Step 3 (prompt trace) | `prompts/` |
| `low_cache_hit` | Step 4 (token detail) | `tokens/` |
| `high_iteration` | Step 4 (token detail) + Step 5 (execution events) | `tokens/` + `logs/` |
| `task_failure` | Step 5 (execution events) | `logs/` |
| `profile_missing` | Step 5 (execution events) | `logs/` |

### Step 3: Prompt Trace (`prompts/{jobId}.jsonl`)

Parse the JSONL line by line. Each line is prompt metadata for one LLM call.

**Checks:**

| Item | What to look at | Anomaly signal |
|------|-------------|----------|
| `contractViolations` | Non-empty lines | A variable required by the template was not injected — directly affects output quality |
| `templatePath` | null or missing | A hard-coded prompt was used (template system bypassed) |
| `hardcodedContent` | Lines where it exists | Direct injection outside templates — maintenance risk |
| `injectedVariables` | `[STRING: 0 chars]` or expected variable keys missing | Empty context injected — LLM ran information-starved |
| `tokenEstimate` | Extreme values (< 100 or > 100,000) | Prompt composition anomaly |
| Total line count | Compare with expected node count | A missing node indicates a graph execution path anomaly |

**Verification rules:**

```
FAIL  if there is even one contractViolation
WARN  if hardcodedContent is present
WARN  if expected keys are missing from injectedVariables
PASS  if none of the above apply
```

### Step 4: Token Detail (`tokens/{jobId}.jsonl`)

Parse the JSONL line by line. Only `type: "call"` lines are analyzed (skip `resume_marker`).

**Checks:**

| Item | What to look at | Anomaly signal |
|------|-------------|----------|
| `cacheHitRatio` | Below 0.5 with callIndex > 0 | Prompt prefix changes on every call — cache instability |
| `callIndex` | 15 or higher | Task not converging — possible infinite loop |
| `taskCumulativeBillableInput` | Value on the last line | Cumulative cost per task — check against budget |
| `outputTokens` trend for the same `taskId` | Whether it decreases | Decreasing means converging; no change means stalled |
| `cacheCreationTokens` | High value with callIndex > 0 | Cache recreated on every call due to prefix changes — cost waste |

**Verification rules:**

```
FAIL  a task exists with callIndex >= 20
FAIL  lines with cacheHitRatio < 0.3 exceed 30% of the total
WARN  a task exists with callIndex >= 15
WARN  3+ consecutive lines with cacheHitRatio < 0.5
PASS  if none of the above apply
```

### Step 5: Execution Events (`logs/{jobId}.jsonl`)

Parse the JSONL line by line. Filter by the `type` field.

**Checks:**

| Filter | What to look at | Anomaly signal |
|------|-------------|----------|
| `type: "task_fail"` | `data.reason`, `data.errorMessage` | Failure cause — if `recursion_limit`, cross-check with Step 4 |
| `type: "violation_detected"` | `data.violationType`, `data.retryCount` | Repeated violations — the same violationType 3+ times indicates a structural problem |
| `type: "tool_call"` | Presence of `data.error`, `data.wasTruncated` | Tool failures, truncated results |
| `type: "execute_interrupted"` | `data.reason` | Incomplete due to budget exhaustion — output may be incomplete |
| `type: "job_start"` ~ `type: "job_complete"` | `elapsedMs` difference | Abnormal elapsed time |
| `type: "profile_missing"` | `data.profileType`, `data.profileName` | Incomplete environment detection — possibly inappropriate code generation |

**Verification rules:**

```
FAIL  if there is even one task_fail
FAIL  if execute_interrupted is present
WARN  violation_detected 3+ times for the same taskId
WARN  a tool_call has an error
WARN  profile_missing is present
PASS  if none of the above apply
```

### Step 6: Cross-Verification

Join across categories using `correlationKey`.

| Cross-check | Method | Meaning |
|-----------|------|------|
| Prompts of the failed task | `taskId` from `task_fail` → same-`taskId` lines in `prompts/` | Check whether the failure cause was a missing prompt injection |
| Token trend of the failed task | `taskId` from `task_fail` → same-`taskId` lines in `tokens/` | Check whether cache instability caused the failure |
| Prompts of high-iteration calls | `correlationKey` of `tokens/` lines with `callIndex >= 15` → `prompts/` | Check whether the prompt changes across repeated calls |

### Final Verdict

| Grade | Condition |
|------|------|
| **PASS** | No FAIL/WARN in any Step |
| **WARN** | No FAIL, 1+ WARN |
| **FAIL** | 1+ FAIL |

Report the verdict together with the findings in the following format:

```
[FAIL] Step 3: contractViolation in node "execute" — missing: ["designTokens", "projectStructure"]
[FAIL] Step 5: task_fail task-3 — reason: recursion_limit, callIndex: 22
[WARN] Step 4: low cacheHitRatio (0.18) for task-2, callIndex 3-7
[PASS] Step 1, 2, 6: no issues
```

## Boundaries

- Feature directory structure SSOT: [01-shared-contracts.md](01-shared-contracts.md) (`canonical.ts`)
- Workspace isolation and the sessions structure: [20-workspace-isolation.md](20-workspace-isolation.md)
- Job lifecycle and logger call sites: [10-job-lifecycle.md](10-job-lifecycle.md)
- Prompt system (template structure): [13-prompt-system.md](13-prompt-system.md)
- Realtime system (SSE events): [21-realtime-system.md](21-realtime-system.md)
