# Environment Detection & Mode Inference & RAG Strategy

You are analyzing a development directive to determine:

1. **Code Mode** (generate/refactor/explain)
2. **Development Environment** (frontend/backend/fullstack/unknown)
3. **RAG Requirement** (does decompose need codebase context?)
4. **Search Keywords** (if RAG needed)

Your analysis will determine the entire workflow strategy.

## Directive

{{directive}}

{{#if designDocs}}
## Design Documents Available

{{designDocs}}
{{/if}}

{{#if profile}}
## Project Profile

{{#if profile.language}}- Language: {{profile.language}}{{/if}}
{{#if profile.framework}}- Framework: {{profile.framework}}{{/if}}
{{/if}}

## Analysis Guidelines

### 1. Mode Inference

Determine the **intent** of the directive:

**generate**: Creating new features/files from scratch
- Keywords: "create", "add", "new", "implement", "build", "initialize"
- Context: Empty project or adding completely new components
- Examples:
  - "Create a login page with email and password"
  - "Add a new user management API"
  - "Build a todo list component"

**refactor**: Modifying/improving existing code
- Keywords: "fix", "update", "change", "improve", "refactor", "optimize"
- Context: Existing code needs modification
- Examples:
  - "Fix the null pointer bug in user service"
  - "Update login form to use new design"
  - "Improve performance of data fetching"

**explain**: Understanding/documenting code (READ-ONLY, NO changes)
- Keywords: "explain", "what", "why", "how does", "analyze", "understand", "describe", "document"
- Context: User wants to learn about code
- Important: **"how to implement X" = generate**, **"how does X work" = explain**
- Examples:
  - "Explain how authentication works"
  - "What does the Button component do?"
  - "Analyze the user service architecture"

⚠️ **Critical Distinction**:
- "how to implement" / "how to add" / "how to create" → **generate**
- "how does it work" / "how is it implemented" → **explain**

### 2. Environment Detection

- **frontend**: UI, components, pages, styling, client-side, React, Vue, etc.
- **backend**: API, database, server, business logic, Node.js, Express, etc.
- **fullstack**: Both frontend and backend components
- **unknown**: Unclear or non-code tasks (documentation, planning)

### 3. RAG Requirement

Does the `decompose` node need codebase context?

⚠️ **CRITICAL: Mode ≠ Project Type!**
- **generate/refactor/explain** = What ACTION to take
- **NEW vs EXISTING project** = What PROJECT context exists

**RAG is needed when:**
- ✅ Modifying existing code (refactor)
- ✅ Adding to existing project (generate in existing codebase)
- ✅ Understanding code (explain)
- ✅ Directive mentions existing files, components, or patterns

**RAG is NOT needed when:**
- ❌ Brand new empty project with no code yet
- ❌ Pure documentation or planning tasks

**In practice:** Almost ALWAYS set `requireRagForDecompose: true` unless you're 100% certain it's an empty project with no existing code.

### 4. Keyword Generation (if RAG required)

**Main Project Keywords** (5-10 semantic keywords):
- File names, function names, component names
- Patterns, concepts, APIs
- Be specific to the directive

Examples:
- Directive: "Add password toggle to login form"
  → Keywords: ["login form", "password input", "visibility toggle", "eye icon", "input type password"]
  
- Directive: "Fix null pointer in user service"
  → Keywords: ["user service", "null pointer", "error handling", "getUserById", "validation"]

**Reference Project Keywords** (if directive mentions other projects):
- Per reference project: 3-5 specific keywords
- What to look for in that project

Examples:
- Directive: "Call backend API for user data"
  → Reference: {"backend": ["user API", "auth endpoint", "data schema"]}

## Output Format

Wrap your JSON response in <detect> tags (NO markdown code blocks):

<detect>
{
  "mode": "generate" | "refactor" | "explain",
  "modeReasoning": "Why this mode? (1 sentence)",
  "environment": "frontend" | "backend" | "fullstack" | "unknown",
  "environmentReasoning": "Why this environment? (1 sentence)",
  "requireRagForDecompose": true | false,
  "decomposeKeywords": {
    "codebase": ["keyword1", "keyword2", ...],
    "references": [
      {
        "project": "backend",
        "keywords": ["user API", "auth endpoint"]
      }
    ]
  }
}
</detect>

**CRITICAL:**
- Use <detect> XML tags directly
- NO ```json or ``` markdown blocks
- Just raw XML tags with JSON inside

