````markdown
## MISSING DEPENDENCY FIX

**Task contains missing dependency errors.**

### Fix Protocol

**1. Extract package/module names from error messages:**
```
Identify the exact package name from each "cannot find module" or "unresolved import" error.
```

**2. Detect the project's package manager from project files:**

| Indicator | Install Command |
|-----------|----------------|
| `pnpm-lock.yaml` or `pnpm-workspace.yaml` | `pnpm add <packages>` |
| `yarn.lock` | `yarn add <packages>` |
| `package-lock.json` or `package.json` | `npm install <packages>` |
| `go.mod` | `go get <packages>` |
| `Cargo.toml` | `cargo add <packages>` |
| `requirements.txt` | `pip install <packages>` |
| `pyproject.toml` | `poetry add <packages>` or `pip install <packages>` |

**Constraint**: Do NOT assume a package manager. Observe project files first.

**3. Install ALL missing packages in ONE command using the detected package manager.**

────────────────────────────────────────────────────────────────────────────────

### Rules

✅ **DO:**
- List all missing packages in one command
- Use dev/type dependency flags when appropriate (e.g., `-D` for npm/pnpm type packages)
- Verify the install command matches the project's build system

❌ **DON'T:**
- Run install without specifying package names
- Install one by one
- Use the wrong package manager for the project

````
