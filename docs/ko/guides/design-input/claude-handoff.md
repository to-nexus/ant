# Claude handoff

Claude.ai artifact (또는 자유 형식 디자인 번들) 을 워크스페이스에
떨어뜨리면 Ant이 그걸 디자인 소스로 사용해 코드를 생성합니다.

종종 **가장 진입장벽이 낮은 입구**입니다. Figma 라이선스 불필요,
MCP 셋업 불필요, 스키마 변환 불필요. 그냥 파일.

## 무엇을 떨어뜨릴 수 있나

`handoff` 소스는 **관찰 only**. 에이전트가 읽을 수 있는 건 다 OK:

- HTML 페이지 (`.html`)
- CSS / SCSS 파일
- UI를 묘사하는 Markdown 노트
- 스크린샷 / 목업 (`.png`, `.jpg`)
- 토큰 dump (`.json`)
- 만들어야 할 걸 설명한 채팅 transcript 복사본

에이전트는 **숨은 스키마를 추론하지 않습니다.** 제공된 걸 컨트랙트로
간주: FPOP "Observable over Assumed" 규칙 적용. 토큰을 선언했으면
토큰이고, 선언 안 했으면 에이전트가 만들어내지 않음.

## 떨어뜨리기

```bash
# feature 워크스페이스 안에서
mkdir -p visual/ui/handoff
cp ~/Downloads/claude-artifact-export/* visual/ui/handoff/
```

Claude.ai에서 ZIP으로 export 했으면, 그냥 `visual/ui/handoff/` 안에
unzip. 다음에 위저드 열 때 자동 인식.

위저드의 "Bring your own design" 단계가 슬롯이 채워졌음을 표시:

```
Design source:
  ✓ visual/ui/handoff/  (3 files)
```

## 디렉티브에 연결

번들 기반 코드 요청 디렉티브:

```
visual/ui/handoff/ 의 디자인대로 페이지 만들어줘.
스타일은 Tailwind, visual hierarchy와 색상 정확히 매칭.
```

내부적으로 Ant은:

1. RAC를 resolve: handoff 디렉토리가 `context` (또는 intent에 따라
   `ref`) artifact 슬롯이 됨.
2. `ui-source-handoff` partial을 선택 — 에이전트에게 "관찰하되 추론
   말라" 지시.
3. 디자인대로 분해 + 실행.

슬롯 메커니즘과 어떤 intent가 소스를 `ref` vs `context` 로 읽는지는
[concepts/design-input-channels.md](../../concepts/design-input-channels.md)
참고.

## 잘 동작하는 예

- 단일 페이지 목업: `index.html` + `style.css` + `screenshot.png` 드롭.
- 다중 페이지 번들: 파일명 descriptive 하게
  (`landing.html`, `pricing.html` 등) — 에이전트가 매핑 가능.
- 토큰 heavy: 명명된 값을 가진 `tokens.json` 포함. handoff prompt가
  토큰을 그대로 존중.
- 주석 달린 목업: 스크린샷 옆에 의도 묘사하는 `notes.md` 드롭
  ("primary 버튼은 azure, hover 상태는 10% 어둡게").

## 덜 잘 동작하는 것

- **HTML 없는 복잡한 스크린샷의 픽셀 정확 재현.** 이미지만 있으면
  에이전트가 visual hierarchy는 매칭하지만 pixel-match는 못 함.
  픽셀 정확 출력 필요하면 source HTML/CSS 포함.
- **암묵적 디자인 시스템.** 번들이 토큰을 비공식적으로 사용하면
  ("blue-600 어디서나 사용") 명시적으로 적기. FPOP 규칙이 추측 막음.
- **거대한 번들.** 관련 있는 것만 드롭. 에이전트는 RAC에 있는 걸 읽음;
  더 큰 디렉토리는 토큰 비용 더 큼.

## 트러블슈팅

### 에이전트가 디자인을 못 찾는다고 함

슬롯이 RAC에 있는지 확인. 위저드가 handoff 디렉토리를 채워진 소스로
표시해야 함. UI를 슬롯에 포함하지 않는 intent (e.g. `gen-code-directive`
without design) 의 RAC면 handoff 콘텐츠가 안 읽힘.

에이전트가 그걸 사용하게 강제하려면, 디렉티브 보내기 전에 위저드의
`Reference` 또는 `Context` 슬롯을 채우기.

### 에이전트가 번들에 없는 토큰을 만들어냄

흔한 원인:

- Tier 0/1 디렉티브 (`버튼 추가`) 를 디자인 명시 없이 사용. direct
  경로는 handoff 슬롯을 안 읽음.
- handoff partial이 번들이 토큰을 선언 안 할 때 에이전트가 토큰 도입
  허용. 막으려면 명시적 토큰 파일을 번들에 포함.

### Claude로 변경사항 round-trip 하고 싶다

현재 단방향. handoff 소스는 읽힘; Ant 산출물은 `codebase/` 에 떨어짐.
미래 버전은 Claude에 다시 붙여넣을 "무엇이 바뀌었나" 리포트를 emit할
수 있음.

## 비교

| 질문                                   | `handoff`     | `figma`              | `ant`                |
|----------------------------------------|---------------|----------------------|----------------------|
| 라이선스 필요?                          | None          | Figma                | None                 |
| 셋업 비용                              | 0             | MCP server           | design 잡 한 번      |
| 스키마                                 | None (FPOP)   | Figma vars + styles  | `ui-tokens.json`     |
| 적합                                   | 기존 Claude 디자인 | Figma 팀         | Greenfield           |
| 소스로 round-trip                      | No            | Yes (Code Connect)   | Within Ant           |

## 다음으로 읽을 것

- 영문 [figma-mcp.md](../../../guides/design-input/figma-mcp.md) —
  양방향 Figma 소스.
- 영문 [ant-canonical.md](../../../guides/design-input/ant-canonical.md) —
  design 잡으로 토큰 생성.
- [concepts/design-input-channels.md](../../concepts/design-input-channels.md)
  — 개념 배경.
