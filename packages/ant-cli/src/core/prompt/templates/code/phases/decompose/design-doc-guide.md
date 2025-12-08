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

**Example Mapping:**
```
Design Doc Section       → Task
├─ "3.1 User Auth"       → "Implement user authentication"
├─ "3.2 Room Management" → "Implement room CRUD operations"
└─ "3.3 Game Logic"      → "Implement game state management"
```

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

