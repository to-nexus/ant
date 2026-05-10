# Tool System

## 개요

LLM 에이전트가 호출하는 도구(read_file, run_command, figma_get_design_context 등)의 선언, 핸들러, 실행 오케스트레이션을 통합 관리하는 시스템이다. 모든 Job(code, design, plan, ask)이 공유하는 2-layer 아키텍처로 구성된다.

## 디렉토리 구조

```
agents/common/tool/
├── toolCatalog.ts      # ToolName enum, JOB_TOOL_MATRIX, TOOL_HANDLERS, display names
├── types.ts            # ToolExecutionContext, ToolResult, ToolSideEffect, ToolHandler
├── registry.ts         # ToolRegistry (ToolName→handler 매핑)
├── presets.ts          # Job별 registry 팩토리 (createCodeToolRegistry 등)
├── orchestrator.ts     # ToolOrchestrator (배치 실행, 캐시, truncation, UI)
├── createToolNode.ts   # createToolNode<TState> 팩토리 (LangGraph 노드 생성)
├── messageBuilder.ts   # Anthropic 메시지 빌더 (buildAssistantMessage + buildToolResultMessage)
├── chatStatusAdapter.ts# ChatAPIClient → ChatStatusReporter 어댑터
├── index.ts            # public API
└── handlers/
    ├── pathResolver.ts     # 경로 해석 + 자동 교정
    ├── readFile.ts         # read_file
    ├── listFiles.ts        # list_files
    ├── searchCode.ts       # search_code
    ├── deleteFile.ts       # delete_file
    ├── editFile.ts         # edit_file (I/O retry 포함)
    ├── createFile.ts       # create_file (shadow tool)
    ├── mkdir.ts            # mkdir
    ├── searchWeb.ts        # search_web
    ├── searchReferenceCode.ts  # search_reference_code
    ├── runCommand.ts       # run_command (순수 실행)
    ├── codeCommandPolicy.ts# Code job 전용 커맨드 가드
    └── figma.ts            # figma_get_* (sideEffect 기반 에러 추적)
```

## 아키텍처: 2-Layer

```
┌─────────────────────────────────────────┐
│  Job Tool Node (thin wrapper)           │  state ↔ context 변환, hooks
│  createToolNode<TState>(config)         │
├─────────────────────────────────────────┤
│  ToolOrchestrator.executeBatch()        │  캐시, truncation, chatStatus, workflow
│     └── ToolRegistry.get(name)          │
│            └── ToolHandler(ctx, args)   │  순수 실행 (ToolExecutionContext 기반)
└─────────────────────────────────────────┘
```

핸들러는 graph state를 직접 읽지 않는다. `buildContext(state)` 함수가 state → `ToolExecutionContext` 변환을 수행하고, 핸들러는 context에서만 읽는다. State 변경 의도는 `ToolSideEffect` discriminated union으로 반환한다.

## ToolCatalog

`toolCatalog.ts`가 시스템의 단일 진실 원천(Single Source of Truth)이다.

### ToolName enum

모든 도구는 capability 기준으로 분류된다:

| Category | Tools | 설명 |
|----------|-------|------|
| **Read** | `READ_FILE`, `READ_SOURCE_DOC`, `READ_REF_IMAGE`, `READ_ANT_SOURCE`, `READ_WORKSPACE_FILE` | scope별 파일 읽기 |
| **List** | `LIST_FILES`, `LIST_REF_IMAGES`, `LIST_ASSETS`, `LIST_ANT_FILES`, `LIST_WORKSPACE_FILES` | scope별 파일/에셋 목록 |
| **Search** | `SEARCH_CODE`, `SEARCH_WEB`, `SEARCH_REFERENCE`, `SEARCH_ANT_CODE` | scope별 검색 |
| **Write** | `EDIT_FILE`, `CREATE_FILE`, `DELETE_FILE`, `MKDIR` | 파일 수정/생성/삭제 |
| **Execute** | `RUN_COMMAND` | 셸 커맨드 실행 |
| **Fetch** | `DOWNLOAD_ASSET`, `FIGMA_DESIGN_CTX`, `FIGMA_SCREENSHOT`, `FIGMA_METADATA`, `FIGMA_VARIABLES` | 외부 리소스 획득 |
| **Shadow** | `FILE`, `WRITE_FILE` | `CREATE_FILE`의 alias (LLM 호환) |

### JOB_TOOL_MATRIX

