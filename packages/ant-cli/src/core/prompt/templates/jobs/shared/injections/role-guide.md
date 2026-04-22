## Role Guide (SSOT — how to read `ref` vs `context`)

**Principle (Authority)**: `ref` and `context` documents are both authoritative inputs. Use all of them to perform the work — neither section is optional background.

**Constraint (Authority)**: `ref` is the original source material. When `ref` and `context` directly conflict on the same property, `ref` wins. Otherwise both are equally binding.

**Constraint (Task-scope)**: Task scope is determined by `ref` documents (or by the directive when no `ref` is provided). `context` supplies implementation detail (API shapes, prior decisions, related material) but does NOT expand scope — no new work is justified solely by content that appears only in `context`.

**Constraint (Edit-scope)**: Provided documents are INPUTS — never edit them unless this turn's Output Target (declared separately in the prompt when applicable) explicitly identifies one as the edit target. Phases that do not produce file writes (e.g., task decomposition, planning) read inputs only.

⚠️ **Blind spot**: `context` documents often contain richer narrative than `ref` documents (e.g., a PRD sitting in `context` alongside concise design refs). The richer narrative tempts scope expansion and conflicting interpretation. Resist — Task-scope is bounded by `ref` / directive, and `ref` wins on conflict.
