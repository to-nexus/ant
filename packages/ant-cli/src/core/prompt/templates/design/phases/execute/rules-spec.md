## Codebase Exploration Protocol

**Principle**: A spec grounded in actual code produces actionable implementation tasks. A spec written without codebase knowledge produces generic placeholders.

**Observation targets** (use tools to investigate):

| Target | What to observe |
|--------|----------------|
| **Architecture boundary** | Where does the requested feature touch existing modules? |
| **Data flow** | How does data currently move through the relevant area? |
| **Naming conventions** | What patterns do existing modules follow? |
| **Integration points** | Which existing files need modification vs new files needed? |

**Constraint**: Do NOT assume code structure. When the directive describes changes to an existing system, use search_code and read_file to verify actual structure before specifying Technical Approach and Implementation Tasks.

**Constraint**: When you need to inspect multiple files, issue ALL needed tool calls in ONE response. Do NOT discover incrementally when the context already reveals the needed set.

**Constraint**: Do NOT explore the entire codebase. Focus only on the area directly relevant to this section's scope.

⚠️ **Blind spot**: LLMs tend to write specs from imagination rather than observation. If the directive references existing functionality, ALWAYS verify with tools before writing.

### External API Verification

**Observation target**: Does this spec section describe integration with an external SDK, API, or service?

**Constraint**: If yes, use `search_web` to verify the current API surface (endpoints, auth method, rate limits) before specifying technical approach. Do NOT assume training-data accuracy for third-party interfaces.

════════════════════════════════════════════════════════════════════════════════

## Section Scope Constraint

**Principle**: Each task covers exactly the scope assigned to it. Overlap between sections produces duplicate, contradictory, or incomplete specs.

**Constraint**: Write ONLY the content described in the CURRENT SECTION SCOPE. Do NOT write content that belongs to other sections.

**Constraint**: Do NOT repeat content that appears in ALREADY WRITTEN sections.

**Constraint**: Each section must be independently readable but reference earlier sections by name rather than restating their content.

⚠️ **Blind spot**: LLMs tend to write "complete" documents rather than assigned sections. Always check CURRENT SECTION SCOPE before writing.

════════════════════════════════════════════════════════════════════════════════

## Rules

1. Be specific and concrete. Use your tools to discover actual file paths, function names, and data structures. Reference them in the spec.
2. Break down the implementation into ordered, atomic tasks that can each be executed independently.
3. If you need more information from the user to write a complete spec, wrap your questions in a `<clarify>` tag:
   ```xml
   <clarify>
   - Question 1?
   - Question 2?
   </clarify>
   ```
   **Constraint**: When using `<clarify>`, do NOT output the spec file and do NOT output `<done>`. Only ask questions. Wait for the user's response.
4. Do NOT include generic placeholder content. If a section requires codebase knowledge, use tools to gather it first. Every section must contain actionable, project-specific information.
5. The spec should be self-contained: a reader should understand the full scope without needing other documents.

════════════════════════════════════════════════════════════════════════════════

## 🚨 TASK COMPLETION SIGNAL (CRITICAL)

**When you have completed all work for this task, you MUST output:**

```xml
<done>true</done>
```

**Rules:**
1. Output `<done>true</done>` ONLY after:
   - Document content has been generated with `<file>` or `<append>` tag
   - You have no more tool calls to make

2. **Do NOT output `<done>true</done>` if:**
   - You just made a tool call (wait for the result first)
   - You haven't generated the document yet
   - You used `<clarify>` tag (wait for user response)

3. **Typical flow:**
   ```
   Turn 1: search_code(...), read_file(...) → Wait
   Turn 2: <file>...</file> or <append>...</append> + <done>true</done>
   ```

**⚠️ If you don't output `<done>true</done>`, the system will retry and ask you to continue.**
