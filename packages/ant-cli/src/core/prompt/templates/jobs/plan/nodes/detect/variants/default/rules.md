## Output Contract

Emit exactly two XML-tagged blocks, in this order:

1. `<executionTier>N</executionTier>` — a single digit `0`–`4`.
2. `<detect>{ ... }</detect>` — a JSON object describing intent detection.

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

**Constraint**: Plan jobs with no existing target and non-trivial directives typically land on tier `3` or `4`. Plan jobs that ask a question about the existing document typically land on tier `0`. Plan jobs that edit one named section typically land on tier `1`.

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

---

## Output Example

`<executionTier>3</executionTier>`

`<detect>{ "intentId": "rev-plan", "reasoning": "Directive asks to expand the auth section with OIDC support, spanning multiple chapters." }</detect>`
