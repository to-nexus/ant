### Pipeline input sufficiency (self-check before handing off)

After authoring the PRD/GDD, run the domain-specific checklist below to confirm the document satisfies the **input contract** of every downstream design job in the regular pipeline. A document that fails this check produces a shallow design — system design falls back to LLM extraction from prose, ui / game-art design guesses page or asset boundaries from the directive.

**Why**:

- Downstream design (system / ui / game-art) reads the PRD/GDD as a structured input, not as inspiration. Specific sections feed specific decompose questions: page count → `Pages/Views` complexity score, entity list → asset categories, mechanic list → event flow tasks.
- A missing or vague section silently degrades design quality. The checklist surfaces the gap **before** design starts, so the gap is treated as a planning open question rather than a design hallucination.

**Usage rules**:

- Each item in the domain checklist below is a **yes/no question** the planner answers about its own document. A "no" answer is not a defect — it is an invitation to either: (a) author the missing content now, or (b) record the gap in §Open Questions with a one-line reason (e.g. `EN-XXX list deferred — content scope undecided until first playtest`).
- Do **not** invent content to make a checklist item pass. A fabricated entity list is worse than a documented gap.
- Conditional sections (e.g. `Non-Functional Requirements`, `External Dependencies`) that genuinely do not apply pass the checklist by recording "not applicable — no external system / no perf-sensitive surface" in §Open Questions.
