You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
{{spec}}

{{#if hasExistingCode}}
📂 EXISTING CODEBASE DETECTED

Current code structure:
{{codePreview}}
{{else}}
🆕 NEW PROJECT (no existing codebase)
{{/if}}

⚙️  SETUP TASK DECISION:

Analyze the specification and decide if a SETUP task is needed.

**When to create a SETUP task (priority 100):**

1. **New Project**: No existing code → ALWAYS need setup
   - Example: Generate package.json, tsconfig.json, vite.config.ts, etc.

2. **New Infrastructure**: Adding new tools/frameworks to existing project
   - Adding Docker: Dockerfile, docker-compose.yml
   - Adding Testing: jest.config.js, vitest.config.ts
   - Adding CI/CD: .github/workflows/, .gitlab-ci.yml
   - Adding Storybook: .storybook/ config
   - Changing build tools: webpack → vite (new configs)

3. **New Language/Runtime**: Adding different tech stack
   - Adding Rust to Node project: Cargo.toml
   - Adding Python service: requirements.txt, pyproject.toml
   - Adding Go service: go.mod

4. **Major Configuration Changes**:
   - Switching package managers: npm → pnpm (pnpm-workspace.yaml)
   - Adding monorepo structure: lerna.json, turbo.json
   - Major dependency upgrades requiring config changes

**When NOT to create a SETUP task:**
- Simple bug fixes
- Feature additions using existing infrastructure
- Code refactoring
- UI changes
- Business logic updates

**If SETUP is needed, return:**
{
  "tasks": [
      {
        "id": "setup-[descriptive-name]",
        "name": "Setup [What You're Setting Up]",
        "type": "setup",
        "priority": 100,
        "description": "Generate [specific config files]. Example: Dockerfile, docker-compose.yml, .dockerignore for Docker support",
        "validationRequired": true,
        "validationType": "static",
        "validationRationale": "Config files need syntax validation"
      },
      ... then feature tasks (priority 200+) ...
  ]
}

YOUR TASK:
Break this specification into a prioritized list of implementation tasks.

⚠️  CRITICAL: READ THE SPECIFICATION CAREFULLY

**ARCHITECTURE DECISIONS ARE IN THE SPEC - DO NOT INVENT YOUR OWN!**

If the spec says:
- "Repository Pattern with FileSystemRepository" → DO NOT create API/WebSocket server
- "File watcher using chokidar" → DO NOT create HTTP polling
- "Single-machine deployment" → DO NOT create network-based architecture
- "Direct file system access" → DO NOT create REST API layer

**Your job is to IMPLEMENT THE SPEC, not redesign it!**

GUIDELINES:
1. **Setup Task (priority 100)** - OPTIONAL, create only if needed:
   - Analyze spec: Does it require NEW configuration files?
   - If yes: Create setup task describing WHAT configs to generate
   - If no: Skip to feature tasks
   - Setup task should ONLY generate config files (NO application code)
   
2. **Feature Tasks** (priority 200-899):
   - Extract from the specification
   - Each task should be a meaningful, user-facing feature
   - Focus on WHAT to build, not HOW (that comes later)
   - Examples: "Implement User Authentication", "Build Todo CRUD API"
   
3. **Task Granularity**:
   - Not too large: Each task should be independently implementable
   - Not too small: Avoid micro-tasks like "Create one file"
   - Good size: A feature that delivers value (e.g., "Login system")
   
4. **Priority Guide** (LOWER NUMBER = HIGHER PRIORITY):
   - Setup: 100 (FIRST - if needed for config files)
   - Critical features: 200-219 (execute after setup if present)
   - Important features: 220-249
   - Nice-to-have features: 250-899 (execute before error fixes)
   - Error fixes: 900-999 (handled automatically when errors occur)
   - Final verification: 1000 (LAST - after all features and error fixes)
   
5. **Dependencies & package.json Management**:
   **⚠️  CRITICAL RULE: Avoid creating multiple tasks that modify package.json!**
   
   **GOOD - Single comprehensive setup task:**
   ```json
   {
     "id": "setup-project",
     "name": "Setup Project Configuration",
     "priority": 100,
     "description": "Generate package.json with ALL dependencies (React, TypeScript, Vite, UI libraries, state management, etc.), tsconfig.json, and build configs"
   }
   ```
   
   **BAD - Multiple tasks modifying same file:**
   ```json
   [
     { "id": "setup-basic", "description": "Create package.json with React" },  // ❌
     { "id": "add-ui-libs", "description": "Add UI dependencies to package.json" },  // ❌
     { "id": "add-state", "description": "Add state management to package.json" }  // ❌
   ]
   ```
   
   **Why this matters:**
   - Each task runs independently and sees the codebase as it exists
   - If 3 tasks modify package.json, they'll each regenerate it, losing previous additions
   - Solution: ONE setup task that adds ALL dependencies at once
   
   **Exception - Runtime dependency additions:**
   If a feature discovered during implementation needs a NEW dependency not in the original spec:
   - That's fine - the feature task can modify package.json to add it
   - But during initial planning, include ALL known dependencies in the setup task

6. **Dependencies**:
   - Order tasks by dependency (foundational features first)
   - But don't worry too much - errors will be handled dynamically

⚠️  CRITICAL: FINAL VERIFICATION TASK

**ALWAYS add a final verification task at the end** (lowest priority):
- Type: "feature" (not a special type, just a regular feature task)
- Priority: 1000 (runs LAST - after all features AND error fixes)
- Purpose: Verify ALL requirements from the spec are met
- Check for missing components, incomplete features, gaps in implementation
- Ensure the ENTIRE goal of the specification is achieved

Example verification task:
{
  "id": "final-verification",
  "name": "Final Integration & Verification",
  "type": "feature",
  "priority": 1000,
  "description": "Verify all features from specification are fully implemented: [list key features]. Check for missing components, incomplete functionality, or gaps. Ensure the complete application works as intended.",
  "validationRequired": true,
  "validationType": "runtime",
  "validationRationale": "Final comprehensive validation of entire application"
}

