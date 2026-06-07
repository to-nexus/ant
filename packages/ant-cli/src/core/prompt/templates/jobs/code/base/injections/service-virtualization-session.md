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
  navigates to an external or unreachable host, or that the runtime cannot
  navigate to at all. The virtualized leg emulates ONLY the external
  authority's own contribution — exactly what the real external party would
  add to the redirect / callback URI it was handed, which is the grant it
  issues (authorization `code` / `state` / token) and nothing more. So when
  the authorization call is handed a redirect / callback URI (the
  application's OWN callback entry, already carrying whatever routing
  parameters the app itself placed on it), treat that URI as OPAQUE and
  preserve it verbatim, then append ONLY that issued grant. Do NOT re-derive,
  echo, or re-stamp a parameter the supplied URI already carries (the app put
  it there for its own routing; the external authority would never duplicate
  it), do NOT discard the supplied URI and fabricate your own entry point,
  and do NOT invent a non-standard URI scheme — a fabricated or non-navigable
  target cannot be opened, so the callback never fires and the demo is
  unenterable. The returned entry point MUST resolve to the application's OWN
  surface — its own callback entry on its own origin — carrying that grant.
  This is NOT a divergence from `service-virtualization-contract`'s
  identical-observable-shape rule: shape parity is met at the DTO + consumer-
  usability level (the URL is navigable and the callback actually fires), NOT
  by replicating the production authorization URL's internal query parameters
  — that production URL is the very external dependency being virtualized
  away. Observable check: the returned URL is the handed redirect / callback
  URI verbatim plus only the issued grant parameters; its host equals the
  app's own origin, and every parameter the app placed on the URI appears
  exactly once, exactly as the app placed it. If it points elsewhere, uses a
  scheme with no registered handler, or stamps any parameter twice, it is not
  a virtualized leg — it is a live external dependency wearing a mock's name.
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
