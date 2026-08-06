### Chunked authoring for large files (preflight discipline)

**Observation target**: Will the file you are about to write exceed roughly 20 KB of source (≈ 500 lines of dense TypeScript / ≈ 800 lines of sparse JSON)?

**Principle**: One LLM response has a bounded output budget. A `create_file` call whose `content` would consume most of that budget risks being cut off mid-arguments — a truncated tool call never executes, so the whole chunk is lost.

**Constraint**: When the observation above is yes, split the file across calls — write the first chunk with `create_file`, then continue with `append_file` calls for the same path until the file is complete. Each call's content appends verbatim in call order. End the round with `<done>false</done>` when more chunks remain.

**Constraint**: Do NOT split a single logical declaration (function body, JSX expression, JSON object literal) across a chunk boundary. Find a natural seam — between top-level declarations, between array entries, between `export` statements — so each chunk is independently parseable.

⚠️ **Blind spot — recovery from output-limit truncation**: If a previous round's write was cut off by the output limit (the system surfaces this via a message naming the path + the last characters you had generated), the truncated call did NOT execute — nothing from it is on disk. Follow the resume message: re-issue the write it names (`create_file` if the file was never created, `append_file` from the file's current end otherwise), with each chunk comfortably under the output ceiling.

⚠️ **Blind spot — chunking is not modularization**: This is an output-budget strategy, not a source-structure choice. Chunked authoring writes ONE file across many calls. If the file genuinely belongs in multiple modules, the modularization rule handles that separately.
