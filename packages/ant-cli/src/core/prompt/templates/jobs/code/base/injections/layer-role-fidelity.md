## 🧱 Layer-Role Fidelity

**Principle**: Whatever architecture the code is organized under (layered, hexagonal, feature-sliced, event-driven, MV*), each boundary performs only its own role and **consumes** what the other boundaries already built. A boundary that reaches across its role re-implements work another boundary owns — the same logic then lives in two places and drifts.

### Role boundaries (observe before writing into a layer)

| Boundary | Performs | Does NOT perform |
|---|---|---|
| **Presentation** (view / component / screen) | renders observed state, wires user interaction, emits commands outward | orchestrate loading sequences, own async or business state, implement business rules / derivations |
| **Coordination** (use-case / controller / orchestrator) | sequences operations, decides which boundary acts and in what order, owns screen / session / mode state | embed rendering details, embed pure rule logic |
| **Domain** (rules / model / reducer) | pure rules and derivations over its own state | depend on rendering, timers, transport, or coordination |
| **Capability port** (storage / network / time / input) | technical access across a boundary, behind an interface | leak transport / runtime details into presentation or domain |

### Constraints

- **Single owner for state.** Each piece of authoritative state — a session, a mode, the result of an async fetch, a domain entity — is owned in exactly ONE boundary; the others read or derive from it and never keep a second copy. A view holding the source of truth for async or business state is a leak.
- **Presentation observes, never orchestrates.** A view receives already-resolved state and emits commands; it does not own the loading / coordination sequence that produced that state. When a view appears to need that sequence, the missing owner is upstream — route the work there rather than absorbing it into the view.
- **Rules live with the data they govern.** A derivation, validation, status / label computation, or eligibility check belongs with the boundary that owns the data, not inlined in the view that displays the result.
- **Consume, do not re-derive.** When another boundary already produced a value, bind to it; re-computing it locally forks the source of truth.

{{#if hasAnyAuthoritativeDoc}}
### Authority

An injected design input (PRD / spec / system-design) is present and is the authority for what it specifies. Where it assigns an owner for a piece of state, or a responsibility to a boundary, **honor that assignment exactly** — it governs the cases it covers; this floor fills only what the document leaves unspecified.
{{else}}
### Authority

No design input specifies the partition for this task. Apply the role boundaries above as the floor: take the smallest set of boundaries the work needs, give each only its role, and keep one owner per piece of state.
{{/if}}

⚠️ **Blind spot**: A coordination unit that exposes actions but holds no managed state silently pushes its callers — usually a view — to own the loading sequence and the resulting async state. The leak surfaces as a view orchestrating fetches and holding business state, and an over-eager re-render loop is its common symptom. The fix is to give the coordination boundary the managed state, not to absorb it into the view.
