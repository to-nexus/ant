# Workspace & Isolation

## 개요

ANT는 멀티테넌트 워크스페이스 구조를 사용한다. 조직, 사용자, 프로젝트, 피처 4단계로 물리적 디렉토리가 분리되며, Job 실행 시 환경변수 화이트리스트와 파일시스템 경계로 격리를 보장한다.

## 디렉토리 구조

```
{ANT_WORKSPACE_BASE_PATH}/
    {tenantId}/
        {userId}/
            {projectId}/
                config.json
                codebase/                       (main 브랜치)
                features/
                    {featureName}/
                        plan/                   (prd.md / gdd.md — 자유 형식 source 문서)
                        architecture/
                            system/             (fe-system-*.md, be-system-*.md, api-contract-*.md)
                            spec/               (spec-*.md)
                        visual/
                            ui/{ant,figma,handoff}/
                            game-art/{ant,figma,handoff}/
                        assets/
                            service/{icons,images,fonts,misc}/
                            game/{icons,images,entities,particles,projectiles,sfx,bgm,tilemaps,atlas,models}/
                            gen/sketches/
                        meta/
                            directives/{design,code,plan,visual,learn}/directive.md
                            evals/{prd,ui-design,system-design,code}/
                        sessions/
                            architect/
                                design.json
                                code.json
                                learn.json
                                debug/          (summary/, prompts/, plans/, logs/, tokens/, figma/)
                                runtime/        (design/, code/)
                            planner/
                                plan.json
                                debug/          (summary/, prompts/)
                            creator/
                                visual.json
                                debug/          (summary/, prompts/)
                            chat.json
```

Feature 디렉토리 구조의 SSOT는 `@ant/shared/canonical.ts`이다. 모든 정규 디렉토리/파일은 해당 파일에서 visibility 태그와 함께 정의되며, 런타임에서 `isCanonicalDir()`로 정규 경로 여부를 O(1) 판정한다.

## 격리 계층

### 조직 (Tenant) 레벨

`{ANT_WORKSPACE_BASE_PATH}/{tenantId}/` 디렉토리로 물리적 분리. 조직 A는 조직 B의 파일에 접근 불가.

`{tenantId}` 는 org 의 kind 에 따라 `local` / `individual` / `{team-id}` 중 하나다 (org 모델 SSOT: [40-org-model.md](40-org-model.md)). 로컬 모드는 `local/` 만, 클라우드 모드는 active org 에 따라 `individual/` **또는** `{team-id}/` 중 하나만 단독 사용한다 — 두 패밀리는 한 실행에서 공존하지 않는다.

### 사용자 (User) 레벨

`.../{tenantId}/{userId}/` 디렉토리로 분리. 같은 조직이어도 alice는 bob의 파일에 접근 불가.

클라우드에서 `{userId}` 는 **전체 소문자 이메일**이다 (공유 `individual` org 에서 email-local-part 가 충돌하므로, 그리고 active org 전환 시 신원이 안정적이어야 하므로). 로컬 모드는 `local`. email 의 `@`/`.` 는 모든 대상 FS 에서 안전하며 `:` 를 포함하지 않아 `:`-구분 Redis/세션키도 안전하다 (`assertColonFreeUserId` 가 단일 ingress 에서 강제). 멤버 경로 파라미터는 path-traversal 방어로 `..`/`/`/`:` 를 거부한다.

### 프로젝트 (Project) 레벨

`.../{userId}/{projectId}/` 디렉토리로 분리. 프로젝트 간 독립.

### 피처 (Feature) 레벨

`.../{projectId}/features/{featureName}/` 디렉토리로 분리. 동일 프로젝트에서 여러 피처를 동시 작업 가능. Feature당 동시 실행 Job은 1개.

## Job 환경변수 격리

Job 실행 시 자식 프로세스에 화이트리스트 방식으로 환경변수를 주입한다. `...process.env` spread를 사용하지 않는다.

주입 대상:
- 시스템 필수: `PATH`, `HOME`, `USER`, `LANG`, `NODE_ENV`
- Job 식별: `ANT_JOB_ID`, `ANT_PROJECT_ID`, `ANT_FEATURE`
- 경로: `ANT_PROJECT_PATH`, `ANT_FEATURE_PATH`
- 사용자 컨텍스트: `ANT_USER_ID`, `ANT_ORG_ID`, `ANT_USER_EMAIL`
- 인프라: `ANT_REDIS_URL`, `ANT_API_URL`
- Job 옵션: `ANT_OVERRIDE_DIRECTIVE`, `ANT_CHAT_SOURCE`

## 파일시스템 격리

`FileSystemPort`가 `ANT_FEATURE_PATH` 내부로만 파일 작업을 제한한다.

### Path Traversal 방어

요청 경로를 `path.normalize()`한 후 basePath로 시작하는지 검증한다. `../../other-user/file.txt` 같은 경로는 차단된다.

## 프로세스 격리

각 Job은 독립된 자식 프로세스에서 실행된다:
- 환경변수 완전 격리 (화이트리스트)
- stdout/stderr 파이프로 로그 수집
- cwd는 ant-cli 소스이지만, 파일 작업은 `ANT_FEATURE_PATH`로 이루어짐

## 경로 해석

`WorkspacePathResolver`가 환경변수와 모드에 따라 물리 경로를 결정한다.

| 환경 | 워크스페이스 루트 |
|------|-----------------|
| Local | `~/ant-workspaces/` |
| Cloud | `ANT_WORKSPACE_BASE_PATH` (EFS 마운트) |
| Custom | `ANT_WORKSPACE_BASE_PATH` 환경변수 |

## 경계

- Feature 구조 SSOT: [01-shared-contracts.md](01-shared-contracts.md) (`canonical.ts`)
- 환경변수 상세: [02-infrastructure.md](02-infrastructure.md)
- Job 실행 흐름: [10-job-lifecycle.md](10-job-lifecycle.md)
- IDE 격리: [23-cloud-ide.md](23-cloud-ide.md)
- 디버그 로깅 시스템: [29-debug-logging.md](29-debug-logging.md)
