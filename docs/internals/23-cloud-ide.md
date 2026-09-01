# Cloud IDE

## Overview

The Cloud IDE provides an isolated VS Code environment per user. In local mode it is managed as a Docker container (LocalIDEOrchestrator); in cloud mode it is managed as a Kubernetes Pod (KubernetesIDEOrchestrator).

## Instance Key

```
{tenantId}:{userId}:{projectId}
```

Project-level isolation via a 3-part key. An independent IDE instance is created for each user-project combination.

## Local Mode (Docker)

### Container Configuration

| Item | Value |
|------|---|
| Image | `gitpod/openvscode-server:latest` (configurable via ANT_IDE_IMAGE) |
| Internal port | 3000 |
| Host port | 40000-49999 (dynamically allocated) |
| Memory limit | 2GB |
| CPU limit | 2 cores |
| Idle timeout | 30 minutes |

### Mounts

| Host path | Container path | Purpose |
|-------------|-------------|------|
| `{workspacePath}` | `/{projectId}` | Project code (rw) |
| `{ideHomePath}` | `/home/openvscode` | IDE settings/extensions persistence (rw) |

### Lifecycle

1. **Start**: allocate a port from the PortManager -> create/start the Docker container -> register in Redis
2. **Use**: accessed through the proxy (`/ide/{serverKey}/*`). WebSocket (terminal, LSP) supported
3. **Stop**: container stop/remove -> release the port -> remove from Redis
4. **Auto shutdown**: idle check every 1 minute; automatically shut down after 30 minutes of inactivity

## Cloud Mode (Kubernetes)

### Pod Configuration

| Item | Value |
|------|---|
| Container | openvscode-server |
| Port | 3000 |
| server-base-path | `/ide/{instanceKey}` |
| Workspace | `/workspace` |
| Volume | EFS PVC (ReadWriteMany), subPath: `{tenant}/{user}/{project}/codebase` |

### Proxy Flow

```
Client -> ALB -> ant-api (/ide/:serverKey/*) -> look up Pod IP in Redis -> K8s Pod IP:3000
```

Because the Pod IP is stored in Redis, whichever ant-api Pod receives the request proxies to the correct IDE Pod.

### Admission — three lanes, then ownership

`setupIdeProxyAuth` runs ahead of the proxy mount and gates EVERY method plus the
WS upgrade, because the proxy forwards an ambient-cookie request to a user's file
and terminal upstream — a GET is effectively state-changing there (H-013). Order:

```
session cookie → JWT verify → (bearer | trusted cookie origin | nav ticket) → assertProxyOwnership
```

The origin lane is `isTrustedCookieOrigin`, which admits only `Sec-Fetch-Site:
same-origin` / `none`, or a registered frontend `Origin`. It refuses `same-site`
on purpose: `ant-preview` serves attacker-authorable documents and is same-site
with the control plane.

**The nav ticket exists because one request shape has no origin attestation at
all.** The IDE is embedded as an `<iframe src>`, and a GET navigation carries no
`Origin`; in a split-host deployment `Sec-Fetch-Site` then reads `same-site` —
the same value attacker content produces. No Fetch-Metadata rule can separate
them, so admitting navigations by `Sec-Fetch-Mode`/`Sec-Fetch-Dest` would admit
the H-013 source verbatim. That carve-out is deliberately NOT taken; a tombstone
row in `tests/http/same-origin-guard.test.ts` pins it.

Instead the FE carries a capability: `POST /api/cloud-ide/{start,nav-ticket}` —
cookie-authenticated and behind `createSameOriginGuard`, so an attacker origin
cannot mint one and cannot read the frontend's across origins — returns a 32-byte
ticket bound to `(serverKey, org, sub)`, TTL 60s, stored under its own SHA-256.
The gate redeems it for GET/HEAD only, strips it from `req.url` before the proxy
forwards, and never accepts it on the WS upgrade (which is same-origin from
inside the iframe). Deliberately not single-use: the iframe re-navigates on retry
and under StrictMode, and the window is already short on a value no other origin
can read.

Everything the iframe loads afterwards is same-origin and needs no ticket, and a
single-origin deployment never exercises the lane at all — the origin predicate
admits first. The ticket is stripped from `req.url` either way, so it never
reaches the upstream or the proxy log even when it went unused.

If `/ide/*` is ever fronted by a CDN or a second proxy hop, three constraints
bind: the `/ide/` prefix must be forwarded verbatim (openvscode-server runs with
`--server-base-path /ide/<key>`), the WebSocket upgrade must be allowed
(terminal, LSP), and the idle timeout must be long — the IDE holds an idle WS for
as long as the tab is open.

`frame-ancestors 'self' <registered frontend origins>` is stamped on every
`/ide/*` response by the proxy's `overrideResponseHeaders` hook, after the
upstream header copy so openvscode cannot override it. That is defense in depth
against clickjacking — `helmet` runs `frameguard: false` and the proxy strips the
upstream `X-Frame-Options` — **not** the control that admits the request.

Guards: `tests/http/ide-gate-admission.test.ts`, `tests/http/ide-proxy-embedding.test.ts`.

## Isolation

| Isolation type | Method |
|-----------|------|
| Process | Independent process space per container/Pod |
| Filesystem | Mounts restrict access to the instance's own workspace only |
| Network | Independent network namespace |
| Environment variables | Independent per container/Pod |
| Resources | CPU/memory limits guarantee fairness |

## Local IDE (launching a local app)

In local mode, there is also an option to launch a local IDE app (Cursor, VS Code) directly instead of the Docker IDE. `POST /api/ide/open` executes an OS-specific command. There is no isolation or resource limiting.

## Port Ranges

| Purpose | Range |
|------|------|
| IDE | 40000-49999 |
| Preview | 30000-39999 |

## Boundaries

- Redis state conventions: [02-infrastructure.md](02-infrastructure.md)
- Workspace isolation: [20-workspace-isolation.md](20-workspace-isolation.md)
- Preview system: [22-preview-system.md](22-preview-system.md)

## Navigation Ticket

The `/ide/*` gate admits the iframe's document navigation with a short-lived
ticket rather than a Fetch-Metadata rule, because a GET navigation carries no
`Origin` and reads `same-site` in a split-host deployment — indistinguishable
from attacker-authored preview content.

The random/hash-as-key/TTL/strip half of that mechanism lives in
`middleware/navTicket.ts` and is shared with the workspace preview lane
(see [22-preview-system.md](22-preview-system.md)). **Admission is not shared.**
The IDE gate compares the stored owner against a verified cookie payload; the
preview lane has no cookie and reads the owner out of the ticket. Each scope owns
that decision in its own module, and the Redis key prefix (`ide:nav:` vs
`ws:nav:`) keeps one lane's ticket from being spent on the other.