어떤 Job이 어떤 도구를 사용하는지 선언적으로 정의한다:

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
| FIGMA_* (4개) | O | O | | |

`*` = CodeCommandPolicy가 wrapping됨

### TOOL_HANDLERS

`ToolName → ToolHandler` 매핑. 공통 핸들러가 있는 도구만 포함된다. artifact-scope readers(READ_SOURCE_DOC 등)와 ant-source readers(READ_ANT_SOURCE 등)는 job의 tool node wrapper가 런타임에 `registry.register(ToolName.XXX, handler)`로 등록한다.

### 기타 선언적 데이터

| 상수 | 타입 | 역할 |
|------|------|------|
| `TOOL_DISPLAY_NAMES` | `Record<ToolName, string>` | UI 상태 표시 텍스트 |
| `SHADOW_ALIASES` | `Map<ToolName, ToolName>` | alias → canonical 매핑 |
| `CACHEABLE_TOOLS` | `Set<ToolName>` | 결과 캐시 대상 (read-only tools) |
| `FIGMA_TOOLS` | `ToolName[]` | Figma MCP 도구 그룹 |

## ToolRegistry

`ToolName → ToolHandler` 런타임 매핑. `presets.ts`의 팩토리가 `JOB_TOOL_MATRIX` + `TOOL_HANDLERS`에서 자동 빌드한다.

| 메서드 | 역할 |
|--------|------|
| `register(name: ToolName, handler)` | 핸들러 등록 |
| `get(name: string)` | LLM이 보낸 도구명으로 핸들러 조회 |
| `wrap(name: ToolName, wrapper)` | 기존 핸들러를 미들웨어로 감싸기 (예: CodeCommandPolicy) |
| `merge(other: ToolRegistry)` | 다른 레지스트리 병합 |

## Presets

| 팩토리 | Job | 특이사항 |
|--------|-----|---------|
| `createCodeToolRegistry()` | code | `RUN_COMMAND`에 `CodeCommandPolicy` wrap |
| `createDesignToolRegistry()` | design | artifact-scope 핸들러는 런타임 등록 |
| `createPlanToolRegistry()` | plan | - |
| `createAskToolRegistry()` | ask | ant-source/workspace 핸들러는 런타임 등록 |

## ToolExecutionContext

핸들러가 graph state 대신 받는 통합 컨텍스트. 필드는 핸들러 필요 기준으로 분류된다:

| 필드 그룹 | 필드 | 사용처 |
|-----------|------|--------|
| 공통 | `fileSystem`, `chatStatus`, `workingDir`, `featurePath`, `project`, `featureFolder` | 전 핸들러 |
| 포트 | `command`, `git`, `redis`, `fileTreeUpdate` | 커맨드 실행, git 연동, 파일트리 갱신 |
| Figma | `figmaFileKey`, `figmaConfig`, `figmaAvailable` | Figma fetch 핸들러 |
| 커맨드 정책 | `activePhase`, `currentTaskType`, `verificationTracker`, `depFileHash`, `retries` | runCommand + CodeCommandPolicy |
| 참조 검색 | `referenceRequests`, `resolvedActionMode`, `retriever`, `vectorDB`, `workspaceResolver`, `userId`, `organizationId` | search_reference_code |
| artifact 읽기 | `sourceDocuments`, `files` | read_source_doc 등 |

## ToolResult + ToolSideEffect

핸들러의 반환 타입.

```typescript
interface ToolResult {
  content: string | any[];       // LLM에 전달될 결과 (multimodal 지원)
  error?: string;
  sideEffects?: ToolSideEffect[];
}
```

`ToolSideEffect`는 discriminated union으로, 핸들러가 state 변경 의도를 선언한다:

| type | 용도 |
|------|------|
| `fileModified` / `fileCreated` / `fileDeleted` | 파일 변경 추적 |
| `commandExecuted` | 커맨드 결과 (exitCode, success, hasWarnings) |
| `depFileHashChanged` | 의존성 파일 해시 갱신 (install skip guard) |
| `serverStarted` | 장시간 실행 서버 프로세스 등록 (cleanup용) |
| `figmaError` / `figmaSuccess` | Figma 에러 카운터 (연속 실패 시 connection lost 판정) |
| `verificationInvalidated` | 파일 변경으로 인한 verification 재실행 필요 |

## ToolOrchestrator

`executeBatch(ctx, opts)` — 단일 LLM 응답의 도구 호출들을 순차 실행한다.

