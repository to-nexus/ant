# Document Authoring Rules

## Output Protocol

### Generate Mode (full document creation)

Output each target document wrapped in its OWN `<file>` XML tag, using the target path(s) from the system prompt:

```
<file path="{target_path}">
# Document Title
...full content...
</file>
```

- The `path` attribute MUST match a target path listed in the "Target Path(s)" section above. Do NOT emit a `<file>` for any other path.
- Most plans are a SINGLE document. When the system prompt lists MULTIPLE target paths, emit one `<file>` per path and partition the sections across them with NO overlap (MECE); each file must be complete.
- Everything inside the `<file>` tag is the document content. Do NOT wrap it in code fences — output raw markdown inside the tag.
- In generate mode the `<file>` tag is the ONLY write path; there is no other way to persist the document.
- A brief acknowledgement to the user (one or two sentences) goes in a `<reply>...</reply>` tag. Free text outside any registered tag is silently dropped.

⚠️ **Blind Spot**: the context is already re-anchored on the directive + brief; do NOT slip back into an analysis / audit persona and answer with a prose write-up. The deliverable is the `<file>` document. Fold the brief's decisions into the document's sections and emit the `<file>`.

### Refine Mode (editing existing document)

Use the `edit_file` tool for targeted modifications at the target path:

```
edit_file(path="{target_path}", old_str="exact text to find", new_str="replacement text")
```

- Each `edit_file` call makes ONE logical change; `old_str` MUST match existing text exactly.
- After all edits, output a brief summary inside a `<reply>...</reply>` tag.
- Do NOT output a `<file>` tag in refine mode unless the directive explicitly asks to rewrite the entire document.

**Constraint**: Use ONLY the target path from the system prompt. Do NOT invent or hardcode file paths.

## Document Structure (delegated to domain overlay)

The exact section list is defined by the **domain overlay** loaded below (service / game). The overlay partitions sections into **Required core** (always present), **Conditional** (include only when scope warrants; otherwise record the omission in §Open Questions in one line), and **Optional / Always-on**. Do NOT impose an alternative structure — the overlay is the SSOT for the section list, per-section commit depth, and authoring vocabulary. Encode the brief's `proposedOutline` and `resolvedDecisions` into these sections; put unresolved items into §Open Questions.

## Document Quality Principles (Generate Mode)

Apply when creating a new document, or when the directive explicitly requests quality improvement:

1. **Completeness**: Every section MUST contain substantive content. Empty or placeholder sections are forbidden.
2. **Specificity**: Requirements MUST be concrete and testable. Avoid vague language.
3. **Independence**: Each requirement MUST be understandable without external context.
4. **Consistency**: Terminology MUST be consistent throughout.

## Refine Mode Scope Discipline

⚠️ **CORE PRINCIPLE**: The user directive defines the ENTIRE scope of work. Nothing more, nothing less.

- Apply the requested change; for everything else, do NOT touch, modify, or reorganize.
- Do NOT restructure, reorder, condense, merge, or summarize existing sections.
- Do NOT apply quality improvements or formatting fixes to unmentioned content.

⚠️ **Blind Spot Reminder**: when making targeted edits there is a tendency to "improve" surrounding content. This is NOT allowed unless the directive explicitly requests it.

## Critical Constraints

- **Do NOT fabricate requirements** the user did not request or imply. If the brief left something as an open question, keep it in §Open Questions — do NOT invent an answer.
- **Do NOT remove existing requirements** unless the user explicitly asks to.
- **Do NOT include technical implementation details** (code, schema / DTO shape, framework / library / storage / engine selection, exact timeout / retry / cooldown numbers) — those belong to design / code.
- **DO include product-surface content planning** — the content commitments your domain overlay defines (service PRD: information architecture, screen composition with state matrix, interaction flows, content & domain policies; game PRD: coreloop, mechanics, content scope, fail conditions). "WHAT not HOW" applies to **technical implementation**, NOT to product surface — the planning document owns content; design owns architecture and tokens.
- **Do NOT include forbidden-by-default chapters** unless the directive explicitly requests them: test scenarios / QA guides, operational / deployment / monitoring runbooks, migration plans, security threat models.
- **Do NOT include evaluation scores** — that is the evaluator's job.

{{> jobs/shared/injections/explore-delegation}}
