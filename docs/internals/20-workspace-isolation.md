# Workspace & Isolation

## Overview

ANT uses a multi-tenant workspace structure. Physical directories are separated along four levels — organization, user, project, feature — and isolation is guaranteed at job execution time via an environment-variable whitelist and filesystem boundaries.

## Directory Structure

```
{ANT_WORKSPACE_BASE_PATH}/
    {tenantId}/
        {userId}/
            {projectId}/
                config.json
                codebase/                       (main branch)
                features/
                    {featureName}/
                        plan/                   (prd.md / gdd.md — free-form source documents)
                        architecture/
                            system/             (fe-system-*.md, be-system-*.md, api-contract-*.md)
                            spec/               (spec-*.md)
                        visual/
                            ui/{ant,figma,handoff}/
                            game-art/{ant,figma,handoff}/
                        assets/
                            service/{icons,images,fonts,misc}/
                            game/{icons,images,entities,particles,projectiles,sfx,bgm,tilemaps,atlas,models}/
                            gen/sketches/
                        meta/
                            directives/{design,code,plan,visual,learn}/directive.md
                            evals/{prd,ui-design,system-design,code}/
                        sessions/
                            architect/
                                design.json
                                code.json
                                learn.json
                                debug/          (summary/, prompts/, plans/, logs/, tokens/, figma/)
                                runtime/        (design/, code/)
                            planner/
                                plan.json
                                debug/          (summary/, prompts/)
                            creator/
                                visual.json
                                debug/          (summary/, prompts/)
                            chat.json
```

The SSOT for the feature directory structure is `@ant/shared/canonical.ts`. All canonical directories/files are defined there with visibility tags, and at runtime `isCanonicalDir()` determines canonical-path membership in O(1).

## Isolation Layers

### Organization (Tenant) Level

Physically separated by the `{ANT_WORKSPACE_BASE_PATH}/{tenantId}/` directory. Organization A cannot access organization B's files.

`{tenantId}` is one of `local` / `individual` / `{team-id}` depending on the org's kind (org model SSOT: [40-org-model.md](40-org-model.md)). Local mode uses only `local/`; cloud mode uses exactly one of `individual/` **or** `{team-id}/` depending on the active org — the two families never coexist in a single run.

### User Level

Separated by the `.../{tenantId}/{userId}/` directory. Even within the same organization, alice cannot access bob's files.

In the cloud, `{userId}` is the **full lowercased email** (because email local-parts collide in the shared `individual` org, and identity must stay stable across active-org switches). Local mode uses `local`. The `@`/`.` in an email are safe on all target filesystems, and since it contains no `:`, colon-delimited Redis/session keys are also safe (`assertColonFreeUserId` enforces this at the single ingress). Member path parameters reject `..`/`/`/`:` as path-traversal defense.

### Project Level

Separated by the `.../{userId}/{projectId}/` directory. Projects are independent of each other.

### Feature Level

Separated by the `.../{projectId}/features/{featureName}/` directory. Multiple features in the same project can be worked on concurrently. Each feature runs at most 1 concurrent job.

## Job Environment Variable Isolation

At job execution, environment variables are injected into the child process using a whitelist. The `...process.env` spread is never used.

Injected variables:
- System essentials: `PATH`, `HOME`, `USER`, `LANG`, `NODE_ENV`
- Job identity: `ANT_JOB_ID`, `ANT_PROJECT_ID`, `ANT_FEATURE`
- Paths: `ANT_PROJECT_PATH`, `ANT_FEATURE_PATH`
- User context: `ANT_USER_ID`, `ANT_ORG_ID`, `ANT_USER_EMAIL`
- Infrastructure: `ANT_REDIS_URL`, `ANT_API_URL`
- Job options: `ANT_OVERRIDE_DIRECTIVE`, `ANT_CHAT_SOURCE`

## Filesystem Isolation

`FileSystemPort` restricts file operations to within `ANT_FEATURE_PATH`.

### Path Traversal Defense

The requested path is `path.normalize()`d and then verified to start with basePath. Paths like `../../other-user/file.txt` are blocked.

## Process Isolation

Each job runs in an independent child process:
- Complete environment variable isolation (whitelist)
- Log collection via stdout/stderr pipes
- cwd is the ant-cli source, but file operations go through `ANT_FEATURE_PATH`

## Path Resolution

`WorkspacePathResolver` determines physical paths based on environment variables and mode.

| Environment | Workspace root |
|------|-----------------|
| Local | `~/ant-workspaces/` |
| Cloud | `ANT_WORKSPACE_BASE_PATH` (EFS mount) |
| Custom | `ANT_WORKSPACE_BASE_PATH` environment variable |

## Boundaries

- Feature structure SSOT: [01-shared-contracts.md](01-shared-contracts.md) (`canonical.ts`)
- Environment variable details: [02-infrastructure.md](02-infrastructure.md)
- Job execution flow: [10-job-lifecycle.md](10-job-lifecycle.md)
- IDE isolation: [23-cloud-ide.md](23-cloud-ide.md)
- Debug logging system: [29-debug-logging.md](29-debug-logging.md)
