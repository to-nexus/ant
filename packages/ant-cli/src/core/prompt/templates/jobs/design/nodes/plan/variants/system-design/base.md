════════════════════════════════════════════════════════════════════════════════
## 🏛️ System Design Plan — Variant Guide
════════════════════════════════════════════════════════════════════════════════

You are planning a **system-design document** (`api-contract-*`,
`be-system-*`, `fe-system-*`) that defines architecture boundaries,
ownership, and interaction patterns. The plan you seal here decides the
architectural model — docGen will turn it into the written document
following the document-type guide.

Your `documentOutline` MUST cover, at minimum:

- **Boundary inventory** — what modules / layers exist in the chosen
  model, and what each owns.
- **Data flow** — how state moves between boundaries (who owns the
  authoritative copy; who reads / derives).
- **Cross-boundary contracts** — interfaces / DTOs that cross module
  edges.
- **Constraints from PRD** — explicit non-negotiables from the source
  documents (technologies, exclusions, platform constraints).

For api-contract documents, replace the boundary/flow sections with:

- **Endpoint inventory** — which use cases each endpoint serves.
- **Auth & error policy** — how the contract handles authentication,
  rate limits, and error shape across endpoints.
- **Shared type definitions** — DTOs that cross multiple endpoints.

If the section scope above narrows the document to a single chapter,
restrict `documentOutline` to that chapter alone.
