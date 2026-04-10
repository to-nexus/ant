# Baseline Metrics

Job 검증 프로토콜에서 사용하는 정상/이상 판정 기준값. 실제 운영 데이터를 수집하면서 지속적으로 보정한다.

## Token 효율

| 지표 | 정상 범위 | WARNING | FAIL | 측정 위치 |
|------|----------|---------|------|----------|
| cacheHitRatio (iterative 노드, callIndex > 0) | >= 0.5 | 0.3 - 0.5 | < 0.3 | `tokens/{jobId}.jsonl` |
| callIndex (태스크당 최대 LLM 호출 수) | <= 12 | 13 - 19 | >= 20 | `tokens/{jobId}.jsonl` |
| cacheCreationTokens (callIndex > 0) | < inputTokens * 0.3 | 0.3 - 0.7 | >= inputTokens * 0.7 | `tokens/{jobId}.jsonl` |
| 저 cacheHitRatio 연속 횟수 | 0 | 1 - 2회 연속 | 3회 이상 연속 | `tokens/{jobId}.jsonl` |
| 저 cacheHitRatio 비율 (전체 call 대비) | < 10% | 10 - 30% | > 30% | `tokens/{jobId}.jsonl` |

### cacheHitRatio 해석

```
0.9+  : 우수 — prefix가 안정적으로 캐시됨
0.7   : 양호 — 일부 변동 있으나 정상 범위
0.5   : 경계 — 프롬프트 구조 점검 권장
0.3   : 위험 — prefix가 매 호출 변경되고 있음
0.1   : 심각 — 캐시가 사실상 동작하지 않음
```

### callIndex 해석

```
1-5   : 정상 — 빠른 수렴
6-12  : 양호 — 복잡한 태스크에서 예상되는 범위
13-19 : 경고 — 수렴이 느림, 프롬프트/검증 로직 점검 필요
20+   : 위험 — 사실상 무한 루프, 태스크 품질 보장 불가
```

## 프롬프트 건전성

| 지표 | 정상 | WARNING | FAIL | 측정 위치 |
|------|------|---------|------|----------|
| contractViolations | 0건 | - | 1건 이상 | `prompts/{jobId}.jsonl` |
| hardcodedContent 사용 | 0건 | 1건 이상 | - | `prompts/{jobId}.jsonl` |
| templatePath 누락 | 0건 | - | 1건 이상 | `prompts/{jobId}.jsonl` |
| tokenEstimate | 100 - 100,000 | 50 - 100 또는 100K - 200K | < 50 또는 > 200K | `prompts/{jobId}.jsonl` |
| 기대 노드 누락 | 전체 노드 출현 | - | triage/decompose/execute 중 누락 | `prompts/{jobId}.jsonl` |

### 기대 노드 (jobType별)

| jobType | 필수 노드 | 선택 노드 |
|---------|----------|----------|
| code | triage, decompose, execute | planGeneration, docGen |
| design | triage, execute | docGen |
| plan | triage, generate | - |
| learn | triage | - |

## 실행 안정성

| 지표 | 정상 | WARNING | FAIL | 측정 위치 |
|------|------|---------|------|----------|
| task_fail | 0건 | - | 1건 이상 | `logs/{jobId}.jsonl` |
| execute_interrupted | 0건 | - | 1건 이상 | `logs/{jobId}.jsonl` |
| violation_detected (동일 taskId 내) | 0-2건 | 3-4건 | 5건 이상 | `logs/{jobId}.jsonl` |
| tool_call error | 0건 | 1건 이상 | - | `logs/{jobId}.jsonl` |
| profile_missing | 0건 | 1건 이상 | - | `logs/{jobId}.jsonl` |
| job status | completed | interrupted | failed / 없음 | `summary/{jobId}.json` |

## Job 레벨 종합

| 지표 | 정상 범위 | 비고 |
|------|----------|------|
| 전체 elapsedMs (code) | < 600,000 (10분) | 태스크 수에 비례 |
| 전체 elapsedMs (design) | < 300,000 (5분) | 챕터 수에 비례 |
| 전체 billableInput (code) | < 500,000 tokens | 태스크 5개 기준 |
| 전체 billableInput (design) | < 300,000 tokens | 챕터 3개 기준 |
| tasks.failed / tasks.total | 0% | 0이 아니면 FAIL |

## 기준값 보정 규칙

이 문서의 수치는 초기 추정값이다. 다음 기준으로 보정한다:

1. **Phase 2 집계 시**: N >= 50개 Job의 Summary를 수집한 후, 각 지표의 p50/p90/p99를 계산하여 정상 범위를 재설정
2. **Phase 3 피드백 시**: 유저 리포트의 satisfaction과 지표 값의 상관관계를 분석하여, "유저가 만족한 Job"의 지표 분포를 정상 범위로 채택
3. **분기별 리뷰**: 시스템 개선(프롬프트 변경, 캐시 전략 변경 등) 후 기준값이 더 이상 유효하지 않을 수 있으므로 분기마다 재검토

보정 시 이 문서를 직접 수정하고, 변경 이력을 커밋 메시지에 남긴다.
