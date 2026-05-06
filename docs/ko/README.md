# Ant 문서 (한국어)

한국 커뮤니티용 미러입니다. 핵심 4개 문서가 우선 번역되어 있고, 나머지는
영문판을 참고하시거나 기여해 주세요. 영문 문서는 [`docs/`](../) 입니다.

## 어떤 문서부터 봐야 하나

| 당신은…                                    | 보세요                                              |
|--------------------------------------------|-----------------------------------------------------|
| Ant이 처음이라 일단 돌려보고 싶음          | **[시작하기 / quickstart](getting-started/quickstart.md)** |
| 동작 원리를 이해하고 싶음                  | **[개념 / 아키텍처](concepts/architecture.md)**     |
| 왜 spec-driven인지 알고 싶음               | **[개념 / spec-driven](concepts/spec-driven.md)**   |
| Claude 디자인을 그대로 가져다 쓰고 싶음    | **[가이드 / Claude handoff](guides/design-input/claude-handoff.md)** |
| 영어 원문을 보고 싶음                      | [`../README.md`](../README.md)                       |
| Ant 자체를 수정하고 싶음 (기여자)         | [`../../AGENTS.md`](../../AGENTS.md)                 |

## 한국어 미러 트리

```
docs/ko/
├── README.md                                 (이 파일)
├── getting-started/
│   └── quickstart.md
├── concepts/
│   ├── architecture.md
│   ├── spec-driven.md
│   └── design-input-channels.md
└── guides/
    └── design-input/
        └── claude-handoff.md
```

## 번역 규약

- **프롬프트 템플릿은 영어 only.** 한국어 미러 안에서도 코드 블록과 LLM 프롬프트
  예시는 영어로 둡니다 — Ant의 런타임은 영어 프롬프트로 동작합니다.
- **이름·고유명사**: Ant, Claude, Figma 등은 그대로.
- **기술 용어**: 한국어 + 괄호 영어 ("실행 tier (execution tier)") 또는 익숙한 영문
  그대로 (LangGraph, Redis, BullMQ).

## 한국어 번역에 기여하기

번역 누락이 있는 영문 페이지를 우선 추가해 주세요:

- `getting-started/installation.md`
- `getting-started/first-feature.md`
- `getting-started/troubleshooting.md`
- `concepts/agents.md`
- `concepts/jobs.md`
- `concepts/execution-tiers.md`
- `concepts/workspace.md`
- `guides/self-hosting.md`
- `guides/cloud-deployment.md`
- `guides/design-input/figma-mcp.md`
- `guides/design-input/ant-canonical.md`
- `guides/custom-prompts.md`
- `guides/observability.md`
- `reference/*` (CLI, env-vars, API, shared-types, redis-keys)

PR 환영합니다 — 영문 원본 헤더를 그대로 두고 본문만 한국어로 옮기시면 충분합니다.
