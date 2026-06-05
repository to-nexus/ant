## Service Virtualization — Session

### Principle

**A virtualized adapter that responds correctly to a single request still
fails the startup-test when the running demo cannot be entered, navigated,
or trusted to remember itself. The mock adapter MUST simulate a coherent
persistent session: identities a user can choose at the entry surface,
authorization edges that pass the surface's gates, content that is
non-empty across every key surface, and mutations that survive the
surface's expected lifetime. This is the cross-request, across-time layer
above single-body realism.**

### Sibling SSOTs (defer)

| Sibling | Scope | Defer for |
|---|---|---|
| `service-virtualization-contract` | Port shape + toggle grammar | Adapter activation env var; the closed-system invariant (no production-backend egress) is rooted there |
| `service-virtualization-data` | One response body realism | Field values within a single body (text / number / date / id / relation) |
| `service-virtualization-imagery` | Image fields | Placeholder image rendering |

### Observation Targets

For every surface that the virtualized adapter feeds, decide each axis
below before authoring the seed:

| Axis | Question | Constraint |
|---|---|---|
| Inhabitants | Which identities exist at boot, and are they discoverable on the entry surface? | At least one identity per role-shape the surface gates on, surfaced through a platform-appropriate selection mechanism on the entry surface |
| Authorization graph | Which roles / organizations / permissions do those identities carry? | At least one identity passes every gate that the in-scope surfaces enforce; no identity exists with a role no surface admits |
| Cross-body coherence | When the same id appears across endpoints, do they resolve to the same entity? | The seed is one shared world — every reference (ownership, membership, embed) resolves to the same record across endpoints |
| Multi-endpoint cardinality | Across all key navigation surfaces, are any of them empty for the seeded inhabitant? | Every key surface a chosen inhabitant can reach has at least one record visible; "empty state coverage" is the responsibility of `service-virtualization-data` for a single body, not a license to leave the whole demo empty |
| Mutation persistence | Do write operations survive subsequent reads and the surface's expected lifetime? | Writes are visible to the very next read; survival horizon (per-render / per-tab / per-origin / per-device) matches the surface's expectation in production |
| Surface discoverability | Does the entry surface signal the existence of the seeded session? | Identities are reachable through a discoverable mechanism on the entry surface; credentials and seeded state do NOT live only in README / logs / comments |

### Constraints

- Do NOT use filler or generic placeholder identities — names, emails,
  and ids follow the same domain-fit discipline `data` applies to bodies.
- Do NOT bury seeded credentials in documentation or log output only —
  the running surface MUST be the credential's primary disclosure path.
- Do NOT seed an identity carrying a role the in-scope surfaces cannot
  admit (dead role) or an entity no inhabitant can reach (dead entity).
- Do NOT leave mutations unpersisted when the surface implies durability;
  pick a persistence layer whose lifetime matches the surface's expected
  durability horizon (per-render / per-tab / per-origin / per-device).
- Do NOT regenerate the seed (identities, ids, ownership edges) on each
  render — the simulated world is stable; values derive from a fixed
  seed exactly as `service-virtualization-data` requires for body fields.
- Do NOT replace a production external-leg authentication surface (OAuth,
  SSO, magic-link, passkey) with an ad-hoc credential form just because
  the external leg is unreachable in mock mode. Preserve the production
  entry surface's shape and simulate the external leg's outcome inside
  the closed system (rooted in `service-virtualization-contract`).
- Do NOT let the mocked authorization step hand back an entry point that
  navigates to an external or unreachable host. The authorization entry
  point a mocked external leg produces MUST resolve to the application's
  OWN surface — its own callback entry on its own origin — carrying the
  synthesized outcome (the simulated grant). An entry point whose host is
  not the application's own origin sends the user OUT of the closed system
  with no path back: the redirect target is dead, the callback never
  fires, and the demo is unenterable. Observable check: the host of the
  authorization/redirect target equals the app's own origin. If it points
  anywhere else, it is not a virtualized leg — it is a live external
  dependency wearing a mock's name.
- Do NOT call the production backend from the mock adapter to fetch or
  persist session state — the simulated world is owned end-to-end by the
  adapter and its chosen persistence layer.

### Blind Spot

**The production-path mindset treats identity, authorization, and seeded
content as "things the user will provide later in production."** In mock
mode they are not deferred — they are the user's only path into the
running app. A session with no inhabitants, no admitted roles, or no
visible content is not a partial demo; it is an unenterable demo. Plan
the session before claiming the surface complete.
