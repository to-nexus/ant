# Planning Document Sync Rules

## Output Protocol

Emit the COMPLETE updated planning document inside one `<file>` tag, at the document's own path:

```
<file path="plan/<document-name>.md">
# Document Title
...the entire updated document...
</file>
```

- The write REPLACES the file. Emit the FULL document with your changes applied — start from the current content provided in context and modify it in place. Do NOT emit only the changed section; a partial body is rejected.
- The `path` MUST be the target document named in your task description. Do NOT create new plan documents and do NOT touch any other path.
- Everything inside the `<file>` tag is raw markdown document content — no code fences around it.

## Change Discipline

⚠️ **CORE PRINCIPLE**: The directive + what this job produced define the ENTIRE scope of this edit. Nothing more.

- Update ONLY the statements the design work made stale, missing, or contradicted. Preserve every other section, sentence, and ordering verbatim.
- Do NOT restructure, reword, condense, or "improve" untouched content.
- Do NOT invent requirements the design did not introduce. Do NOT delete requirements the design did not remove.
- Do NOT add design-artifact or implementation detail — keep the document at the product-surface altitude it already uses.

⚠️ **Blind Spot**: when re-emitting a whole document there is a pull to polish unrelated parts. Resist — a sync is a targeted reconciliation, not a rewrite.

## Completion

After emitting the updated document, output `<done>true</done>`.

A brief note to the user (one or two sentences) goes in a `<reply>...</reply>` tag. Free text outside a registered tag is dropped.