처리 순서:
1. `workflowUpdate.enterNode()` (배치 단위)
2. 각 도구 호출:
   - 캐시 히트 체크 (`CACHEABLE_TOOLS`)
   - `chatStatus.showStatus()` (UI 상태 카드)
   - `registry.get(name)` → 핸들러 실행
   - `ToolResultManager.truncateResult()` (토큰 예산 내 축약)
   - 캐시 갱신
3. `chatStatus.flush()` (배치 단위)
4. `workflowUpdate.exitNode()` (배치 단위)
5. `buildToolResultMessage()` → Anthropic 포맷 블록 반환

## createToolNode

`createToolNode<TState>(config)` — LangGraph 노드 함수를 생성하는 제네릭 팩토리.

| config 필드 | 역할 |
|-------------|------|
| `getPendingCalls(state)` | `state.pendingToolCalls` 읽기 |
| `buildContext(state)` | state → `ToolExecutionContext` 변환 |
| `registry` | 사전 구성된 `ToolRegistry` |
| `resultManager` | `ToolResultManager` 인스턴스 |
| `getHistory(state)` | 대화 히스토리 접근 |
| `getCache(state)` | 캐시 state 접근 |
| `hooks.afterExecution` | 도구별 sideEffect 처리 |
| `hooks.afterBatch` | 배치 완료 후 state 갱신 |
| `hooks.buildExtraUserContent` | task reminder 등 추가 컨텐츠 |
| `buildReturn(state, result)` | 최종 `Partial<TState>` 조립 |

### 메시지 책임 분리

tool 노드는 user 메시지(tool_result 블록)만 추가한다. assistant 메시지(thinking + text + tool_use)는 LLM 노드가 `buildAssistantMessage()`를 사용하여 직접 구성한다. 이 분리는 모든 Job에 동일하게 적용된다:

| Job | LLM 노드 (assistant push) | tool 노드 (user push) |
|-----|---------------------------|----------------------|
| Code (execute) | `execute/index.ts` | `tool/index.ts` |
| Code (plan) | `planGeneration.ts` | `tool/index.ts` |
| Design | `docGen/index.ts` | `tool/index.ts` |
| Ask | `ask/nodes/agent.ts` | `ask/nodes/tool.ts` |
| Plan | `generate/index.ts` | `plan/nodes/tool.ts` |

## MessageBuilder

`messageBuilder.ts` — 양방향 Anthropic 포맷 메시지 빌더.

| 함수 | 방향 | 역할 |
|------|------|------|
| `buildAssistantMessage(options)` | LLM 노드 → history | thinking + text + tool_use 블록을 Anthropic assistant 메시지로 조립. 단일 text만 있으면 string shorthand 반환 |
| `buildToolResultMessage(events)` | tool 노드 → history | `ToolExecutionEvent[]` → tool_use + tool_result 블록 쌍 반환 |

## RUN_COMMAND — long-running detection + fact report

`runCommand.ts`는 명령어가 dev server / 워치 모드처럼 장시간 실행되는지 판정한 뒤, 그런 경우 `handleLongRunningCommand`로 분기한다. 이 함수의 반환은 LLM 이 직접 판단할 수 있는 **객관적 사실 보고서**다 — 래퍼는 어떤 verdict 도 합성하지 않는다.

### 반환 형태

```ts
{
  success: boolean;     // exitCode∈{0,null} && (httpProbe?.ok ?? true)
  output: string;       // 사실 보고서 (verdict prefix 없음)
  exitCode: number | null;  // null = verification 창 동안 살아있어 강제 종료됨
  httpProbe?: { ok: boolean; status?: number; error?: string };
  serverPid?: number;   // keepRunning + success 인 경우만
}
```

`output` 의 본문 구조 (모든 결과 분기에서 동일):

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

### 동작

- 자식 프로세스의 stdout/stderr 는 **regex 판단 없이** 누적만 한다. 옛 `ERROR_PATTERNS` regex / `hasError` 플래그 / 3s `EARLY_ERROR_TIMEOUT` 분기는 모두 폐기.
- `STARTUP_VERIFICATION_TIMEOUT` (compile-and-run 명령은 `COMPILE_RUN_STARTUP_TIMEOUT`) 만료 시점에 `infrastructure/ide/readiness::probeHttp` 로 한 번 폴링. 결과 (`status` 또는 `error`) 를 `httpProbe` 에 그대로 저장.
- `keepRunning=false` 면 verification 창 종료 후 자식을 강제 종료. 자식이 자체적으로 종료되면 `child.on('exit')` 가 같은 finalizer 로 합류.
- `success` 는 단일 deterministic predicate (`exitCode∈{0,null} && (httpProbe?.ok ?? true)`). 호출자 (`runCommand.ts:578`) 는 `r.success` 를 직접 읽어 `commandExecuted` side-effect 의 `success` 필드를 채운다 — 문자열 prefix 를 sniff 하지 않는다.

