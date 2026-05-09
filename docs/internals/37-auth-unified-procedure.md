# Unified Auth Procedure

Single source of truth for the login / logout / session-recovery flow shared by **ant-site** (Next.js marketing) and **ant-ui** (Vite SPA). The contract lives in [`@ant/auth-client`](../../packages/ant-auth-client); both apps are thin consumers.

## Why this document exists

Pre-unification, ant-site and ant-ui had two parallel auth implementations with diverged behavior. The most visible symptom: ant-site's `signOut` did **not** hard-navigate after the API call, so a silently-failing signout request would leave the cookie set; refreshing the page revived the signed-in state. The unified procedure forbids that shape — every logout path runs the same 5 steps.

## The three procedures

### Logout (5 steps, atomic)

```
1. POST /api/auth/signout (credentials: include)        ← surface failures, do NOT swallow
2. clearLocalState()                                    ← app-specific cascade (Context vs Zustand)
3. broadcaster.post({ type: 'logout', at: ... })        ← notify other tabs
4. navigate(destination)                                 ← hard nav forces re-mount + re-verify
5. on signout failure: showSignoutFailureToast() before step 4
```

Steps 2-4 run **even when step 1 fails** — the cookie may persist server-side until expiry, but the UI must always reflect the user's intent. Step 5 surfaces the partial-failure to the user. This is enforced by [`runUnifiedLogout`](../../packages/ant-auth-client/src/procedures.ts) — the only sanctioned logout path. Each app injects:

| Field | ant-site | ant-ui |
|---|---|---|
| `apiBase` | `${NEXT_PUBLIC_API_BASE}/api` | `API_BASE()` (cloud / local-aware) |
| `destination` | `'/'` (ant-site root) | `VITE_ANT_SITE_URL ?? '/'` |
| `clearLocalState` | `setUser(null)` (Context) | `clearUser()` (Zustand cascade SSOT — see [authSlice](../../packages/ant-ui/src/domain/store/slices/authSlice.ts)) |
| `broadcaster` | `createAuthBroadcaster()` (provider lifecycle) | singleton via [`authBridge`](../../packages/ant-ui/src/infrastructure/auth/authBridge.ts) |

### Login (existing shape, formalized)

```
[Click Sign In]
  → window.location = `${OAUTH_BASE}/api/auth/google?returnTo=...`
[Backend Google OIDC handshake]
[Backend redirects FRONTEND_URL?auth=success, sets ant_session cookie on .crosstoken.io]
[App detects ?auth=success on mount]
  → fetchAuthMeDetailed()
  → kind:'user'  : hydrate state, strip query
  → other        : log diagnostic, strip query, stay logged-out
```

Login is **not** broadcast cross-tab — the OAuth redirect already lands the new tab on a state where its own mount-time `/auth/me` will see the cookie. Adding a `login` broadcast would only race with that.

### Mount-time session check

Every mount runs `runMountSessionCheck` which dispatches the discriminated [`AuthMeResult`](../../packages/ant-auth-client/src/types.ts):

| `kind` | Action |
|---|---|
| `user` | hydrate state |
| `no-session` | clear hydrated user (only if one was hydrated from storage) |
| `misconfigured` / `http-error` / `network` / `shape` | log diagnostic, do NOT clear user (server hiccup ≠ logout) |

Collapsing any of the non-`user` kinds to `null` is forbidden — that's the trap that masked the original ant-site bug.

## Cross-tab synchronization

A single `BroadcastChannel('ant-auth')` carries two message types:

| Message | Sent by | Received by → action |
|---|---|---|
| `logout` | tab where user clicked Sign Out | other tabs → run state cleanup, no re-broadcast, no nav |
| `session-expired` | 401 interceptor + SSE auth-failure probe | other tabs → run state cleanup + show "session expired" banner |

The bus is **one-way** by design — receivers never re-broadcast. The dispatching tab already runs cleanup directly via the procedure; broadcast subscribers exist only for the **observing** tabs.

The fallback for browsers without `BroadcastChannel` (Safari ITP can disable it) is a localStorage `storage`-event polyfill. See [`broadcaster.ts`](../../packages/ant-auth-client/src/broadcaster.ts).

