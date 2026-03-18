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
                codebase/                   (main 브랜치)
                features/
                    {featureName}/
                        inputs/
                            sources/        (prd.md, directive.md)
                            references/     (screens/, components/)
                            assets/
                        outputs/
                            design/         (설계 문서)
                            plan/           (PRD staging)
                            evals/          (평가 리포트)
                        sessions/
                            architect/
                                design.json
                                code.json
                            planner/
                                plan.json
                            chat.json
```

## 격리 계층

### 조직 (Tenant) 레벨

`{ANT_WORKSPACE_BASE_PATH}/{tenantId}/` 디렉토리로 물리적 분리. 조직 A는 조직 B의 파일에 접근 불가.

### 사용자 (User) 레벨

`.../{tenantId}/{userId}/` 디렉토리로 분리. 같은 조직이어도 alice는 bob의 파일에 접근 불가.

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

- 환경변수 상세: [02-infrastructure.md](02-infrastructure.md)
- Job 실행 흐름: [10-job-lifecycle.md](10-job-lifecycle.md)
- IDE 격리: [23-cloud-ide.md](23-cloud-ide.md)
