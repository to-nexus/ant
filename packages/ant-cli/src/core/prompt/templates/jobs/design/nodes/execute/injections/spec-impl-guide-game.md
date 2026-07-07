## Implementation Identifiers

Ground every requirement in concrete game-client identifiers, anchored to the GDD, the game system-design, and the game-art-spec:

- **File / module paths** — scene modules, the simulation-engine module, state/reducer modules, the input/command module.
- **Symbol names** — scenes, the simulation engine's advance/apply operations, phase enum values, domain event names, reducer / action names. Cite the GDD coreloop (`CL-XXX`) or mechanic (`MC-XXX`) each symbol realizes.
- **Entity & content identifiers** — cite the GDD entity / level catalog (`EN-XXX` / `LV-XXX`). Do NOT invent shadow IDs.
- **Asset catalog entries** — reference `game-art-assets.json` entries by id (kind: inline / external) and name the render slot that consumes each. Do NOT restate asset bytes.
- **State ownership & tick handoff** — which module owns authoritative state and how the loop feeds time into it. Cite the game system-design's ownership / timestep decisions.
- **Verification gates** — success criteria plus how to verify each (a coreloop step reachable, a phase transition observable, an entity rendered from its asset entry).

**Constraint**: Reference the sealed game system-design by name; inline only the contract the step consumes. Do NOT re-derive state-ownership, determinism, or synchronization policy — those are sealed upstream.

**Constraint**: Do NOT record simulation formulas, coordinates, velocities, or timing constants — those are code / balancing concerns, never spec content.
