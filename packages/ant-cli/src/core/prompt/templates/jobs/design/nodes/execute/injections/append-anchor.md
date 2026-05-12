{{#if appendAnchor}}
### Insertion anchor

A pre-computed insertion anchor is provided for this append-mode chapter.

**Constraint**: do NOT issue `read_file` calls to discover where your section belongs. Insertion position is determined by upstream decompose; rediscovery is wasted call budget.

**Observable target**: append your new entries AFTER the existing entry whose identifier is `"{{appendAnchor}}"` in the target file's section map.

⚠️ Blind spot: the file's existing chapter layout is settled when this anchor is given. Do NOT re-derive layout from the file body — naming conventions surface elsewhere in this prompt; the anchor surfaces position alone.
{{/if}}
