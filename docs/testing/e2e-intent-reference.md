# Intent E2E Reference

Reference for manual E2E testing. With a live server running, call the API for each intent.

## Prerequisites

```bash
pnpm dev:infra        # Redis + ChromaDB
pnpm dev:all    # API + Realtime + Job + Preview + UI + site
```

A workspace and a feature must already exist.

---

## Plan

### gen-plan

```bash
curl -X POST http://localhost:4100/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "directive": "Plan a team-collaboration project management web service",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-plan"
    }
  }'
```

- **Expected triage**: agent=planner, jobType=plan
- **Expected output**: `plan/prd.md`
- **PASS criteria**: prd.md is created and contains the "project management" keyword

### rev-plan

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Add social login and remove guest mode",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-plan",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **Expected triage**: agent=planner, jobType=plan, mode=refactor
- **Expected output**: `plan/prd.md` (revised)
- **PASS criteria**: social-login content added, guest mode removed

---

## System Design

### gen-sys-fe

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Design the frontend system with React",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-sys-fe",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, workType=system-design, environment=frontend
- **Expected output**: `architecture/system/fe-system-*.md`
- **PASS criteria**: fe-system-main.md created, contains React/frontend-related content

### gen-sys-be

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Design the backend system with Express",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-sys-be",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, workType=system-design, environment=backend
- **Expected output**: `architecture/system/be-system-*.md`, `architecture/system/api-contract-*.md`
- **PASS criteria**: be-system-main.md and api-contract-main.md created

### gen-sys-full

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Design the full-stack system",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-sys-full",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, workType=system-design, environment=fullstack
- **Expected output**: `architecture/system/fe-system-*.md`, `architecture/system/be-system-*.md`, `architecture/system/api-contract-*.md`
- **PASS criteria**: frontend + backend + API contract documents all created

### rev-sys

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Change the authentication method to OAuth",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-sys",
      "refs": ["architecture/system/fe-system-main.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, mode=refactor, workType=system-design
- **Expected output**: `architecture/system/fe-system-main.md` (revised)
- **PASS criteria**: revised with OAuth-related content

---

## UI Design

### gen-ui-figma

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Extract the UI design from the Figma file",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-ui-figma",
      "refs": ["visual/ui/figma/figma.json"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, workType=ui-design
- **Expected output**: `visual/ui/ant/ui-tokens.json`, `visual/ui/ant/ui-assets.json`, `visual/ui/ant/ui-spec.json`
- **PASS criteria**: 3 UI design files created
- **Note**: figma.json is a config file of the form `{ "file": "<figma-url>" }`. Its content is not injected into the prompt.

### gen-ui-desc

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Design the UI based on the PRD",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-ui-desc",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, workType=ui-design
- **Expected output**: `visual/ui/ant/ui-tokens.json`, `visual/ui/ant/ui-assets.json`, `visual/ui/ant/ui-spec.json`
- **PASS criteria**: 3 UI design files created

### rev-ui

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Change the color palette to a dark theme",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-ui",
      "refs": ["visual/ui/ant/ui-tokens.json"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, mode=refactor, workType=ui-design
- **Expected output**: `visual/ui/ant/ui-tokens.json` (revised)
- **PASS criteria**: changed to dark-theme colors

---

## Spec

### gen-spec

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Write the task search API spec based on the design documents",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-spec",
      "refs": ["architecture/system/be-system-main.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, workType=spec
- **Expected output**: `architecture/spec/spec-*.md`
- **PASS criteria**: spec file created

### rev-spec

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Change pagination from offset to cursor",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-spec",
      "refs": ["architecture/spec/spec-search-api.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=design, mode=refactor, workType=spec
- **Expected output**: `architecture/spec/spec-search-api.md` (revised)
- **PASS criteria**: changed to cursor-based pagination

---

## Code

### gen-code-sys

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Generate code based on the design documents",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-sys",
      "refs": ["architecture/system/fe-system-main.md"],
      "context": ["visual/ui/ant/ui-spec.json"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=code, mode=generate
- **Expected output**: source code files in the codebase
- **PASS criteria**: frontend code generated (React components, routing, etc.)

### gen-code-spec

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Implement the task search API based on the spec",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-spec",
      "refs": ["architecture/spec/spec-search-api.md"],
      "context": ["architecture/system/be-system-main.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=code, mode=generate
- **Expected output**: API endpoint code in the codebase
- **PASS criteria**: task search API endpoint implemented

### gen-code-directive

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Build a simple TODO app",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-directive"
    }
  }'
```

- **Expected triage**: agent=architect, jobType=code, mode=generate
- **Expected output**: source code files in the codebase
- **PASS criteria**: from the directive alone, generates an app skeleton or code matching the requested scope

### gen-code-spec (spec-based modification on an existing codebase)

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Refactor the code based on the spec document",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-spec",
      "refs": ["architecture/spec/spec-search-api.md"]
    }
  }'
```

- **Expected triage**: agent=architect, jobType=code, mode=generate
- **Expected output**: existing code modified
- **PASS criteria**: code modified to match the spec; on an existing codebase the existing-code-discipline injection is included

### gen-code-directive (directive delta on an existing codebase)

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Refactor the code for performance optimization",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-directive"
    }
  }'
```

- **Expected triage**: agent=architect, jobType=code, mode=generate
- **Expected output**: existing code optimized (existing-code discipline applied, unrelated code untouched)
- **PASS criteria**: refactor-guidance injection included

---

## Debug Procedure

When an automated test fails:
1. Check the vitest snapshot diff (which injections changed)
2. Run the intent on a real server
3. Inspect `sessions/{agent}/debug/prompts/prompt-{jobId}.md`
4. Inspect `sessions/{agent}/debug/logs/log-{jobId}.json`
