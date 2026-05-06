# 디자인 입력 채널

Ant은 **3개의 1급 디자인 소스**를 받습니다. 어떤 걸 고르느냐가
중요한데, 각각 해석 컨트랙트(prompt, artifact policy, verification
규칙)이 다르기 때문입니다.

Hard-exclusive 강제의 SSOT는
[`packages/ant-shared/src/canonical.ts`](../../../packages/ant-shared/src/canonical.ts)
의 `normalizeUiSourceRefs`. 구속력 있는 규칙은 영문
[AGENTS.md § UiSource](../../../AGENTS.md#uisource--three-hard-exclusive-ui-inputs).

## 세 소스

| 소스      | 경로                          | 무엇을 떨어뜨리는가                  | 해석 컨트랙트                                  |
|-----------|-------------------------------|--------------------------------------|------------------------------------------------|
| `ant`     | `visual/ui/ant/`              | `ui-tokens.json`, `ui-spec.json`, `ui-assets.json` (design 잡이 자동 생성) | 스키마 기반: 토큰은 재사용 가능한 디자인 primitive, spec은 레이아웃 의도 정의. |
| `figma`   | `visual/ui/figma/figma.json` | Figma URL + nodeId 만                | Live MCP 탐색: 에이전트가 prompt 시점에 frame, variable, style을 fetch. |
| `handoff` | `visual/ui/handoff/**`        | 자유 형식 번들 (HTML/CSS/MD/PNG/JSON) | 관찰 only (FPOP): 에이전트는 관찰 가능한 것만 보고, 스키마를 추론하지 않음. |

이 셋은 워크스페이스 단위로 **hard-exclusive**. 한 RAC에 섞으면
safety net 레이어 (`ArtifactPoolView.uiSource()` 와
`validateUiSourceExclusivity`) 가 throw.

## 왜 셋인가

디자인이 어디서 온 지에 따라 사용 best practice가 다릅니다.

### `handoff` — Claude artifact 등 자유 형식 번들

종종 가장 진입장벽이 낮은 입구. Claude.ai 또는 다른 LLM 워크스페이스에서
UI 디자인을 굴리던 분에게:

- 원하는 걸 묘사하는 HTML/CSS/Markdown 이 있고
- 스크린샷 한두 장이 있고
- 어쩌면 디자인 토큰의 JSON dump가 있을 것.

번들을 `visual/ui/handoff/` 에 떨어뜨리면 Ant이 **관찰 only** 디자인
소스로 취급합니다. Prompt가 명시적으로 에이전트에게 말합니다:

> 관찰 가능한 것을 inspect하라. 스키마를 추론하지 말라. 입력이 토큰을
> 선언하지 않는 한 토큰이 컨텍스트 간 재사용 가능하다 가정하지 말라.

이게 FPOP ("First-Principles Observation Prompting") 의 실현. 자유
형식 입력의 messy함을 보존하면서, 그것이 정규(canonical)인 척 하지
않습니다. Figma 라이선스 불필요. 변환 불필요. 그냥 파일 떨어뜨림.

handoff 소스는 **디자인이 다른 도구에 살고** 그걸 옮기고 싶지 않을 때
가장 가치 있습니다.

### `figma` — 양방향 Figma MCP

Figma 프로젝트가 있다면, Ant이 그걸 가리키게 하고 **prompt 시점에**
필요한 걸 fetch하게 두는 게 맞습니다. `visual/ui/figma/figma.json` 은
메타데이터일 뿐:

```json
{
  "url": "https://www.figma.com/design/<fileKey>/...",
  "nodeId": "1:23"
}
```

Figma MCP (로컬 모드는 desktop, 클라우드 모드는 HTTP bridge) 가 탐색을
처리: variable, style, frame tree, component instance. 에이전트가 필요할
때 `get_design_context`, `get_screenshot`, `get_metadata` 호출.

역방향도 됩니다: design 잡이 `use_figma` (canvas write 도구) 로 Figma에
역기록 가능하고, Code Connect 매핑이 component instance 를 코드와
정합 유지.

### `ant` — 생성된 토큰 + spec

기존 디자인 시스템이 없는 greenfield 프로젝트라면, Ant에게 **디자인
시스템 자체를 생성**하도록 요청합니다. design 잡 (`design` jobtype) 이
다음 중 하나로 실행:

- `gen-ui-figma` Figma 참조가 있으면.
- `gen-ui-desc` 텍스트 묘사가 있으면.

`ui-tokens.json` (palette, spacing, type scale, radii, shadows),
`ui-spec.json` (sections + components), `ui-assets.json` (asset catalog)
을 produce.

이후 코드 잡은 이를 **스키마 기반** 권위 입력으로 읽습니다. 토큰
이름이 task 간 안정적이고, spec이 레이아웃 의도를 정의.

## 에이전트가 어떻게 소스를 고르나

안 고릅니다. **당신이** 세 슬롯 중 하나를 RAC에 채워서 결정합니다:

| RAC 슬롯                              | Resolved UiSource |
|---------------------------------------|-------------------|
| `visual/ui/ant/**` 가 `refs` 또는 `context` | `ant`        |
| `visual/ui/figma/figma.json` 이 `refs` 또는 `context` | `figma` |
| `visual/ui/handoff/**` 가 `refs` 또는 `context` | `handoff` |

프론트엔드 위저드가 올바른 슬롯 고르는 걸 도움. 백엔드의
`normalizeUiSourceRefs` 가 매 RAC 생성 site에서 hard-exclusive 강제.

워크스페이스에 우연히 여러 소스가 디스크 상에 있다면, `pickDefaultUiSourceRefs`
가 우선순위에 따라 가장 높은 걸 고름 (`UI_SOURCE_PRIORITY` in
`canonical.ts`). 커스텀 흐름은 RAC를 명시적으로 편집.

## Prompt가 소스마다 무엇을 하나

| Phase             | `ant`                                      | `figma`                                  | `handoff`                                |
|-------------------|--------------------------------------------|------------------------------------------|------------------------------------------|
| `code.decompose`  | 토큰 인벤토리; design-system task ladder  | Figma 도구 list; 필요 시 live-fetch     | 번들 관찰; 스키마 추론 금지              |
| `code.plan`       | 토큰 → component class 매핑                | frame layout fetch; Figma 변수 → 토큰 매핑 | 관찰 가능한 것 읽기; 입력 그대로 존중    |
| `code.execute`    | 이름으로 토큰 적용                          | style fetch; figma vs code drift 존중   | 번들의 어휘에 매칭                        |

각 경로는 `templates/jobs/code/base/injections/` 의 per-source partial로 와이어링:

- `ui-source-ant.md`
- `ui-source-figma.md`
- `ui-source-handoff.md`

`ui-source-dispatch` partial이 render 시점에 알맞은 걸 선택.

## 게임 도메인 미러

게임 프로젝트는 `visual/ui/` 대신 `visual/game-art/` 사용. 서브소스
구조는 UI를 미러: `ant/` 가 LLM 생성 정규 sub-source
(`game-art-tokens.json`, `game-art-assets.json`, `game-art-spec.json`).
`figma/` 와 `handoff/` 는 Phase 5+ 예약.

`gameArtTier` 와 `visualTier` 는 vertical split (D28): service 프로젝트는
절대 `gameArtTier` 를 갖지 않고, 게임 프로젝트는 절대 `visualTier`
를 갖지 않음. 매트릭스 게이트는 영문
[AGENTS.md § Domain-Surface Boundary](../../../AGENTS.md).

## 다음으로 읽을 것

- [Claude handoff 가이드](../guides/design-input/claude-handoff.md) —
  실용 가이드.
- 영문 [figma-mcp.md](../../guides/design-input/figma-mcp.md),
  [ant-canonical.md](../../guides/design-input/ant-canonical.md).
- 영문 [internals/25-design-pipeline.md](../../internals/25-design-pipeline.md)
  — pipeline internals.
