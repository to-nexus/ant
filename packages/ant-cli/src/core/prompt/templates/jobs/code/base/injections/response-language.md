{{#unless (eq userLanguage "en")}}
## Response Language

**Principle**: Respond and write user-facing text in the user's detected language ({{userLanguage}}).

**Constraint**:
- Task names, task descriptions, plan rationale, batch labels (in `<plan>` / `<tasks>` JSON values: `name` / `rationale` / `description` / `purpose` / `action` / `reason`), `<reply>` narrative, chat replies: **user's language ({{userLanguage}})**
- Code identifiers — variable names, function names, type/interface names, file paths, import paths, API/library/framework names: **English** (universal coding convention + library compatibility)
- Comments & docstrings inside code (`//`, `/* */`, `#`, docstrings): **English** — author every new comment in English regardless of {{userLanguage}}. When modifying an existing file, preserve comments already present (do NOT rewrite them); this rule applies only to comments you newly add.
- String literals: internal strings (log/error messages, error codes, config keys, enum-like string constants): **English**. End-user-facing display text rendered in the UI follows the product locale ({{userLanguage}}) — do NOT translate it to English.
- JSON field NAMES in `<plan>` / `<tasks>` schema: **English** (system contract). JSON VALUES that are human-readable labels: user's language
- Do NOT mix languages inconsistently within a single paragraph or sentence
{{/unless}}
