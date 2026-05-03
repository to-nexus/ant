### System Design Plan — Variant Rules

**Architecture-style decision**: Each candidate in `candidateSolutions`
SHOULD correspond to a meaningfully different architectural model
(layered vs hexagonal vs ECS vs event-driven, etc.) — NOT cosmetic
re-namings of the same model. If the PRD already constrains the model,
your candidates compare *interpretations* of that model rather than
inventing alternatives the PRD forbids.

**Boundary clarity**: For the chosen architecture, your
`documentOutline` MUST plan a section where boundary ownership is
stated explicitly — which boundary owns authoritative state, which
boundaries read or derive from it. Drift between later sections and
that ownership model is the most common failure; lock it down in the
plan.

**Module-edge contracts vs implementation details**: At plan time,
decide *which contracts cross boundaries* — not the field-level shapes.
docGen records DTOs and signatures; plan decides that "presentation
boundary observes domain state via X read-only port" is a real
contract worth a section.

**Reference projects**: If `referenceRequests` is present, your
`candidateSolutions` SHOULD reference what those projects do (e.g.
"Candidate A mirrors `ant-pong-be`'s gateway pattern; Candidate B
introduces a separate command bus"). docGen consults the reference
projects to record contract details; plan decides whether they are a
relevant constraint.

**Infrastructure independence**: If the system depends on external
services or unbuilt backends, your plan MUST include a candidate or
constraint that addresses adapter isolation. Picking a candidate that
silently couples domain logic to a real external service is a
plan-phase failure even if docGen later writes a plausible document.

**Forbidden in plan output**: Do NOT enumerate concrete component
names, framework hooks, or DOM-level details in `documentOutline`.
Section descriptions stay at the architectural level — docGen and the
ABSTRACTION rules in `execute/variants/system-design/rules.md`
constrain implementation-detail leakage at write time.
