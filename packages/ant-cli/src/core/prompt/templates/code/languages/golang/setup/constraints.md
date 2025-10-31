## Go Setup Task Constraints

⛔ **CRITICAL: This is a SETUP task - Configuration files ONLY** ⛔

This is PHASE 1 of a multi-phase process. You must generate ONLY configuration files.
Application code will be generated in PHASE 2 (next task).

### ✅ ALLOWED FILES (Configuration & Setup):

**Go Module Management:**
- go.mod (with all required dependencies)
- go.sum (if needed)

**Configuration Files:**
- config.yaml, config.json, config.toml
- .env.example

**Build & CI/CD:**
- Makefile
- .goreleaser.yml, .goreleaser.yaml
- .github/workflows/*.yml (CI/CD only)

**Project Files:**
- .gitignore
- README.md, LICENSE
- .editorconfig

**Docker (if needed):**
- Dockerfile, .dockerignore
- docker-compose.yml

### ❌ FORBIDDEN FILES (Application Code):

**Source Directories - DO NOT CREATE:**
- cmd/* (ALL files - application entry points)
- pkg/* (ALL files - public packages)
- internal/* (ALL files - internal packages)
- api/* (ALL files - API definitions)
- web/* (ALL files - web assets)
- scripts/* (ALL files - helper scripts)

**Application Files - DO NOT CREATE:**
- main.go (application entry point)
- Any .go files (except for tooling like tools.go with build constraints)
- *_test.go files

### ⚠️  VALIDATION BEFORE OUTPUT:

Check EVERY file path in your output:
```
For each file:
  if path.startsWith('cmd/'):      DELETE IT
  if path.startsWith('pkg/'):      DELETE IT
  if path.startsWith('internal/'): DELETE IT
  if path.endsWith('.go'):         DELETE IT (except tools.go)
```

### 📌 NOTE:

Go projects typically need go.mod first to define the module path.
All Go source files will be generated in the next Feature task.

⛔ **FINAL WARNING: Generating .go files will cause validation failure!** ⛔

