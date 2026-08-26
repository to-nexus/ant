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
| `team` | cloud team org — creation/roles/invites/domains **live (Phase 1)** | slug (user-authored) | full email | `workspaces/{team-id}/{email}/` |

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

`inferTenantByProjectId` (project routes) follows the same doctrine: the
`individual/` tree is **excluded from the scan** (the `local/` org stays
scannable — `local/local/{project}` resolves there). Before this, a leftover
`individual/{email}` tree could repoint PROJECT routes while ACCOUNT routes
stayed on the fallback tenant, so agent create-vs-list landed on different
roots (the D3 create/list mismatch). Skipping an individual candidate logs a
one-time warning naming `ANT_LOCAL_ORG` / `ANT_LOCAL_USER` — the explicit
override for developers who really want that tree served locally.

### Org-owned custom agents (team kind)

Custom-agent definitions follow the same folder doctrine: personal agents are
anchored at `workspaces/individual/{email}/.ant/agents` regardless of the
active org (an org switch never empties the settings list), and org-shared
agents live at `workspaces/{team-id}/.ant/agents` with a per-agent edit ACL
in `workspaces/{team-id}/.ant/agent-acl.json` (owner = promoter, delegated
editors, org admins always allowed via the LIVE membership row). See
[44-universal-job.md](44-universal-job.md) §Definition loading.

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

The switch foundation:

- `OrganizationRepositoryPort.listMembershipsByUser(userId)` over the by-user
  index (`ant:auth:user:orgs:{userId}`).
- `/auth/me` returns `{ user{…,kind}, activeOrg{id,kind,name}, memberships[],
  pendingInvites[], domainJoinableOrgs[] }` (the last two are the Phase 1 join
  surface — actionable invites addressed to this email + verified-domain
  one-click join candidates, both excluding orgs already joined).
- `POST /api/auth/switch-org { organizationId }` validates membership →
  updates `currentOrganizationId` → re-issues the JWT with the new `org`+`kind`.
- FE: `AppNavBar` shows the active account (kind-aware label) and, when
  `memberships.length > 1`, a switcher dropdown.

## Admin reads the scope axis, not `currentOrganizationId`

Every billing key is `(orgId, userId)`:

```
ant:billing:{balance,ledger,account,held,grantLock}:{orgId}:{userId}
```

