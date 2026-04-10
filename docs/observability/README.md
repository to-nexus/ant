# Observability

## 이 문서의 위치

| 구분 | 폴더 | 질문 |
|------|------|------|
| **Testing** | `docs/testing/` | 코드가 정확히 동작하는가? |
| **Evals** | `outputs/evals/` | AI 출력물의 품질이 좋은가? |
| **Observability** | `docs/observability/` | 시스템이 어떻게 행동하고 있고, 어떻게 개선할 수 있는가? |

Observability는 Job 실행의 **운영 품질**을 관측하고, 패턴을 식별하여, 시스템을 지속 개선하는 규율이다. 단일 Job 검증에서 시작하여 자동화된 피드백 루프까지 확장한다.

## 관측 대상

OpenTelemetry의 3대 기둥과 ANT 디버그 로그의 매핑:

| 기둥 | ANT 디버그 카테고리 | 관측 질문 |
|------|---------------------|----------|
| **Traces** | `prompts/{jobId}.jsonl` | 어떤 템플릿을 조합해서 어떤 변수를 주입했는가? |
| **Metrics** | `tokens/{jobId}.jsonl` | 토큰을 얼마나, 어떤 효율로 사용했는가? |
| **Logs** | `logs/{jobId}.jsonl` | Job/Task가 어떤 경로로 실행되었는가? |
| **Summary** | `summary/{jobId}.json` | 전체 현황은 어떠한가? (진입점) |

데이터 레이어 상세: [29-debug-logging.md](../architecture/29-debug-logging.md)

## 로드맵

3단계로 구축한다. 각 단계는 이전 단계의 산출물 위에 쌓인다.

### Phase 1: 단건 검증 (Manual)

하나의 Job을 실행한 후, 디버그 로그를 검증 프로토콜에 따라 점검한다.

```
Job 실행 → debug/ 로그 생성 → 검증 프로토콜 수행 → PASS/WARN/FAIL 판정
```

