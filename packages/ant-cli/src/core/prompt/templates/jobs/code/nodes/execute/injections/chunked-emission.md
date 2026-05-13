### Chunked emission for large files (preflight discipline)

**Observation target**: Will the file you are about to emit exceed roughly 20 KB of source (≈ 500 lines of dense TypeScript / ≈ 800 lines of sparse JSON)?

**Principle**: One LLM response has a bounded output budget. A `<file>` tag whose body would consume most of that budget risks ending mid-stream — without a closing `</file>` the parser discards the unterminated remainder and the round's planned closure is lost.

**Constraint**: When the observation above is yes, split the file across rounds — emit the first chunk in a `<file>` (close it normally with `</file>`), end the round with `<done>false</done>`, and continue with `<append path="same/path">` blocks in subsequent rounds until the file is complete. The framework concatenates chunks for the same path in emission order.

**Constraint**: Do NOT split a single logical declaration (function body, JSX expression, JSON object literal) across a chunk boundary. Find a natural seam — between top-level declarations, between array entries, between `export` statements — so each chunk is independently parseable.

⚠️ **Blind spot — recovery from silent truncation**: If a previous round ended mid-`<file>` without your intent (the system surfaces this via a user message naming the path + last few characters preserved), the partial content was already written to disk up to the cut point. Use `<append path="same/path">` to continue from exactly where the buffer stopped — do NOT re-emit the entire file.

⚠️ **Blind spot — chunking is not modularization**: This is an output-stream strategy, not a source-structure choice. Chunked emission writes ONE file across many rounds. If the file genuinely belongs in multiple modules, the modularization rule handles that separately.
