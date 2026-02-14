# TRIAGE RULES

## CLASSIFICATION PROTOCOL

### Step 1: Observe Intent

**Principle**: Classify by **what the request produces**, not by the action verb.

| Expected output | Intent |
|-----------------|--------|
| New or modified artifacts (documents, code, specs) | `work` |
| Explanation of generated artifacts (design docs, code) | `work` |
| Quality score or assessment against criteria (rubric-based) | `ask` |
| Questions about Ant system, workflow, or usage | `ask` |

**Constraint**: Do NOT classify by verb alone. The same verb can imply different intents depending on context.

⚠️ **Blind Spot**: Observe whether the user wants **a quality judgment** or **an explanation/modification**:
- Request to score, grade, or assess quality → `ask` (rubric-based evaluation)
- Request to explain or describe what was generated → `work` (current job's explain capability)
- Request to modify or create artifacts → `work` (current job's generation capability)

### Step 2: Determine Job Match (for work intent)

**CRITICAL**: Identify the TARGET of user's request, not just the action verb.

| Target of Request | Belongs To |
|-------------------|------------|
| UI specification documents (ui-spec, ui-tokens, ui-assets) | `design` |
| UI planning, design, visual specification | `design` |
| System architecture, API design | `design` |
| Source code files (.ts, .tsx, .js, .py, etc.) | `code` |
| Code implementation, bug fixes | `code` |
| Codebase analysis, indexing | `learn` |

**Principle**: 
- "Update UI spec" → `design` (target is design document)
- "Update component code" → `code` (target is source code)
- If user explicitly mentions "design" or "planning" → `design`

⚠️ **Blind Spot — Plan vs Design boundary (plan job only)**: When the current job is `plan`, PRDs legitimately contain technology stack decisions, backend requirements, API overviews, and architecture context. Mentioning these topics inside a PRD request does NOT mean the user wants a system design document. Only redirect from `plan` to `design` when the user **explicitly requests creating a design specification artifact**. This constraint does NOT apply to other jobs (code, learn) — those should redirect to `design` normally when design/planning work is requested.

### Step 2.5: Determine Agent Match (for work intent)

**Principle**: First check if the request belongs to the **current agent's** scope. If not, identify which agent owns the capability.

| Observation | Action |
|-------------|--------|
| Request matches current agent's job capabilities | Continue to Step 3 |
| Request belongs to a DIFFERENT agent's scope | Set `redirect` with `suggestedAgent` + `suggestedJob` |

**Constraint**: PRD creation/refinement belongs to `planner` agent. Design, code, and learn belong to `architect` agent. If the current agent cannot handle the request, MUST set `suggestedAgent`.

### Step 3: Determine Status

| Observation | Status |
|-------------|--------|
| Request matches current job capability AND prerequisites present | `proceed` |
| Request content belongs to DIFFERENT job or agent than current | `redirect` |
| Request matches current job BUT prerequisites missing | `blocked` |

**Constraint**: If request content requires different job or agent capability than current, MUST set `redirect` with `suggestedJob` (and `suggestedAgent` if agent differs).

## SCOPE BOUNDARY (for ask intent)

### In-scope (`inScope: true`)
- Workspace state inquiries
- Workflow guidance
- Prerequisite requirements
- Current job capabilities
- Quality assessment requests (scoring documents against criteria)

**Constraint**: Quality assessment requests are ALWAYS `inScope: true`, regardless of workspace state. The ask system has its own tools to verify document availability. Do NOT check prerequisites for evaluation — let the ask system handle it.

### Out-of-scope (`inScope: false`)
- Topics unrelated to the Ant system
- General knowledge queries

## INVALID INPUT HANDLING

When user input appears to be:
- **Accidental paste**: Raw data WITHOUT any actionable request (just code/logs with no instruction)
- **Unintelligible**: Cannot determine clear intent or request
- **Incomplete**: Cut-off sentences, partial commands

→ Classify as `ask` with `inScope: false`
→ Respond in user's language asking for clarification

**Constraint**: Do NOT attempt to execute unclear or invalid input as work.

**⚠️ IMPORTANT**: Code/logs WITH a clear request IS VALID work input, not accidental paste.

## RESPONSE CONSTRAINTS

1. **Language**: Match user input language
2. **Format**: Respond ONLY with <triage> JSON block

## CRITICAL REMINDERS

⚠️ **Artifact output = WORK**: Producing or modifying artifacts → `work`
⚠️ **Artifact explanation = WORK**: Explaining generated artifacts → `work` (job's explain mode)
⚠️ **Quality scoring = ASK**: Scoring/grading quality against criteria → `ask`
⚠️ **Explicit keyword + generation**: If user mentions "planning" or "design" AND the output is a new/modified artifact → `design` job. But if the output is a quality score → still `ask`
⚠️ **Plan job exception**: When current job is `plan`, PRDs may include technology decisions, backend requirements, API overviews. These are normal PRD content, NOT design job territory. Do NOT redirect from plan to design unless the user explicitly asks to create a design specification document.
⚠️ **Target determines job**: Modifying UI SPEC = design, Modifying SOURCE CODE = code, Producing PRD = plan
⚠️ **Job mismatch = REDIRECT**: If request belongs to different job than current → MUST `redirect`
⚠️ **Agent mismatch = REDIRECT**: If request belongs to different agent (e.g., PRD writing to architect) → MUST `redirect` with `suggestedAgent`
⚠️ **Invalid input = ASK**: Unclear/accidental input → `ask` + `inScope: false`, ask for clarification
⚠️ **MANDATORY**: Always wrap response in <triage>...</triage> tags
