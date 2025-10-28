# CLI Usage Guide

## Overview

ANT (AI-Native Transformation) provides a structured CLI for running AI agents on your codebase.

**Command Structure:**
```bash
aidev <agent> <task> [options] <input>
```

---

## Quick Start

### 1. Architecture Design
Generate design from PRD:
```bash
aidev architect design workspace/my-app/auth/inputs/directives/design/directive.md
```

Short form:
```bash
aidev arch design workspace/my-app/auth/inputs/directives/design/directive.md
```

### 2. Code Generation
Generate code from design:
```bash
aidev architect code workspace/my-app/auth/
```

With edit mode:
```bash
aidev architect code workspace/my-app/auth/ --mode edit
```

### 3. Learning
Learn from repository patterns:
```bash
aidev architect learn workspace/my-app/common/inputs/directives/learn/directive.md
```

### 4. Code Review
Review code changes:
```bash
aidev review workspace/my-app/auth/ --pr 123
```

### 5. Project Planning
Create project plan:
```bash
aidev plan workspace/my-app/project-requirements.md
```

### 6. Documentation
Generate documentation:
```bash
aidev doc workspace/my-app/
```

---

## Agents

### Architect (`architect`, `arch`)
Architecture design and code generation

**Tasks:**
- `design` - Generate architecture design from PRD
- `code` - Generate code from design document
- `learn` - Learn repository patterns and conventions

**Options:**
- `--mode <mode>` - Code generation mode (code task only)
  - `generate` (default) - Generate new code
  - `edit` - Edit existing code
  - `refactor` - Refactor existing code
- `--project <name>` - Override auto-detected project

**Examples:**
```bash
# Design
aidev arch design workspace/my-app/auth/inputs/directives/design/directive.md

# Code generation
aidev arch code workspace/my-app/auth/
aidev arch code workspace/my-app/auth/ --mode edit

# Learning
aidev arch learn workspace/my-app/common/inputs/directives/learn/directive.md
```

---

### Reviewer (`review`, `reviewer`)
Code review and quality checks

**Options:**
- `--pr <number>` - Pull request number to review
- `--project <name>` - Override auto-detected project

**Examples:**
```bash
# Review directory
aidev review workspace/my-app/auth/

# Review PR
aidev review workspace/my-app/auth/ --pr 123
```

---

### Planner (`plan`, `planner`)
Project planning and sprint breakdown

**Options:**
- `--project <name>` - Override auto-detected project

**Examples:**
```bash
aidev plan workspace/my-app/project-requirements.md
```

---

### Doc (`doc`)
Documentation generation and updates

**Options:**
- `--project <name>` - Override auto-detected project

**Examples:**
```bash
aidev doc workspace/my-app/
```

---

## Input Resolution

The CLI automatically resolves input files based on the task:

### Design Task
**Input:** Directive file
```
workspace/project/feature/inputs/directives/design/
├── directive.md        ← Used if no numbered files
└── directive-N.md      ← Highest N is used
```

### Code Task
**Input:** Latest design document
```
workspace/project/feature/outputs/design/
└── design-*.md         ← Latest is automatically selected
```

Optional code directive:
```
workspace/project/feature/inputs/directives/code/
└── directive.md        ← Applied if exists
```

### Learn Task
**Input:** Learn directive
```
workspace/project/common/inputs/directives/learn/
└── directive.md
```

---

## Project Auto-Detection

The CLI automatically detects the project name from the path:
```
workspace/my-app/...  → Project: my-app
workspace/cross-ramp/... → Project: cross-ramp
```

Override with `--project`:
```bash
aidev arch design workspace/my-app/auth/directive.md --project custom-name
```

---

## Code Generation Modes

Use `--mode` with the `code` task:

### Generate (default)
Create new files from scratch:
```bash
aidev arch code workspace/my-app/auth/
```

### Edit
Modify existing files:
```bash
aidev arch code workspace/my-app/auth/ --mode edit
```

### Refactor
Refactor existing code:
```bash
aidev arch code workspace/my-app/auth/ --mode refactor
```

---

## Development Mode

During development, use `npm run dev`:
```bash
# Old style (still works)
npm run dev arch-design workspace/my-app/auth/directive.md

# New style (recommended)
npm run dev arch design workspace/my-app/auth/directive.md
```

---

## Global Installation (Future)

After building and publishing:
```bash
npm install -g ant
aidev arch design workspace/my-app/auth/directive.md
```

---

## Help

Show help for any command:
```bash
aidev --help
aidev architect --help
aidev arch design --help
```

---

## Examples

### Full Workflow
```bash
# 1. Learn from existing codebase
aidev arch learn workspace/my-app/common/inputs/directives/learn/directive.md

# 2. Design new feature
aidev arch design workspace/my-app/auth/inputs/directives/design/directive.md

# 3. Generate code
aidev arch code workspace/my-app/auth/

# 4. Review changes
aidev review workspace/my-app/auth/

# 5. Update documentation
aidev doc workspace/my-app/
```

### Multiple Features
```bash
# Design all features
aidev arch design workspace/my-app/auth/inputs/directives/design/directive.md
aidev arch design workspace/my-app/payment/inputs/directives/design/directive.md
aidev arch design workspace/my-app/notifications/inputs/directives/design/directive.md

# Generate code for all
aidev arch code workspace/my-app/auth/
aidev arch code workspace/my-app/payment/
aidev arch code workspace/my-app/notifications/
```

---

**Version:** 1.0.0  
**Last Updated:** 2025-10-28
