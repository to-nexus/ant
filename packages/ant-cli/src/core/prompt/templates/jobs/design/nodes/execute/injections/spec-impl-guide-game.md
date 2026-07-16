## Implementation Identifiers

Ground every requirement in concrete game-client identifiers, anchored to the PRD, the game system-design, and the game-art-spec:

- **File / module paths** — scene modules, the simulation-engine module, state/reducer modules, the input/command module.
- **Symbol names** — scenes, the simulation engine's advance/apply operations, phase enum values, domain event names, reducer / action names. Cite the PRD coreloop (`CL-XXX`) or mechanic (`MC-XXX`) each symbol realizes.
- **Entity & content identifiers** — cite the PRD entity / level catalog (`EN-XXX` / `LV-XXX`). Do NOT invent shadow IDs.
- **Asset catalog entries** — reference `game-art-assets.json` entries by id (kind: inline / external) and name the render slot that consumes each. Do NOT restate asset bytes.
- **Real asset files** — real files may already be placed under `assets/game/`. Survey them (`list_assets`) and, when a file is relevant to a requirement, reference it by its exact `assets/game/...` path so the code step knows to place and wire it. Do NOT invent asset paths that no file backs.
- **State ownership & tick handoff** — which module owns authoritative state and how the loop feeds time into it. Cite the game system-design's ownership / timestep decisions.
- **Verification gates** — success criteria plus how to verify each (a coreloop step reachable, a phase transition observable, an entity rendered from its asset entry).

**Constraint**: Reference the sealed game system-design by name; inline only the contract the step consumes. Do NOT re-derive state-ownership, determinism, or synchronization policy — those are sealed upstream.

**Constraint**: Do NOT record simulation formulas, coordinates, velocities, or timing constants — those are code / balancing concerns, never spec content.

**Constraint — realization ceiling**: Record identifiers, signatures, and field shapes — never function/component bodies. A fenced block of executable implementation (roughly 10+ lines of statements) is the code job's output leaking into the spec; replace it with the signature, the state/event field names it must expose, and the verification gate that proves the behavior. Wire shapes, env vars, commands, and config values stay exact — those are contract, not realization.
