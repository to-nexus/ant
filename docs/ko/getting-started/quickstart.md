# 빠른 시작

10분 안에 Ant을 띄우고 첫 코드 생성을 받아봅니다.

## 사전 조건

- Node 18.17+, pnpm 9+, Docker, Anthropic 또는 OpenAI API 키.
- 레포를 clone 하고 `pnpm install` 을 한 상태. 아직이라면
  영문 [installation](../../getting-started/installation.md) 참고.

## 1. 모든 것을 띄우기

```bash
# Redis + ChromaDB 시작
pnpm dev:infra

# LLM 키 설정
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# packages/ant-cli/.env 편집:
#   ANT_ANTHROPIC_API_KEY=sk-ant-...
#   ANT_ENCRYPTION_KEY=$(openssl rand -base64 32)

# 4개 백엔드 프로세스 + UI 동시 실행
pnpm dev:local:all
```

5개 동시 로그 스트림이 떠야 합니다 (`cli`, `ui`, 옵션으로 `site`,
그리고 개별 프로세스 스크립트를 쓰면 `realtime-server`, `job-worker`,
`preview-server`). UI는 [http://localhost:5173](http://localhost:5173)
에서 listen 한다고 표시됩니다.

## 2. UI 열기

[http://localhost:5173](http://localhost:5173)을 엽니다. 셋업 위저드가
다음을 묻습니다:

1. **프로젝트 만들기** — 이름, 레포 타입 (default *cloud* 메타지만 로컬
   모드에선 모두 머신 안에 머무름), 도메인 (웹/백엔드는 `service` 선택.
   `game` 도메인은 **개발 중** 이라 첫 사용에는 권장하지 않음).
2. **feature 만들기** — feature는 프로젝트 안의 작업 단위. 개념상은
   브랜치 + 워크스페이스.

## 3. 첫 디렉티브 입력

채팅 패널에 디렉티브를 입력합니다. 좋은 첫 디렉티브 예:

- `React + Tailwind 로 TODO 앱 만들어줘. 마감일 표시하고 우선순위로 그룹핑.`
- `히어로 / 기능 그리드 / 가격 섹션이 있는 마케팅 랜딩 페이지 만들어줘.`
- `Express로 REST API 만들어줘. /users, /posts 엔드포인트, SQLite 사용.`

전송하면 Ant은:

1. `triage` 와 `detect` phase를 돌려 요청을 분류.
2. 실행 tier (Reflex / OneShot / Exploratory / Task / RefsGrounded) 선택.
3. Tier 3+면 task 분해. kanban 패널이 카드로 채워짐.
4. task별로 `plan` + `execute` phase 실행. 에이전트의 도구 호출 (파일
   쓰기, 셸 명령) 이 workflow 스트림에 실시간 표시.
5. 산출물을 `workspaces/<project>/<feature>/codebase/` 에 저장.

각 phase가 무엇을 하는지: [concepts/jobs.md](../concepts/jobs.md)
(영문). tier 매트릭스: [concepts/execution-tiers.md](../../concepts/execution-tiers.md) (영문).

## 4. 라이브 프리뷰 보기

feature가 frontend를 만들면 preview 서버가 feature 워크스페이스
안에서 dev server를 띄우고 핫 리로드까지 노출합니다.

## 5. 반복

후속 디렉티브를 보내세요. 매 디렉티브가 새 잡이 되며, 실행 중 세션
상태가 재사용되어 에이전트가 방금 만든 것의 컨텍스트를 갖습니다.

유용한 후속:

- `보안 이슈 리뷰해줘.` — `rev-code` intent.
- `auth flow가 어떻게 동작하는지 설명해줘.` — `explain-code` intent.
- `다크 모드 토글 추가해줘.` — 기존 codebase 위 feature task.

## 방금 무슨 일이 일어났나

4-프로세스 modular monolith를 로컬에서 돌렸습니다:

```
ant-api (4100)  ────┐
ant-realtime(4101)──┼── Redis Pub/Sub + BullMQ ── ant-job (worker)
ant-preview (4102)──┘                                    │
                                                          ▼
                                              spawn된: job-runner
                                              LangGraph 실행
```

UI는 `ant-api`와 HTTP, `ant-realtime`과 SSE로 통신. 잡 상태, kanban
스냅샷, 중간 스트림은 모두 Redis 경유.

## 자주 따라오는 작업

| 작업                                  | 어디                                          |
|---------------------------------------|-----------------------------------------------|
| Figma 소스 추가                        | [figma-mcp.md](../../guides/design-input/figma-mcp.md) (영문) |
| Claude 디자인 번들 드롭                | [Claude handoff](../guides/design-input/claude-handoff.md)   |
| 프롬프트 커스터마이즈                  | [custom-prompts.md](../../guides/custom-prompts.md) (영문)    |
| 클라우드 배포                          | [cloud-deployment.md](../../guides/cloud-deployment.md) (영문)|
| infra 정지                            | `pnpm dev:infra:down`                         |

뭔가 안 됐다면 영문 [troubleshooting](../../getting-started/troubleshooting.md)
참고.
