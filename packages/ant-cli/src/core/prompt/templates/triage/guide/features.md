# Ant Feature Guide

## GitHub Integration

### Setting Up GitHub PAT (Personal Access Token)

**Where**: Account Settings → GitHub Integration

**Steps**:
1. Open Account Settings (gear icon in sidebar)
2. Find "GitHub Integration" section
3. Click "Generate Token →" to create a new PAT on GitHub
4. Required scopes: `repo` (full control of private repositories)
5. Copy the generated token (starts with `ghp_`)
6. Paste into the PAT input field
7. Click "Save PAT"

**When Needed**:
- Pushing changes to GitHub repositories
- Creating Pull Requests
- Cloning private repositories

---

## Repository Configuration

### Repository Types

| Type | Description | Use Case |
|------|-------------|----------|
| `local` | Local directory | Existing project on your machine |
| `cloud` | Cloud IDE managed | Development in cloud environment |
| `github` | GitHub remote | New project from GitHub or organization repo |

### Project Settings

**Where**: Project → Settings (gear icon)

**Key Fields**:
- **Repository Name**: Identifier for the codebase
- **Repository Type**: local / cloud / github
- **Local Path**: Path to local repository
  - Absolute: `/Users/name/projects/my-app`
  - Home relative: `~/projects/my-app`
  - Workspace relative: `../../../my-repo`
- **GitHub Repository**: GitHub URL (for github type)
  - Format: `https://github.com/owner/repo` or `owner/repo`
- **Base Branch**: Default branch for operations (e.g., `main`, `master`)

---

## Git Operations

### Available Operations

| Operation | Description | When to Use |
|-----------|-------------|-------------|
| **Commit** | Save changes to local repository | After code generation or modifications |
| **Push** | Upload commits to remote | Share changes with team |
| **Pull** | Download remote changes | Sync with latest remote state |
| **Create Branch** | Start new feature branch | Before starting new work |

### Working with Branches

Ant creates feature branches for work:
- Default pattern: `ant/{feature-name}`
- Based on configured base branch (main/master)

### Committing Changes

After Ant generates code:
1. Review generated files in the diff view
2. Stage desired changes
3. Enter commit message
4. Click Commit

### Pushing to Remote

Prerequisites:
- GitHub PAT must be configured
- Repository must have remote origin set
- You must have write access to the repository

Process:
1. Ensure all changes are committed
2. Click Push
3. Ant authenticates using stored PAT
4. Changes uploaded to remote branch

---

## Feature Session Management

### Session States

| State | Description |
|-------|-------------|
| `idle` | Ready to start new work |
| `in_progress` | Work is ongoing |
| `paused` | Execution paused (can resume) |
| `completed` | Work finished |

### Resuming Work

If work is interrupted (API limits, errors, manual stop):
1. Session state is automatically saved
2. Re-run the same job to resume
3. Ant continues from last checkpoint

### Clearing Session

To start fresh:
1. Go to Feature → Settings
2. Click "Clear Session"
3. Or delete `session.json` from feature directory

---

## Project Structure

### Workspace Layout

```
workspace/
├── {project}/
│   ├── config.json          # Project configuration
│   └── {feature}/
│       ├── inputs/
│       │   ├── sources/
│       │   │   └── prd.md       # Requirements document
│       │   └── directives/
│       │       ├── design/      # Design task instructions
│       │       └── code/        # Code task instructions
│       ├── outputs/
│       │   ├── design/          # Generated design documents
│       │   ├── reports/         # Execution logs
│       │   └── eval/            # Evaluation results
│       └── session.json         # Session state
```

### Input Sources

| Source | Path | Purpose |
|--------|------|---------|
| PRD | `inputs/sources/prd.md` | Requirements document |
| Screens | `inputs/sources/screens/` | UI reference images |
| Design Directive | `inputs/directives/design/` | Design task instructions |
| Code Directive | `inputs/directives/code/` | Code task instructions |

---

## Configuration Options

### Project Config (`config.json`)

```json
{
  "projectName": "my-app",
  "repoType": "local",
  "localPath": "/path/to/repo",
  "githubRepo": "owner/repo",
  "branchBase": "main",
  "autoLearn": true,
  "strictValidation": true
}
```

### Config Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `projectName` | string | Project identifier |
| `repoType` | local/cloud/github | Repository type |
| `localPath` | string | Local repository path |
| `githubRepo` | string | GitHub repository URL |
| `branchBase` | string | Base branch name |
| `autoLearn` | boolean | Auto-learn from changes |
| `strictValidation` | boolean | Enable strict mode |

---

## Troubleshooting

### "GitHub PAT not configured"

**Solution**: Go to Account Settings → GitHub Integration → Save your PAT

### "Repository not initialized"

**Solution**: 
- For local repos: Ensure path points to a git-initialized directory
- For GitHub repos: Ant will clone automatically on first use

### "Push failed - no write access"

**Solution**: 
- Verify PAT has `repo` scope
- Check you have write permissions to the repository

### "Session corrupted"

**Solution**: Clear session and restart the feature
