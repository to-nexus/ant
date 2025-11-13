<step_1_understand_context>
Carefully read all available inputs above. Then determine:

Q1: What is the PRIMARY task?
Understanding the hierarchy:
- DIRECTIVE (if exists) → Defines WHAT to do (highest priority)
- DESIGN DOCUMENT → Defines HOW to implement (the foundation/basis for all code)
- ORIGINAL FILES → Current baseline to modify
- PRD/SPEC → Original requirements (reference)

Determine your task:
- DIRECTIVE exists? → That's WHAT you need to do (modifications/fixes)
  * Parse directive carefully: questions often mean "explain AND fix"
  * "Why did you X?" = Explain the mistake + Fix it
  * "This has error" = Acknowledge + Fix error
  * BUT implement it according to DESIGN DOCUMENT structure
- Only DESIGN/PRD? → Implement new features following the design
- CURRENT CODE shows work in progress? → Continue/modify existing work

Q2: What supporting context do I have?
- ORIGINAL FILES show the last committed version (the baseline to compare against)
- CURRENT CHANGES show what's been modified (use this to see what work is in progress)
- What's the technical stack?
- What constraints or requirements exist?

CRITICAL: When modifying existing files (MOST IMPORTANT RULE):
- ORIGINAL FILES = Your starting point - DO NOT throw this away!
- If ORIGINAL FILES shows a 200-line file, your plan should result in ~200+ lines, NOT 20 lines
- You are MODIFYING existing code, not creating new code from scratch
- Plan to ADD/CHANGE specific sections, NOT rewrite everything
- Preserve ALL existing: imports, state, hooks, logic, components, comments
- Think: "I'm adding feature X to existing system Y" NOT "I'm building X from scratch"

Modification Strategy:
1. Read ORIGINAL FILES completely
2. Identify ONLY the lines that need to change
3. Plan to keep everything else exactly as is
4. Your output should be similar in size to original (add a few lines, not remove hundreds)

Q3: If directive exists, what does it really want?
- Just explanation? Or explanation + fix?
- Just feedback? Or feedback + apply changes?
- Usually it's BOTH: respond + implement

Answer these questions explicitly in your thinking.
</step_1_understand_context>

<step_2_create_focused_plan>
Based on your understanding, create a MINIMAL plan:

Q4: What EXACTLY needs to be done?
- List specific actions (not generic "implement feature")
- Example: "Remove console.log from Button.tsx line 15"
- Example: "Add useState hook for tab selection in TabMenu.tsx"

Q5: Which files are affected?
- List each file with ACTUAL file paths (from ORIGINAL FILES or DESIGN DOCUMENT)
- Use the EXACT paths as they appear in the project (e.g., "src/components/Button.tsx")
- NEVER use placeholder paths like "path/to/file.tsx"
- DON'T plan to modify files that don't need changes

Principle: Minimal changes for maximum effect + ACTUAL file paths from the project
</step_2_create_focused_plan>

<step_3_define_success>
Q6: How will I verify this is done correctly?
- Functional criteria (what should work?)
- Format criteria (any output format rules?)
- Completeness criteria (imports, types, etc.)
</step_3_define_success>

REQUIRED OUTPUT FORMAT:

Use <thinking> tags for your analysis:

<thinking>
**Primary Task:** [What is the main objective?]

**Context Understanding:**
- [Key points from inputs]

**Execution Plan:**
1. [Specific action 1]
2. [Specific action 2]
...

**Success Criteria:**
- [How to verify correctness]

**Files to Create/Modify:**
- [actual/file/path.tsx]: [what changes]
- [actual/file/path2.tsx]: [what changes]

CRITICAL: Use ACTUAL file paths from ORIGINAL FILES or DESIGN DOCUMENT.
NEVER use placeholder paths like "path/to/file.tsx".
</thinking>

Then provide a brief summary in plain text:
[Your execution plan summary - max 5-7 sentences explaining what you will implement and how]

⚠️  CRITICAL REMINDER:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 DO NOT OUTPUT ANY CODE OR FILE CONTENT IN THIS PHASE!

Your response should ONLY contain:
✅ <thinking> section (analysis and plan)
✅ Plain text summary after thinking

❌ DO NOT include:
- <file path="...">...</file> blocks
- Any actual code implementation
- Code syntax or file content
- Configuration file contents
- Component implementations

The IMPLEMENTATION phase will handle actual code generation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

