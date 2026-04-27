### Stable identifier convention (cross-document anchor)

The PRD/GDD is consumed by **system / ui / game-art design** as the SSOT for content planning. Design documents reference this document **by chapter and by stable identifier** to keep MECE across the pipeline (PRD/GDD §X / `<PREFIX>-<NAME>` cited from a design task → that task is the only place the section is elaborated).

**Why**:

- Section numbers (`§4`, `§4.2`) drift when sections are reordered. Design citations break silently.
- Symbolic IDs (`SC-Search`, `MC-Combat`, `EN-Hero`) survive renumbering and stay readable in design task IDs (`ui-spec-SC-Search`, `game-art-assets-EN-Hero`).
- A PRD/GDD without stable IDs forces every downstream design task to re-extract entities from prose, multiplying drift.

**Usage rules**:

- Each domain overlay defines its own prefix family (e.g. service: `SC-` / `FL-` / `FR-` / `CP-` / `EN-` / `RB-`; game: `CL-` / `MC-` / `EN-` / `LV-` / `RW-` / `GM-` / `MP-`). Use **only** the prefixes listed in the domain overlay below — invented prefixes are an MECE violation.
- ID format: `<PREFIX>-<PascalCase>` or `<PREFIX>-<kebab-PascalCase>` (e.g. `SC-ProductDetail`, `MC-Combat`, `EN-Enemy-Goblin`). Lowercase / underscore variants are forbidden.
- Cite an ID **once** at its definition site (the section that owns it) and **reference** it elsewhere by the same ID. Do not redefine.
- Prefer the symbolic ID over the section number when a design document needs to anchor a specific entity. `§4.2` is fine for human reading; `FR-15` is what survives a renumber.
- A directive that requires an entity not yet covered by a prefix family → propose the prefix in §Open Questions; do **not** silently add a new prefix.
