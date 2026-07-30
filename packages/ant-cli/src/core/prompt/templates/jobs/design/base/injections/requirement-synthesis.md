════════════════════════════════════════════════════════════════════════════════
## Requirement Synthesis — Interpret the Directive, Don't Transcribe It
════════════════════════════════════════════════════════════════════════════════

**Principle**: A user directive is raw intent, not a finished requirement list. The
requirements, decisions, and criteria you author are the SYNTHESIS of that intent
into distinct verifiable outcomes — never a 1:1 copy of the directive's bullet
points. A loose list of a dozen instructions may resolve to a handful of cohesive
requirements. Read the user charitably: author what they are trying to ACHIEVE, not
merely what they literally typed.

**The item count reflects distinct OUTCOMES, not directive line count.** When two
directive items describe one observable end-state, they are ONE requirement. Padding
the set to match the directive's length is the exact failure this section prevents.

### Synthesis operations

| Operation | What to do | Blind spot it guards |
|---|---|---|
| **Group** | Consolidate directive items serving one outcome into one cohesive requirement. | Splitting one intent across many items inflates the document and hides the real gate. |
| **De-conflict** | When two items contradict, resolve to ONE decision. NEVER carry both sides as separate requirements. | A document holding both sides of a contradiction cannot be satisfied downstream. |
| **Upgrade** | When a clearly-superior alternative exists AND the evidence makes it clearly right, author it in place of the literal request. | Low-confidence "improvements" are scope drift — see the guardrail. |
| **Correct** | When the directive rests on an evident misconception (a named symbol that does not exist, an impossible ordering), author the corrected requirement. | Silently encoding a false premise yields something that cannot be built. |
| **Distill** | Reduce the survivors to the minimal set of distinct, verifiable outcomes. | Length-matching the directive re-introduces transcription. |

### Guardrail — bounded agency, surfaced naturally

- **Never silently drop a genuine need.** Consolidation MERGES; it does not delete.
- **Agency is bounded by CONFIDENCE.** Apply an Upgrade or Correction only when the
  evidence makes it clearly right. When a contradiction or ambiguity is real and you
  cannot resolve it with confidence, ASK via `<clarify>` — do not guess and bury the
  guess.
- **Surface material judgment calls in your `<reply>`, conversationally** — a
  resolved contradiction, an overridden or dropped explicit request, a corrected
  misconception. This is a natural one-line explanation of a call you made, NOT a
  per-item ledger and NOT a decisions-ledger section in the document. Routine grouping
  needs no note.

⚠️ **Blind spot**: The default failure is transcription — echoing each directive
bullet as its own item FEELS faithful but produces a bloated, internally
contradictory, un-synthesized document. Faithfulness is owed to the user's GOAL, not
to their phrasing.

{{#if planText}}
**Handoff (sealed plan present)**: The plan phase already performed this synthesis.
RENDER that decision faithfully and do NOT re-open resolved contradictions or
re-group settled requirements — the decision is sealed.
{{/if}}
