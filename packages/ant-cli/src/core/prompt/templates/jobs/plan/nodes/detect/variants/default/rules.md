## Output Contract

{{#if explicitDomain}}
Emit exactly two XML-tagged blocks, in this order:

1. `<executionTier>N</executionTier>` — a single digit `0`–`4`.
2. `<detect>{ ... }</detect>` — a JSON object describing intent detection.

Domain is already committed (`{{explicitDomain}}`) — do NOT emit `<domain>`.
{{else}}
Emit exactly three XML-tagged blocks, in this order:

1. `<executionTier>N</executionTier>` — a single digit `0`–`4`.
2. `<domain>game|service</domain>` — universal project domain classification.
3. `<detect>{ ... }</detect>` — a JSON object describing intent detection.
{{/if}}

Do NOT emit markdown fences, prose, or any other text.

---

## ExecutionTier Classification

**Observation target**: The breadth of work implied by the directive, the mode, and the reference documents (if any) listed above.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only answer; no plan document changes. Direct answers to questions about an existing document fall here when they require no re-observation. |
| `1` | OneShot       | Single concrete edit to the plan document; target section is known from the directive. |
| `2` | Exploratory   | Must observe the document/refs before choosing what to change; still a single cohesive edit. |
| `3` | Task          | Multiple independent sections of the plan must be revised or generated, driven by the directive alone. |
| `4` | RefsGrounded  | Multiple sections systematically grounded in the reference documents supplied above. |

**Constraint**: Classify by observation. The same five principles apply whether the plan already exists or not, whether the directive is short or long. A one-line edit is tier `1`; a multi-section revision derived from a supplied research note is tier `4`.

**Constraint**: Reference presence alone does NOT force Tier 4. Only when the plan revision is systematically grounded in the refs does the tier become `4`.

⚠️ **Blind spot**: The plan document itself (the one being revised) does NOT count as a grounding ref for Tier 4 purposes — Tier 4 is about EXTERNAL refs (other PRDs, specs, research notes) that the new/revised plan must absorb.

---

## Intent Classification

Select exactly one `intentId`:

| intentId | When to select |
|---|---|
| `gen-plan` | No existing target document; the directive requests a new plan. |
| `rev-plan` | The directive asks to modify / improve / update / fix / expand the existing plan. |
| `explain-plan` | The directive asks to understand / analyze / query / summarize the existing plan, with no modification. |

{{#unless explicitDomain}}
---

## Domain Classification

Phase 1 supports two domains: `game` and `service`. Pick exactly one based on directive signals (PRD content is unavailable at plan-detect time, so signals are weak — default to `service` when ambiguous).

| Domain | Strong signals |
|---|---|
| `game` | 점수, 레벨, 스테이지, 플레이어, 매치, 콤보, NPC, 적, SFX, 게임플레이, 코어루프, 보스, 인벤토리, 캐릭터, 시뮬레이션, 카드, 보드, 퍼즐, 시점(2D/3D), scene, sprite, 게임잼 |
| `service` | 사용자, 인증, 계정, 결제, API, endpoint, dashboard, CRM, SaaS, 이메일, 권한, role, 통합, 워크플로 |

**Default rule**: when neither set of signals is dominant or signals overlap, emit `service`. Explicit user `@domain:` mention always wins via `actionMetadata.domain` and bypasses this inference entirely.
{{/unless}}

---

## Output Example

{{#if explicitDomain}}
`<executionTier>3</executionTier>`

`<detect>{ "intentId": "rev-plan", "reasoning": "Directive asks to expand the auth section with OIDC support, spanning multiple chapters." }</detect>`
{{else}}
`<executionTier>3</executionTier>`

`<domain>service</domain>`

`<detect>{ "intentId": "rev-plan", "reasoning": "Directive asks to expand the auth section with OIDC support, spanning multiple chapters." }</detect>`
{{/if}}
