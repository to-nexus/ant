# 주간보고 문서 생성

## Context
2026-03-16 ~ 2026-03-23 (KST) 기간의 커밋 로그를 기반으로 주간보고 작성. Confluence 공유용 pure text/간단한 마크다운.

## 작업
- `docs/tmp/weekly-report-2026-03-16.md` 파일 생성
- 51개 커밋을 의미 단위로 그룹화하여 간결하게 정리

## 그룹화 계획

1. **Git 안정성 개선** — clone race condition, proxy timeout, branch 충돌, local-only git 지원
2. **코드 생성 파이프라인 강화** — build verification, batch split, error task 처리, checkpoint 복구
3. **프롬프트 시스템 리팩토링** — composable decisions 아키텍처, FPOP 위반 수정, 템플릿 재구성
4. **UI/UX 개선** — git 상태 표시, toast 알림, ANSI 변환, SSE 안정성
5. **프리뷰 시스템** — TOML config 지원, asset serving, dev server verification
6. **인프라/안정성** — LLM retry, stream idle timeout, SSE broadcast 유실 방지, Mac sleep 대응
7. **설계/아키텍처** — shared component pipeline, uiBarrier, design-system TaskType, human-readable jobId
8. **문서/테스트** — architecture docs 재구성, flaky test 제거

## Verification
- 파일이 docs/tmp/에 정상 생성되었는지 확인
