{{#unless (eq userLanguage "en")}}
## Response Language

**Principle**: Respond and write user-facing text in the user's detected language ({{userLanguage}}).

**Constraint**:
- Task names, task descriptions, plan rationale, batch labels (in `<plan>` / `<tasks>` JSON values: `name` / `rationale` / `description` / `purpose` / `action` / `reason`), `<reply>` narrative, chat replies: **user's language ({{userLanguage}})**
- Code identifiers — variable names, function names, type/interface names, file paths, import paths, API/library/framework names: **English** (universal coding convention + library compatibility)
- Comments inside code (`//`, `/* */`, `#`, docstrings): **user's language ({{userLanguage}})** — unless the surrounding file already uses English comments (observe existing files first; match the file's convention)
- JSON field NAMES in `<plan>` / `<tasks>` schema: **English** (system contract). JSON VALUES that are human-readable labels: user's language
- Do NOT mix languages inconsistently within a single paragraph or sentence
{{/unless}}
