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