**산출물:**
- 검증 프로토콜: [29-debug-logging.md § Job 검증 프로토콜](../architecture/29-debug-logging.md#job-검증-프로토콜)
- 기준 지표: [01-baseline-metrics.md](01-baseline-metrics.md)

**현재 상태: 설계 완료, 데이터 레이어 구현 대기**

### Phase 2: 배치 집계 (Semi-auto)

여러 Job의 Summary를 수집하여 통계적 패턴을 식별한다.

```
N개 Job Summary 수집 → 집계 분석 → 트렌드/이상치 식별 → 개선 포인트 도출
```

**집계 지표:**

| 지표 | 계산 방법 | 의미 |
|------|----------|------|
| Job 성공률 | `completed / total` | 전체 안정성 |
| 평균 cacheHitRatio | Job별 ratio의 중앙값 | 프롬프트 캐시 효율 추세 |
| 평균 태스크 반복 횟수 | `tokens/` 행 수 / 태스크 수 | 수렴 효율 |
| Issue 빈도 분포 | issue type별 count | 가장 빈번한 문제 유형 |
| 태스크 실패율 | `failed / total tasks` (전체 Job 합산) | 태스크 레벨 안정성 |
| billableInput 분포 | Job별 billable의 p50/p90/p99 | 비용 예측 가능성 |

**수집 방식:**
- 로컬: `sessions/{agent}/debug/summary/` 디렉토리에서 `*.json` glob
- 클라우드: 유저 리포트 업로드 (Phase 3에서 자동화)

### Phase 3: 자동 피드백 루프 (Automated)

유저 리포트 수집, 벡터 DB 인덱싱, 패턴 인식을 통해 시스템 개선을 자동화한다.

```
유저 리포트 수집 → 벡터 DB 인덱싱 → 패턴 클러스터링 → 개선 제안 생성 → 시스템 반영
```

**파이프라인:**

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│ User Report │────▶│  Collector   │────▶│  Vector DB   │────▶│  Analyzer   │
│ (Summary +  │     │  (수집/정규화) │     │  (ChromaDB)  │     │ (패턴 인식)  │
│  context)   │     └──────────────┘     └──────────────┘     └──────┬──────┘
└─────────────┘                                                      │
                                                                     ▼
                    ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
                    │   System     │◀────│  Proposal    │◀────│  Clustered  │
                    │  Improvement │     │  Generator   │     │  Insights   │
                    └──────────────┘     └──────────────┘     └─────────────┘
```

**유저 리포트 구조:**

```json
{
  "reportId": "rpt-uuid",
  "timestamp": "2025-01-15T10:05:30Z",
  "source": "user_feedback",

  "jobContext": {
    "jobId": "abc-123",
    "jobType": "code",
    "featureName": "user-auth",
    "summary": { "...": "summary/{jobId}.json 내용 인라인" }
  },

  "feedback": {
    "satisfaction": "poor",
    "category": "output_quality | performance | prompt_issue | other",
    "description": "생성된 코드에서 인증 미들웨어가 누락됨"
  },

  "debugSnapshot": {
    "issues": ["...summary.issues 배열"],
    "tokenStats": { "billableInput": 62200, "cacheHitRatio": 0.784 },
    "failedTasks": ["task-3"]
  }
}
```

**벡터 DB 활용 (ANT의 learn 시스템 연동):**

| 인덱싱 대상 | 벡터화 내용 | 검색 시나리오 |
|-------------|-----------|--------------|
| 유저 피드백 | `feedback.description` + `feedback.category` | "비슷한 불만이 과거에 있었나?" |
| Issue 패턴 | `summary.issues` 배열 직렬화 | "이 issue 조합이 이전에 발생한 적 있나?" |
| 프롬프트 구조 | `prompts/` JSONL의 `templatePath` + `injectedVariables` 키 | "이 프롬프트 패턴에서 문제가 반복되나?" |
| 실패 컨텍스트 | `task_fail` 이벤트의 `reason` + `errorMessage` | "유사한 실패가 어떤 조건에서 발생하나?" |

**클러스터링 → 개선 제안:**

벡터 유사도 검색으로 리포트를 클러스터링한 후, 각 클러스터에서 공통 패턴을 추출한다:

| 클러스터 패턴 예시 | 개선 대상 |
|-------------------|----------|
| "contract_violation + missing designTokens" 반복 | 해당 템플릿의 변수 주입 경로 점검 |
| "code job + cacheHitRatio < 0.3" 집중 | execute 노드의 프롬프트 prefix 안정성 개선 |
| "task_fail + recursion_limit" 특정 taskType에 집중 | 해당 taskType의 재귀 한도 또는 종료 조건 조정 |
| 유저 "인증 관련 코드 품질 낮음" 피드백 클러스터 | 인증 관련 프롬프트/컨텍스트 강화 |

## 폴더 구조

```
docs/observability/
    README.md                     이 문서 (개요 + 로드맵)
    01-baseline-metrics.md        정상 범위 기준표 (Phase 1)
    02-token-time-tracking.md     토큰 비용 모델 + 시간 추적 + 캐시 효율 분석
    03-aggregation-queries.md     배치 집계 쿼리 정의 (Phase 2)
    04-feedback-pipeline.md       유저 리포트 수집/분석 파이프라인 (Phase 3)
```

## 경계

- 디버그 데이터 레이어: [29-debug-logging.md](../architecture/29-debug-logging.md)
- 단건 검증 프로토콜: [29-debug-logging.md § Job 검증 프로토콜](../architecture/29-debug-logging.md#job-검증-프로토콜)
- 출력물 품질 평가: `outputs/evals/` (Observability와 별개 — Evals는 "결과가 좋은가", Observability는 "과정이 건강한가")
- 벡터 DB 시스템: [28-context-management.md](../architecture/28-context-management.md)
- 프롬프트 시스템: [13-prompt-system.md](../architecture/13-prompt-system.md)
