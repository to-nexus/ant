{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
## 📐 DESIGN SPECIFICATION AVAILABLE
════════════════════════════════════════════════════════════════════════════════

**The specification includes design documents.**

{{#if (or (eq mode "refactor") (eq mode "explain"))}}
**For Bug Fix/Refactor:**
- Directive describes the bug/issue
- Design document provides context
- Focus on what's broken, reference spec for context

{{else}}
**For New Features:**
- Design document = PRIMARY source of requirements
- Directive = High-level goal
- **Break tasks based on design document structure**

**Task Alignment:**
- Tasks should map to design document sections
- Each feature in spec → One or more tasks
- Don't invent features not in spec

════════════════════════════════════════════════════════════════════════════════
## 🏗️ REPOSITORY STRUCTURE DECISION
════════════════════════════════════════════════════════════════════════════════

**Observation target**: How many independently deployable tiers does the design document describe?

| Checkpoint | What to observe |
|-----------|----------------|
| **Tier count** | Count distinct document prefixes: `fe-system-*`, `be-system-*`, `api-contract-*` |
| **Service boundaries** | Are there multiple `be-system-{service}.md` files (one per service)? |
| **Shared contracts** | Does `api-contract-*` exist, implying a frontend-backend integration boundary? |

{{#if (and (includes designDoc "fe-system-") (includes designDoc "be-system-"))}}
✅ **Fullstack project detected** (Frontend + Backend design documents present)
{{/if}}

**Principle**: Repository structure follows tier boundaries — each independently buildable tier becomes a package in a multi-package workspace. A single-tier project remains monolithic.

**Constraint**: When multiple `be-system-{service}.md` files exist, each service boundary becomes a separate package. Package names MUST match the service name in the design document filename.

**Constraint**: Shared types and contracts (from `api-contract-*`) belong in a dedicated shared package when the project has multiple tiers or services.

**Setup task mapping**:
- **Single tier** → single setup task (priority 100, exclusive)
- **Multiple tiers/services** → root workspace setup (priority 100, exclusive) + per-package setup (priority 101+, non-exclusive, distinct parallelGroup per package)

════════════════════════════════════════════════════════════════════════════════
## 🏗️ MSA DESIGN DOCUMENT HANDLING
════════════════════════════════════════════════════════════════════════════════

**Observation target**: Does the design document set include multiple service-scoped documents?

| Pattern Observed | Document Type | Package Strategy |
|------------------|---------------|------------------|
| Single `be-system-main.md` only | Unified | Single package |
| `api-contract-*` + single `be-system-main.md` | Contract-First | FE + BE packages |
| `api-contract-*` + multiple `be-system-*.md` | MSA-Contract-First | Package per service |

**Principle**: Each service boundary maps to one package. Each service task references ONLY its own design document via the `packages` field.

**Constraint**: Do NOT mix service implementations in a single task. Each service task targets a single `be-system-{service}.md` scope.

**Constraint**: All tasks that involve cross-tier integration reference `api-contract-*` for interface contracts (this is automatic via the `packages` tag — api-contract is always injected).

⚠️ **Blind spot**: When multiple services share a database or message queue, they APPEAR coupled but MUST still be separate tasks with separate packages. Cross-service coordination belongs in a shared foundation task.

════════════════════════════════════════════════════════════════════════════════

**Critical Rules:**
- ✅ Every task must reference design doc
- ✅ Follow spec's architecture decisions
- ❌ Don't add tasks for features not in spec
- ❌ Don't change/improve spec's architecture

{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{designDoc}}

════════════════════════════════════════════════════════════════════════════════

{{/if}}
