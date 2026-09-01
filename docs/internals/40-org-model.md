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
superadmin manual verify/reject via `/admin/organizations/...`.

**A verified claim may grant membership at login** — `autoJoin`, **opt-in**:
`undefined` reads as OFF, and the predicate has one owner,
`grantsAtLogin(claim)` in `core/auth/domainJoin.ts`. The check sits in the OAuth
callback, after the `individual` attach:

- It runs on **every** login, not only the first. That is the whole backfill
  mechanism — an account that existed before its org turned the toggle on is
  picked up at its next login, and `attachMembership`'s NX semantics make the
  repeat a no-op. There is no batch job and no admin action.
- It CANNOT live in `/auth/me`: that is a read, and this section's
  ["Reads must not mint"](#reads-must-not-mint) rule forbids side effects there.
  `/auth/me` only reports (`domainJoinableOrgs`, `autoJoinedOrg`).
- A **new** account also lands in the team as its active org; an **existing** one
  keeps whatever org it was working in and gets a one-off `/auth/me`
  `autoJoinedOrg` notice (from `UserRecord.lastDomainAutoJoin`) offering the
  switch. Silently swapping the active org would move the project list out from
  under in-flight work.
- Failure is swallowed and logged: a domain lookup must never cost a login.

With auto-join off — the default — the domain is *offered* instead, via
`domainJoinableOrgs`. That list is non-empty in two states, not one: auto-join
off, and auto-join on for a session that predates the claim — a cookie lives
days, so making that user wait for their next login would be strictly worse than
letting them take the shortcut now. After a login has granted the membership the
resolver answers `already-member` and the list is empty.
`POST /organizations/join-by-domain` stays available in every case: it is the
explicit gesture, so it needs no toggle. The offer surfaces in two places — the
`OrgBanners` strip, and every matching row in team discovery, where it renders
as a **Join** button rather than the request composer (there is nothing for an
admin to approve that the org has not already granted).

The one owner of "which org does this email host grant?" is
`resolveDomainJoin(repo, userId, email)` in `core/auth/domainJoin.ts`. It answers
with a REASON (`no-host` / `no-claim` / `unverified` / `org-unavailable` /
`already-member` / `blocked`), not a boolean, because its three callers need
different things from the same verdict — the login grants, the join surface
offers, and the route maps each refusal to its own status. Before this existed,
`email.split('@')[1]` was re-derived at three sites, which is precisely why the
fourth caller (login) was never added and domain membership was offered but never
granted.

**Why the default was reversed** (it shipped ON, and this is the second and
final position). The email fast-path verifies the first `@acme.com` account to
claim `acme.com` instantly, so ON meant that claim absorbed every future
`@acme.com` account at their next login — no gesture from the person, no
decision from an admin. The mitigations on record (consumer domains refused, an
org-side toggle, superadmin reject, the flag surfaced in `AdminOrgDetail`) all
bound the blast radius; none of them restored the gesture.

What that cost was visible from the member's side, not the operator's: they
searched for the team, and the row came back already marked `Member` with no
control on it. Finding a team and joining one are separate acts, and the product
had silently merged them. So the grant is opt-in now, and the discovery row
always carries an action. An org that genuinely wants sign-in-is-membership
still gets it by turning the toggle on — deliberately, once, with the
consequence stated at the switch.

Nothing is revoked by the flip: memberships already granted stand, and a claim
written while the default was ON simply stops granting NEW ones until an admin
turns it on.

**Removal rows** (`ant:auth:org:removed:{orgId}`, HASH `userId → {reason,
removedAt, removedBy}`): leaving or being removed records a row, and the row
suppresses the domain shortcut — both auto-join and the one-click banner (403
`AUTO_JOIN_BLOCKED`). Without it, an admin's removal is undone by the very
shortcut that put the member there, at their next login. Only an explicit
re-admission clears it: an accepted invite, an approved join request, or an admin
clicking "allow again" (`DELETE .../removed-members/:userId`, which re-opens the
shortcut without re-adding anyone). The cascade in `softDeleteOrganization`
writes **no** rows and drops the hash — the org is gone, so gating its
(non-existent) shortcut would be noise.

`removeMembership(userId, orgId, { record })` takes that decision as a
**required** options param, so a new caller is forced by the compiler to choose
rather than silently skipping the row — the type-space form of the seam rule in
[AGENTS.md](../../AGENTS.md#authorization-answers-whose-never-how-much).

**Discovery + join requests** — the third way in, and the only one a
non-member can start:

- `Organization.discoverable` (opt-in, default off) is what
  `GET /api/organizations?q=` filters on, alongside kind and `deletedAt`.
  Being findable grants nothing.
- `POST /organizations/:orgId/join-requests` 404s for a non-discoverable org —
  a private team's existence is no more leaked by the request endpoint than by
  search. One live request per `(org, user)`, enforced by a SETNX guard key
  (`ant:auth:org:joinreq-pending:{orgId}:{userId}`) released on every status
  transition, and a 30-day TTL judged LAZILY on read like invites.
- An admin approves (owner to grant `admin`) or rejects; the requester may
  cancel their own. `/auth/me` carries `myJoinRequests` so the requester sees
  the state without an org-scoped route they have no access to.

**Free-join is deliberately NOT what this is.** The retired onboarding screen let
a user pick an org from an autocomplete and become a member on the spot, which
bypassed the invite and domain gates entirely; it and its `_pending` JWT
machinery (`requireOnboardedJwt`, `POST /auth/onboarding/organization`,
`needsOnboarding`) are deleted. `PENDING_ORG_SENTINEL` survives only as a
read-side guard for records the old flow wrote. This supersedes the earlier
"public search / join-request excluded" scoping decision recorded in
`.claude/plans/noble-puzzling-cook.md:219`.

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

**Super-admin member removal**: `DELETE /admin/organizations/:orgId/members/:userId`
is the org-role ladder's superset — it may remove an `admin` — but NOT its
exception: the owner is still refused (`OWNER_MUST_TRANSFER`), because an
ownerless team can no longer transfer, rename or delete itself, and
`DELETE /admin/organizations/:orgId` is the verb for disposing of the org. It
writes the same removal row an org admin's removal does; without it the domain
shortcut re-adds the member at their very next login.

## Account purge

`core/account/purgeAccount.ts` is the single owner of "destroy everything this
identity owns". Two callers today — `DELETE /api/admin/users/:userId`
(`mode: 'full'`) and `POST /api/user/reset` (`mode: 'data-only'`) — and a third,
self-serve withdrawal, is the same call with `reason: 'self-withdrawal'`.

The scope set is `memberships ∪ ledger accounts ∪ {individual}`. The last term
is **mandatory, not a convenience**: `resolveTenantUserDir` anchors a TEAM
member's personal data (`.ant/agents`, `.ant/pipelines`, `credentials.json`,
`encryption.key`) under `{ws}/individual/{user}` so an org switch never re-homes
their definitions. A purge that swept only the membership orgs would leave the
encrypted credential store on disk.

Step order — `projects` → `userFiles` → `redisState` → `memberships` →
`orgAcls` → `identity`. Each step reports rather than throws: one wedged project
must not leave a half-purged account with no record of what remains, and the
identity step must still run so a partially purged account's live sessions still
end.

- **Projects go through `ProjectService.deleteProject(..., { force: true })`**,
  never a bare `fs.rm`. That is the 5-step cascade — job cancellation, pipeline
  deactivation, IDE pod teardown, preview ack, Redis sweep. `POST /api/user/reset`
  used to walk the project dirs and `fs.rm` them, skipping all of it: jobs were
  never cancelled, activations kept firing against a deleted project, IDE pods
  kept their file handles open, and project Redis keys survived as ghost state.
  It now calls this engine, so there is one owner instead of two.
- **`StateStorePort.cleanupUserScope(orgId, userId)`** sweeps what
  `cleanupProject` cannot reach because it is not project-keyed: pipeline run
  slots, artifact file-tree / unseen caches, RAC baselines, and the transfer
  index. The transfer arm also prunes the **counterparty's** index — their list
  otherwise holds request ids resolving to a deleted account.
- **Memberships detach with `record: null`.** The account is gone, so a
  domain-shortcut blocklist row would gate a login that can never happen — the
  same reasoning `softDeleteOrganization` already applies.
- **Org ACL rows are pruned.** Left in place they are inert (`canEditOrgResource`
  needs a live membership row) but a re-added namesake would silently inherit
  the old ownership. Org-scoped *definitions* the user promoted stay: they are
  org property, not personal data.
- **Billing is deliberately NOT deleted.** `ant:billing:ledger:*` is the only
  record of purchases — there is no invoice system and, with
  `MockPaymentProvider`, no PSP copy. The rows become unreachable once the
  identity is gone, and the admin list already renders them as `orphaned`.
  Revisit with an export-and-archive step when a real PSP lands.

### Deletion is not a ban — there is no tombstone

A purge destroys DATA. It does not refuse a person, and it leaves **no record
that could**: `deleteUserIdentity` is the last step and nothing survives it, so
the same address signs up again through the ordinary OAuth callback and gets a
brand-new account stamped by `defaultApprovalMode`.

Refusing a person is a different verb on a different axis:
`POST /admin/users/:userId/approval { status: 'denied' }`. It keeps the record,
survives every re-login (`upsertUser` stamps approval only when
`existing === null`), and reverses with one call. The admin screen carries both,
and the danger zone says which is which.

This was inverted once. The original engine wrote a TTL-less tombstone
(`ant:auth:user:purged:{userId}`) and `upsertUser` threw `PurgedAccountError`
for `reason: 'admin-purge'`, so "delete" was a permanent, irreversible ban whose
only escape — `DELETE /admin/users/:userId/purge` — had no admin-ui caller and
whose target had already left `USER_INDEX`, making the detail pane 404. The
operator could not undo it from the UI at all.

**What the tombstone was load-bearing for, and what replaced it.** JWTs are
stateless ES256 with no denylist, and `getUserApproval` used to answer
`'approved'` for a MISSING record — so a plain delete left the session cookie
working for days and a desktop token for **90**. That is now answered without a
blocklist:

- `getUserApproval` returns **`'unknown'`** when no record backs the id.
  `checkApproval` carries it and the surface guard answers **401
  `SESSION_IDENTITY_GONE`**, not 403. The distinction is the whole point: 401
  means re-authenticate, which recreates a legitimate user's record via
  `upsertUser` and, for a deleted account, IS the re-signup.
- The legacy carve-out narrows to what it was always about — an **existing**
  record with no `approvalStatus` field still reads `'approved'`. A missing
  record was never a legacy account: `upsertUser` runs on every login, so any
  account that has signed in has a record.
- `/auth/me` is a `PUBLIC_PATH`, so the guard never judges it. It asks
  `hasIdentity(userId)` and answers signed-out, draining the cookie. Without
  that branch the FE rendered a signed-in user whose every other call 401s.
  `hasIdentity` deliberately does NOT read approval — `checkApproval` stays the
  single owner of that verdict (`tests/policy/resource-admission.test.ts` pins
  that no route handler calls it).
- Local mode is untouched: `NoopOrganizationRepository` answers `'approved'` and
  `hasIdentity → true`, so neither branch is reachable there.

`reason` (`admin-purge` | `self-withdrawal`) survives as audit-log context only.
It no longer forks policy — both reasons permit a re-signup, which is what
removed the need for a self-withdrawal special case.

Route guards, in order: 404 unknown user → 400 `PURGE_CONFIRM_MISMATCH`
(`?confirmEmail=` must match; a `userId` here IS an email and the admin table is
a dense list of near-identical rows) → 403 `PURGE_FORBIDDEN` for a super-admin
(the env grant would resurrect them at the next boot's `syncSuperAdmins`) or for
the caller themselves → **then** 501 if the deployment wired no purge deps. The
capability check is last on purpose: every deployment must refuse the same
targets, or a misconfiguration would mask one that was never purgeable.

**Audit trail.** With the tombstone gone, the only structural record of a purge
is the `[PurgeAccount] identity … deleted by … (reason)` log line;
`ant:billing:ledger:*` rows keep rendering as `orphaned` in the admin list. If a
real audit requirement lands, add a log that does not gate access — the moment a
record participates in an access decision it is a tombstone again.

**Self-serve withdrawal is designed but NOT implemented.** The engine is the
whole backend; what remains is `DELETE /api/auth/account` (own purge with
`reason: 'self-withdrawal'`, typed-email confirmation, the same owner refusal as
leave, clearing the session cookie), an `AccountConfigEditor` danger zone reusing
`tenantScrubPatch` for FE teardown, and a post-purge landing state. A
grace-period variant would need a real deferred-delete record, since there is no
longer a tombstone to park the decision on.

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
  collision fix; `assertColonFreeUserId`; the login auto-join truth table (new
  account activates the team / existing one is stamped instead, idempotence,
  `autoJoin:false`, unverified, removal row, soft-deleted org, non-matching host,
  repo failure never costing the login); tombstones for the deleted onboarding
  seam.
- `tests/auth/organization-repository.test.ts` — `listMembershipsByUser`,
  `searchOrganizations` excludes individual / non-discoverable / soft-deleted.
- `tests/http/admin-account-scope.test.ts` — one admin row per (user × scope);
  row set unchanged by an org switch; `getBalance` never called from the admin
  path (the anti-minting guard); orphaned accounts surfaced; Noop lists every
  membership; account-less user still listed; pre-cutover balance withheld;
  `_pending` never a scope.
- `tests/http/auth-me-route.test.ts` — envelope (`activeOrg`/`memberships`/`kind`
  + `pendingInvites`/`domainJoinableOrgs`/`myJoinRequests`/`autoJoinedOrg`, with
  lazy-expiry filtering).
- `tests/http/team-routes.test.ts` — role-gate truth table, invite acceptance
  edges (mismatch/expired/revoked/already-member), owner-leave 403,
  domain fast-path/TXT/global-uniqueness + join policy, join-by-domain
  re-validation, discoverability gate, join-request lifecycle (duplicate,
  already-member, message budget, role gates, lazy expiry, cancel-by-requester),
  removal rows (written on remove AND leave, blocking, cleared three ways, none
  from the cascade), soft-delete cascade.
- `tests/auth/organization-search.test.ts` — query floor, limit clamp reaching
  the repo, sensitive-field projection.
- ant-ui `tests/store/orgSlice.test.ts` — the five org resources, three
  independent dismissal sets, auto-join notice visibility, own-request index.
- `tests/http/account-purge.test.ts` — scope resolution (individual always
  included; a ledger scope outliving its membership), the cascade (force-delete
  per project, the individual-anchored credential store removed, memberships
  detached, ACL rows pruned, a failed step reported without aborting the
  identity step), `data-only` stopping before the identity, and the two
  invariants that replaced the tombstone (a vanished record reads `'unknown'`
  while an existing one missing the field still reads `'approved'`; a re-signup
  succeeds as a NEW account after either purge reason, and blocking is
  `approvalStatus`, which survives a re-login).
- `tests/http/team-routes.test.ts` also pins the org hub's premise — a member
  whose active org is `individual` can read and leave a team by path orgId.
- `tests/http/org-individual-policy.test.ts` — lookup (404-as-null) + visibility config.
- `tests/policy/kind-dispatch-not-mode.test.ts` — no `isLocalServerMode` business gate.
- `tests/deploy/deployVisibilityGate.test.ts` — 404-not-403 private gate.
