## 📐 Design Document Authority — two orthogonal questions

Design inputs answer two **independent** questions. Neither outranks the other; each is the sole authority for **its own** question. The failure this guide prevents is using one document to answer the other's question.

| Question | Authority | Owns |
|---|---|---|
| **What crosses the wire?** | the **api-contract** document | endpoint paths, request/response field identifiers and types, status codes, error envelopes, per-endpoint auth requirement, event names/payloads |
| **How is the code partitioned?** | the **system-design** document (fe-system / be-system) | architecture boundaries, which external dependency is a distinct infrastructure port/adapter, how a consumer groups endpoints behind its ports, state ownership, directory boundaries |

### Question 1 — Wire shape (api-contract is authority)

- The api-contract is **immutable**. Reference its endpoints, identifiers, and types exactly; do NOT reshape them to a language convention or a "cleaner" form.
- When a system-design document and the api-contract disagree on a wire detail, the api-contract wins.
- Silence elsewhere ≠ freedom: a wire detail present in the api-contract applies even when the system-design does not mention it. (Identifier-preservation mechanics live in the execute Wire-format rule — this guide fixes only authority.)

### Question 2 — Code partition & port boundary (system-design is authority)

The api-contract is **silent** on this question by design — it documents an interface, not a partition. Derive the partition from the system-design, never from the contract.

- **The api-contract's section / resource grouping is documentation organization, NOT a port partition.** Endpoints listed under one contract heading do not thereby belong to one port. Read port membership from the system-design boundaries.
- **A dependency the system-design names as its own port stays its own port — singly owned.** When the system-design assigns a set of endpoints to a dedicated port/adapter (e.g. a sign-in / identity-delegation boundary held separate from the general data API), reach those endpoints ONLY through that port. Do NOT also re-author the same methods on another port because the contract lists them beside that port's other endpoints. One concept resolves through exactly one port; a second copy is dead code and a split source of truth.
- **api-contract silence on ports is not a gap to fill from the contract.** The contract not naming a port does not license folding its endpoints into a catch-all port. Consult the system-design for the partition; if it too is silent, derive the boundary from the dependency's own identity — a distinct external authority is a distinct port — not from contract adjacency.

⚠️ **Blind spot — identity vs data:** an external sign-in / identity-delegation boundary (authorize + callback + token + linked-account surfaces) is the classic case where its endpoints sit beside data endpoints under one contract heading yet belong to a separate port per the system-design. Honor the system-design's split; do not collapse identity onto the data port.

### When a document is silent

- Silent on a **wire detail** → the api-contract still applies (Question 1).
- Silent on a **boundary / partition** → the system-design decides; if it too is silent, the dependency's own identity decides. The contract's section grouping never decides the partition (Question 2).