### LLM 측 contract

LLM 은 `output` 의 `exit:` / `http_probe:` 행과 stdout/stderr 안의 프레임워크 에러 글리프 (`⨯`, `❌`, `Failed to compile`, etc.) 를 **직접 읽어** 후속 행동을 결정한다. 래퍼가 verdict 를 굳히지 않으므로 verification task 의 `<done>` 결정은 LLM judgment from conversation history 라는 SSOT (17-code-verification-task.md §1.2) 와 어긋나지 않는다.

### HTTP probe SSOT

`infrastructure/ide/readiness.ts` 가 단일 폴링 루프 SSOT 다:

| API | 반환 | 용도 |
|---|---|---|
| `probeHttp(host, port, path?, timeoutMs?)` | `{ ok, status?, error? }` | 사실 보고서용 (래퍼에서 호출) |
| `waitForHttpReady(host, port, path?, timeoutMs?)` | `void` (timeout 시 throw) | wait-gate (IDEService / KubernetesIDEOrchestrator 가 호출) |
| `waitForTcpReady(host, port, timeoutMs?)` | `void` (timeout 시 throw) | TCP 단계 readiness |

`waitForHttpReady` 는 `probeHttp` 위에 얇은 wrapper — 단일 내부 루프, 두 공개 contract.

## CodeCommandPolicy

`codeCommandPolicy.ts` — Code job의 `RUN_COMMAND`에만 적용되는 실행 전 가드.

| 가드 | 조건 | 동작 |
|------|------|------|
| Go build 차단 | `go build/test/run/vet` + taskType !== verification/error | rejection |
| Execute-phase 차단 | verification 태스크 + activePhase !== plan + build/test/typecheck | rejection |
| Plan loop 차단 | activePhase === plan + 이미 attempted된 커맨드 | rejection |
| tsc-first 순서 | build 시도 + typecheckRequired + !typecheckAttempted | rejection |
| Cross-guard | build 시도 + typecheck failed | rejection |

## ChatStatusReporter

핸들러가 UI를 갱신할 때 사용하는 인터페이스. `ChatAPIClient` 싱글톤을 직접 import하는 대신 context로 주입한다.

| 구현체 | 용도 |
|--------|------|
| `createChatStatusReporter()` | ChatAPIClient 어댑터 (프로덕션) |
| `createNoopChatStatusReporter()` | 무동작 (테스트, UI 미사용 환경) |

## 도구 추가 절차

1. `toolCatalog.ts`의 `ToolName` enum에 값 추가
2. `handlers/` 디렉토리에 핸들러 파일 작성 (`ToolExecutionContext, args → ToolResult`)
3. `handlers/index.ts`에 re-export 추가
4. `toolCatalog.ts`의 `TOOL_HANDLERS` map에 `[ToolName.XXX, handler]` 추가
5. `toolCatalog.ts`의 `TOOL_DISPLAY_NAMES`에 UI 텍스트 추가
6. `toolCatalog.ts`의 `JOB_TOOL_MATRIX`에서 해당 job(들)에 추가
7. 필요 시 `CACHEABLE_TOOLS`, `SHADOW_ALIASES` 갱신

artifact-scope/ant-source-scope 핸들러처럼 graph state에 의존하는 경우, `TOOL_HANDLERS`에는 추가하지 않고 job의 tool node wrapper에서 `registry.register(ToolName.XXX, handler)`로 런타임 등록한다.

## 경계

- 에이전트 아키텍처: [11-agent-architecture.md](11-agent-architecture.md)
- Code Job 그래프: [14-code-job.md](14-code-job.md)
- Design Job 그래프: [15-design-job.md](15-design-job.md)
- Planner Job 그래프: [16-planner-job.md](16-planner-job.md)
- Ask 시스템: [17-ask-system.md](17-ask-system.md)
- Figma 인프라: [26-figma-integration-infra.md](26-figma-integration-infra.md)
- 프롬프트 시스템: [13-prompt-system.md](13-prompt-system.md)
