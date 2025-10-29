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
aidev arch design workspace/my-app/auth/inputs/directives/design/directive.md
```

Full form:
```bash
aidev architect design workspace/my-app/auth/inputs/directives/design/directive.md
```

### 2. Code Generation
Generate code from design (auto-detects mode and batch processing):
```bash
aidev arch code workspace/my-app/auth/
```

Explicit mode:
```bash
aidev arch code workspace/my-app/auth/ --mode refactor
```

### 3. Learning
Learn from repository patterns:
```bash
aidev arch learn workspace/my-app/common/inputs/directives/learn/directive.md
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

### Architect (`arch`, `architect`)
Architecture design and code generation

**Tasks:**
- `design` - Generate architecture design from PRD
- `code` - Generate code from design document (auto-detects mode and batch processing)
- `learn` - Learn repository patterns and conventions

**Options:**
- `--mode <mode>` - Code generation mode (optional, auto-inferred if not provided)
  - `generate` - Generate new code
  - `refactor` - Refactor existing code
  - `explain` - Explain code behavior
- `--project <name>` - Override auto-detected project

**Examples:**
```bash
# Design
aidev arch design workspace/my-app/auth/inputs/directives/design/directive.md

# Code generation (mode auto-inferred from directive)
aidev arch code workspace/my-app/auth/

# Explicit mode
aidev arch code workspace/my-app/auth/ --mode refactor

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

The `code` task **automatically infers the mode** from your directive. You can override with `--mode`.

### Mode Inference Priority
1. **Directive keywords** (highest priority)
   - "explain", "describe" → `explain` mode
   - "refactor", "restructure", "migrate" → `refactor` mode
   - Default → `generate` mode
2. **Design document** (if no directive)
3. **Git changes** (if present → `refactor`)

### Generate (default)
Create new code or add features:
```bash
aidev arch code workspace/my-app/auth/
# Directive: "Add user authentication with JWT"
# → Mode: generate (auto-inferred)
```

### Refactor
Refactor or modify existing code:
```bash
aidev arch code workspace/my-app/auth/
# Directive: "Refactor all API routes to use new error handler"
# → Mode: refactor (auto-inferred)

# Or explicit:
aidev arch code workspace/my-app/auth/ --mode refactor
```

### Explain
Analyze and explain code:
```bash
aidev arch code workspace/my-app/auth/
# Directive: "Explain how the authentication flow works"
# → Mode: explain (auto-inferred)
```

---

## Automatic Batch Processing

For large-scale refactoring, the system **automatically detects** when to use batch processing:

### Normal Processing
- Small, focused changes (< 40 files, < 150K tokens)
- Git-based modifications
- Single LLM call with full context

### Batch Processing (Auto-Enabled)
- Large refactoring (≥ 40 files or ≥ 150K tokens)
- Global changes ("update all", "migrate all")
- Processed in chunks with per-batch validation

**Examples:**
```bash
# Small change → Normal processing
aidev arch code workspace/my-app/auth/
# Directive: "Add logout endpoint"
# → Normal mode (auto-detected)

# Large refactoring → Batch processing
aidev arch code workspace/my-app/
# Directive: "Refactor all API routes to use async/await"
# → Batch mode (auto-detected)
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

## Advanced Features

### Smart Mode Inference
The system analyzes your directive to determine the best mode:
- Keywords in directive (primary)
- Design document content (secondary)
- Git change detection (tertiary)

### Intelligent Batch Selection
Work size is estimated before execution:
- File count estimation
- Token count estimation
- Global refactor detection
- Automatic strategy selection

### Context Loading Strategy
Three-stage fallback for code loading:
1. **Git diff** - Fast, focused on changes
2. **Vector DB** - Semantic search for relevant code
3. **Keyword** - Fallback text search

---

**Version:** 1.0.0  
**Last Updated:** 2025-10-29