So one identity owns **N independent billing accounts** — its own tier, balance,
monthly grant and ledger per 소속. `UserRecord.currentOrganizationId` is a
denormalised pointer that exists only to issue the JWT; it is **never** the
authority for a billing read. A helper that resolved the scope as
`currentOrganizationId ?? INDIVIDUAL_ORG_ID` (once duplicated in
`admin.routes.ts` and the overlay's `admin-billing.routes.ts`) collapsed every
user to a single admin row whose identity was decided by their last
`POST /auth/switch-org`, hid credits held in any other 소속, and let a refund
land in the wrong wallet. Both copies are deleted.

The admin surface is therefore **one row per (user × scope)**:

| Axis | Fields | Cardinality |
|---|---|---|
| identity | email, `approvalStatus`, `testAccountLevel`, `isSuperAdmin` | one per user, repeated across its rows |
| scope | `organizationId`, `role`, `tier`, `credits` | one per billing account |

Scope enumeration is `memberships ∪ ledger accounts ∪ {active}`, minus the
`_pending` onboarding sentinel:

- **memberships** (`listMembershipsByUser`) is the authoritative 소속 list.
- **ledger accounts** (`CreditLedgerPort.listAccountScopes`) recover money that
  outlived its membership — `removeMembership` and the `softDeleteOrganization`
  cascade detach the membership but **never touch `ant:billing:*`**, so a balance
  is otherwise stranded and invisible. Such rows are flagged `orphaned`.
- **active** is a safety net for legacy `personal-*` ids.

### Reads must not mint

`CreditLedgerPort.getBalance` is not a read: it calls `getOrCreateAccount`
(creating the account and applying an `'initial grant'`), applies a due monthly
grant under `GRANT_LOCK`, and can run `reseedForPricingCutover`. Fanning it over
every (user × 소속) pair would **issue free credits for scopes an admin merely
looked at**. `peekBalance` is the only legal read for a fan-out:

- returns `null` when no account exists (so the row is omitted), and runs
  `migrate` **in memory** without persisting;
- reports `stale: true` for an account below `BILLING_SCHEMA_VERSION`, whose
  stored balance is in the pre-cutover unit — the row shows the account exists
  but withholds the number rather than displaying a 100×-wrong one;
- refreshes the 365-day sliding TTL. This one write is deliberate: the admin
  list used to be a `getBalance` and thus an accidental keep-alive for dormant
  accounts, so peeking must not silently start letting real balances expire.
- `grantOverdue` marks a scope whose cycle has elapsed; the balance shown
  predates the grant and must never be presented as adjusted.

`NoopCreditLedger` (billing off / self-hosted) returns a free snapshot for every
scope rather than `null`, so the admin list still shows every membership instead
of coming back empty.

A user with **no** billing account anywhere still gets exactly one row (tier and
credits `null`). Approval is a user-axis duty — dropping such a row would make a
brand-new pending account invisible and therefore unapprovable.

### Billing mutations name their scope

`POST /admin/users/:userId/refund` takes a **required** `organizationId`
(`REFUND_SCOPE_REQUIRED` on absence) and validates it against
`memberships ∪ listAccountScopes` before touching the ledger. Both halves matter:
`refund` goes through `getOrCreateAccount`, so an unvalidated slug would mint a
new funded account at an arbitrary pair, while the account-index arm keeps
credits in a left or deleted org refundable.

## Team lifecycle (Phase 1 — live)

Team orgs are creatable and manageable through OSS routes
(`periphery/adapters/http/routes/teams.routes.ts`, mounted cloud-mode only —
self-hosted and managed identically). Local mode never reaches them
(JWT-protected; kind-dispatch, not a mode branch).

**Roles**: `MembershipRole = 'owner' | 'admin' | 'member'`
(`@ant/shared/orgTeam.ts` is the wire SSOT). Gate matrix — authorization always
reads the LIVE membership row, never the JWT `org` claim:

| action | minimum role |
|---|---|
| invite(member) · invite list · revoke · remove(member) · rename · domain claim/verify | admin |
| invite(admin) · remove(admin) · role change · domain delete · ownership transfer · org delete (sole member only) | owner |
| leave | member/admin — owner gets 403 `OWNER_MUST_TRANSFER` |

**Creation** (`POST /api/organizations`): open to every APPROVED account
(decision: open creation + post-hoc superadmin control). `slugify` rejects
reserved names; the `personal-` prefix is additionally reserved (would
misclassify under `deriveKindFromOrgId`). SETNX — a taken id is 409
`ORG_ID_TAKEN`; a soft-deleted org still occupies its id (reuse would resurrect
its workspace tree). Creation never auto-switches; activation is the explicit
`switch-org`.

**Invites**: link-delivery v1 (`/app/?invite={token}`) — no email infra. Stored
at `ant:auth:invite:{id}` (+ byToken / org / byEmail indexes), 14-day TTL judged
LAZILY on read (stored status never becomes `expired`). Acceptance enforces
exact invitee-email match (403 `INVITE_EMAIL_MISMATCH`); an already-member
acceptor gets 200 `{ alreadyMember: true }` (FE switch prompt, not an error).

**Domain claims** (`ant:auth:domain:{domain}`, domain = global PK, one org per
domain): three verification paths — (a) claimant's login email host exactly
matches the domain (consumer domains blocked) ⇒ instant `verified`
(`verifiedBy:'email'`); (b) DNS TXT `_ant-challenge.{domain}` (reuses the deploy
custom-domain `verification.ts`), explicit verify only, no polling; (c)
superadmin manual verify/reject via `/admin/organizations/...`. Verified claims
power one-click join (`join-by-domain` re-validates server-side; grants
`autoJoinRole`, default member).

**Stale-JWT blockade**: a removed member's JWT stays valid up to 7 days —
`checkTeamMembership` (`routes/helpers/approvalGate.ts`) re-checks the live row
at every compute start (chat user-message, job start/learn/resume/continue) and
403s `MEMBERSHIP_REQUIRED`. Kind-dispatched: only `team` is checked; fail-open
on infra error (mirrors `checkApproval`), fail-closed on a missing row.

**Deletion** is a soft-delete cascade (`softDeleteOrganization`): stamp
`deletedAt` → detach every membership (each member's
`currentOrganizationId` reverts to `individual`) → revoke pending invites →
release domain claims. Workspace directories are preserved. Owner self-delete
requires sole membership (409 `ORG_NOT_EMPTY`); superadmin force-delete has no
such guard. Deleted orgs are indistinguishable 404s on every team route.

**Org-admin approval seam**: team membership itself is the org-level
authorization; the account-level `approvalStatus` stays superadmin-owned and
orthogonal.

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
`individual/{email}` and the Redis user records. Rotate the ES256 key pair on
cutover so stale tokens (old `sub`/`org`) are rejected and users re-authenticate
into the new identity. Pre-launch alternative: wipe the legacy cloud trees +
`ant:auth:*` and let first login recreate. `workspaces/local` is never touched.

## Regression guards

- `tests/auth/signup-policy.test.ts` — every signup → individual; email userId;
  collision fix; `assertColonFreeUserId`.
- `tests/auth/organization-repository.test.ts` — `listMembershipsByUser`,
  `searchOrganizations` excludes individual.
- `tests/http/admin-account-scope.test.ts` — one admin row per (user × scope);
  row set unchanged by an org switch; `getBalance` never called from the admin
  path (the anti-minting guard); orphaned accounts surfaced; Noop lists every
  membership; account-less user still listed; pre-cutover balance withheld;
  `_pending` never a scope.
- `tests/http/auth-me-route.test.ts` — envelope (`activeOrg`/`memberships`/`kind`
  + Phase 1 `pendingInvites`/`domainJoinableOrgs` with lazy-expiry filtering).
- `tests/http/team-routes.test.ts` — role-gate truth table, invite acceptance
  edges (mismatch/expired/revoked/already-member), owner-leave 403,
  domain fast-path/TXT/global-uniqueness, join-by-domain re-validation,
  soft-delete cascade.
- `tests/http/org-individual-policy.test.ts` — lookup (404-as-null) + visibility config.
- `tests/policy/kind-dispatch-not-mode.test.ts` — no `isLocalServerMode` business gate.
- `tests/deploy/deployVisibilityGate.test.ts` — 404-not-403 private gate.