**Limitation**: BroadcastChannel does NOT cross origins. Tabs on `ant.crosstoken.io` and `ant-server.crosstoken.io/app/` won't see each other's broadcasts directly. They reconverge via:
1. The shared `.crosstoken.io` cookie (logout in tab A clears it; tab B's next protected request 401s).
2. The 401 interceptor on the observing app catches that and runs the cascade locally.

## 401 interceptor

[`http/api/client.ts`](../../packages/ant-ui/src/infrastructure/http/api/client.ts) wraps `apiGet/Post/Put/Patch/Delete` with `handle401Cascade`. On 401 from any endpoint **except `/auth/me`** (which is 200+null by contract):

1. `markSessionExpired()` (suppresses SSE auto-reconnect)
2. broadcast `session-expired`
3. `clearUser()` cascade
4. re-throw the original `ApiError`

The cascade is single-flight (debounced 1s) so a burst of in-flight 401s after expiry doesn't multi-fire. Auto-redirect to OAuth is **intentionally not** performed — the user clicks Sign In manually, avoiding redirect loops on backend misconfig.

## SSE auth-failure path

`EventSource` gives no HTTP status on `onerror`, so a 401 (mid-session JWT expiry) is invisible. `SSEManager` ([`SSEManager.ts`](../../packages/ant-ui/src/infrastructure/sse/SSEManager.ts)):

- After max reconnect attempts → probe `/auth/me`. If `kind: 'no-session'` → fire the same cascade as the HTTP 401 interceptor and stop reconnecting.
- On `session-expired` broadcast received → disconnect + suppress reconnects via `isSessionExpired()` guard. The flag is cleared on successful login.

This stops the post-expiry reconnect storm cold.

## File responsibilities

| File | Role |
|---|---|
| `packages/ant-auth-client/src/types.ts` | `AuthUser`, `AuthMeResult` (5-mode), `AuthBroadcastMessage` |
| `packages/ant-auth-client/src/fetch-auth.ts` | `fetchAuthMeDetailed` — canonical impl |
| `packages/ant-auth-client/src/sign-out.ts` | `signOut` — surfaces errors via callback |
| `packages/ant-auth-client/src/broadcaster.ts` | `createAuthBroadcaster` — BroadcastChannel + storage fallback |
| `packages/ant-auth-client/src/oauth.ts` | OAuth URL builders |
| `packages/ant-auth-client/src/procedures.ts` | `runUnifiedLogout`, `runMountSessionCheck` |
| `packages/ant-site/lib/AuthSessionProvider.tsx` | Context-state binding for ant-site |
| `packages/ant-ui/src/domain/store/slices/authSlice.ts` | `clearUser` cascade SSOT |
| `packages/ant-ui/src/infrastructure/auth/authBridge.ts` | Singleton broadcaster + session-expired flag |
| `packages/ant-ui/src/infrastructure/http/api/client.ts` | 401 interceptor (single sink) |
| `packages/ant-ui/src/infrastructure/sse/SSEManager.ts` | SSE auth-failure probe + reconnect suppression |
| `packages/ant-ui/src/presentation/components/AppNavBar.tsx` | ant-ui logout entry point — calls `runUnifiedLogout` |

## Regression guards

Source-level lints in [`packages/ant-ui/tests/auth/`](../../packages/ant-ui/tests/auth/) lock down:

- `site-signout-hardnav-regression.test.ts` — ant-site `signOut` MUST go through `runUnifiedLogout` (THE bug regression).
- `handleSignOut-procedure.test.ts` — ant-ui handler MUST go through `runUnifiedLogout`.
- `api-client-401-cascade.test.ts` — all five HTTP helpers wire through `handle401Cascade`.
- `clear-user-cascade.test.ts` — Zustand cleanup cascade stays the SSOT.
- `auth-client-fetch.test.ts` — 5-mode `AuthMeResult` discrimination.
- `unified-logout-procedure.test.ts` — 5-step ordering + failure-path semantics.

## Manual verification

1. Log into ant-site → Sign Out → URL flips to `/` → page reloads → "Sign In" visible. Refresh again → still logged out.
2. ant-ui standalone (`VITE_ANT_SITE_URL` unset): logout → ant-ui's own welcome screen.
3. ant-ui handoff (`VITE_ANT_SITE_URL=https://ant.crosstoken.io/`): logout → ant-site root.
4. Same-subdomain cross-tab: logout in tab A → tab B sees "session expired" banner within ~1s.
5. Long SSE session: delete `ant_session` cookie via devtools → next protected request 401s → banner appears, SSE stops retrying.
6. Backend down during signout: stop backend → click logout → toast appears, app navigates anyway.
7. Local mode (`backendMode=local`): no `/auth/me`, no broadcasts, no Sign In button. Unchanged.
