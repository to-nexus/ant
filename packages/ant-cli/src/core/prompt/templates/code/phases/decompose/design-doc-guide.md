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

**STEP 1: Decide Repository Structure**

Analyze project characteristics to determine structure:

**Monorepo Indicators:**
{{#if (and (includes designDoc "fe-system-design") (includes designDoc "be-system-design"))}}
- ✅ **Fullstack project** (Frontend + Backend)
{{/if}}
- Multiple independent applications/services
- Shared code/libraries between components
- Medium-to-large scale project

**Monolithic Indicators:**
- Single application (frontend-only or backend-only)
- Small-to-medium scale
- No shared code requirements

**STEP 2: Setup Tasks Based on Structure**

**If MONOREPO:**
- Create MULTIPLE setup tasks (one per package/app + root)
- Example structure:
  1. Root workspace setup (priority 100): workspace config, shared dependencies
  2. Package A setup (priority 101): app-specific config and dependencies
  3. Package B setup (priority 102): app-specific config and dependencies
  4. ...as many as needed

**If MONOLITHIC:**
- Create SINGLE setup task (priority 100)
- All configuration and dependencies in one task

**⚠️ If MSA/Service-Oriented (check design doc for service boundaries):**
- Each service boundary in design doc = separate package
- Shared code (types, DTOs) = separate package
- Create setup task per package (root → shared → services → gateway/frontend)
- **Follow design doc's service naming and boundaries exactly**

**Critical Rules:**
- ✅ Decide structure based on project needs, not rigid rules
- ✅ Create as many setup tasks as needed for chosen structure
- ✅ Assign sequential priorities (100, 101, 102, ...)
- ❌ Don't mention specific file names (package.json, etc.)

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

