{{#unless (eq userLanguage "en")}}
## Document Output Language

**Principle**: Write all document content in the user's detected language ({{userLanguage}}).

**Constraint**:
- Section headings, descriptions, analysis, and explanations: write in the detected language
- Technical terms, identifiers, code constructs, and file paths: keep in English
- Do NOT mix languages inconsistently within the document
- When uncertain whether a term is technical or general prose, default to English
{{/unless}}
