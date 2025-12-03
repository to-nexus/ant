## Keyword Generation Guidelines

### Purpose

Keywords are used to search the Vector DB and find relevant code files for this specific task.
The codeGen node will receive the actual file contents based on these keywords.

### Keyword Categories

Generate keywords for:

1. **Main Codebase**: Keywords for searching THIS project's code
   - File names mentioned in task
   - Function/class names
   - Related patterns and concepts
   - Import/export dependencies

{{#if hasReferences}}
2. **Reference Projects**: Keywords for each reference project (ONLY if needed for this task)
   - API patterns to follow
   - Code structures to reference
   - Specific implementations to mirror
{{/if}}

### Best Practices

**DO:**
- Include 5-15 keywords per category
- Use specific file names when known (e.g., "WebSocketServer.ts")
- Include related concepts (e.g., for "WebSocket" also include "socket", "connection", "handler")
- Think about what files might import/export the target code

**DON'T:**
- Use overly generic keywords (e.g., just "code", "file", "function")
- Include unrelated concepts
- Generate reference keywords if no reference projects are available

### Examples

**Task: "Add auth middleware using backend patterns"**
- Codebase: ["middleware", "auth", "authentication", "request handler", "express", "jwt", "token", "verify"]
- References: { "backend": ["middleware pattern", "auth guard", "jwt verify", "token validation"] }

**Task: "Style login form like dashboard"**
- Codebase: ["login form", "form styles", "input fields", "button", "css", "styled"]
- References: { "dashboard": ["form component", "styling patterns", "theme", "colors"] }

**Task: "Fix WebSocket connection error"**
- Codebase: ["WebSocket", "socket", "connection", "error", "handler", "client", "server", "ws"]
- References: {} (no reference needed)

### Output

Output ONLY valid JSON. No explanations.

