# Org Model — kind axis, shared `individual` org, account switch, visibility

SSOT for the organization model: how a signed-in identity maps to an org, how
the workspace tree is laid out, and the two visibility policies (account
discoverability + deploy access).

## The `kind` axis

`org` is the umbrella layer term. Every organization carries a `kind`
discriminator (`@ant/shared` `OrganizationKind`):

| kind | meaning | org id | userId | workspace root |
|---|---|---|---|---|
| `local` | local-mode tenant | `local` | `local` | `workspaces/local/` |
| `individual` | shared cloud org — every cloud signup joins it today | `individual` | full email | `workspaces/individual/{email}/` |
| `team` | future cloud org subscriber (admin/join **deferred**) | slug/domain | full email | `workspaces/{team-id}/{email}/` |

`deriveKindFromOrgId(orgId)` is the safety-net classifier for tokens predating
the explicit `kind` claim: `local`→local, `individual`→individual, `personal-*`
prefix→individual (legacy consumer BC), else→team.

### Mode ↔ folder exclusivity

- Local-mode execution uses **only** `workspaces/local/`.
- Cloud-mode execution uses **only** `workspaces/individual/` or
  `workspaces/{team-id}/` (whichever the active org is).

The decider is `kind` (data), not server mode. `inferLocalDefaultTenant`
excludes both `local` and `individual` from its single-org probe so a stray
`individual/` folder in a local workspace never becomes the inferred tenant.

## Identity = full email (cloud)

`user.id` is the **full lowercased email** for every cloud org (individual and
team), and `local` in local mode. This is required because the shared
`individual` org would otherwise collide on email-local-part (`bob@gmail.com`
and `bob@naver.com` both → `bob`). The "search by full account email"
transfer requirement is the same constraint surfaced to users.

The id is **org-independent**, so a user keeps the same identity across an
active-org switch. `assertColonFreeUserId` (in `AuthService`) protects the
`:`-delimited Redis/session-key namespace at the single identity ingress —
the email-validation regex forbids colons.

> Note: `OrganizationKind` (this doc) is unrelated to the session `kind`
> (`'user'` / `'no-session'` / …) in [37-auth-unified-procedure.md](37-auth-unified-procedure.md).

## Account model — single identity, org switch (not separate registration)

A single identity belongs to many orgs (`Membership` is many-to-many), and the
active org is a **context switch**, never a separate signup — matching GitHub /
Vercel / Slack. The data model already supports this:
`Membership { userId, organizationId, role }` + `UserRecord.currentOrganizationId`
(the JWT `org` claim).

**This iteration ships the switch FOUNDATION** (team join itself is deferred):

- `OrganizationRepositoryPort.listMembershipsByUser(userId)` over the by-user
  index (`ant:auth:user:orgs:{userId}`).
- `/auth/me` returns `{ user{…,kind}, activeOrg{id,kind,name}, memberships[] }`.
- `POST /api/auth/switch-org { organizationId }` validates membership →
  updates `currentOrganizationId` → re-issues the JWT with the new `org`+`kind`.
- FE: `AppNavBar` shows the active account (kind-aware label) and, when
  `memberships.length > 1`, a switcher dropdown.

Today every user has exactly one membership (`individual`), so the switcher
renders as a static label and `switch-org`'s only legal target is self. **Deferred:**
team create/join/admin + the post-login multi-org selection prompt.

## Member / search dispatch (file transfer)

`GET /api/org/members` dispatches on kind:

- `team` → enumerate the org workspace tree (browse).
- `individual` → **self only** (the shared org would otherwise leak the entire
  user base). Cross-user reach is the exact-email lookup below.
- `local` → self only.

`GET /api/org/members/lookup?email=<full-email>` (individual only) returns a
recipient **only if** the target workspace exists AND that account's
`visibility === 'public'`. A miss (not found OR private) returns an
indistinguishable `{ member: null }` — a private account's existence is never
leaked. The email param is shape-validated and rejects path separators.

`POST /api/artifacts/transfer-request` mirrors the gate: `individual` recipients
must be `public` (or self), else `403 RECIPIENT_NOT_PUBLIC`; `local` is rejected;
`team` keeps same-org behavior.

## Visibility policies (two, orthogonal)

1. **Account visibility** (individual) — per-user `account.visibility` in
   `user-config.json` (`'public'` default). Governs transfer-search
   discoverability. Toggle in `AccountConfigEditor` (individual only).
2. **Deploy-build visibility** (individual + team) — per deploy, `'public'`
   default, persisted in `.deploy/meta.json` + `DeployState`. `'private'` gates
   the deploy proxy: only the owning `(tenant,user)` (matched against the JWT
   cookie) may access; unauthorized → **404 identical to not-found** (never
   403), on both the HTTP proxy and the WS upgrade path. Local mode (no
   jwtService) treats private as owner-accessible. Toggle in the deploy panel.

## Repo owner by kind

Individual accounts have **only** a personal repo owner — there is no shared org
to own a default. `PUT /api/org/config` is rejected for individual; the wizard /
account UI hide the Organization owner pill. Team keeps both.

## Cutover

`pnpm --filter @ant/cli migrate:individual-org` (dry-run by default, `--apply` to
move) re-keys legacy `{personal-*|domain}/{username}` trees to
`individual/{email}` and the Redis user records. Rotate `ANT_JWT_SECRET` on
cutover so stale tokens (old `sub`/`org`) are rejected and users re-authenticate
into the new identity. Pre-launch alternative: wipe the legacy cloud trees +
`ant:auth:*` and let first login recreate. `workspaces/local` is never touched.

## Regression guards

- `tests/auth/signup-policy.test.ts` — every signup → individual; email userId;
  collision fix; `assertColonFreeUserId`.
- `tests/auth/organization-repository.test.ts` — `listMembershipsByUser`,
  `searchOrganizations` excludes individual.
- `tests/http/auth-me-route.test.ts` — envelope (`activeOrg`/`memberships`/`kind`).
- `tests/http/org-individual-policy.test.ts` — lookup (404-as-null) + visibility config.
- `tests/policy/kind-dispatch-not-mode.test.ts` — no `isLocalServerMode` business gate.
- `tests/deploy/deployVisibilityGate.test.ts` — 404-not-403 private gate.
