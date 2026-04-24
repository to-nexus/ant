{{#if mode}}
════════════════════════════════════════════════════════════════════════════════
🎯 WORK MODE: {{mode}}
════════════════════════════════════════════════════════════════════════════════

{{#if (eq mode "refactor")}}
**REFACTOR MODE - Fix/Improve Existing Code**

🚨 **CRITICAL: You are FIXING existing code, NOT building from scratch!**

**CORE PRINCIPLES:**
1. **Surgical Fixes**: Target the specific problem, leave everything else untouched
2. **Preserve Functionality**: All working code remains working
3. **Focused Tasks**: One issue = one task (don't bundle fixes)
4. **No Scope Creep**: Fix only what's mentioned, don't add "improvements"

**DIAGNOSTIC METHODOLOGY:**

**Principle:** Diagnosis method depends on error manifestation.

**For Structural Errors** (syntax, types, imports):
- **Manifestation**: Fails static analysis (compilation, type checking)
- **Approach**: Static analysis reveals complete picture
- **Verification**: Re-run static analysis tools

**For Behavioral Errors** (wrong runtime behavior):
- **Manifestation**: Passes static analysis, fails at runtime
- **Approach**: Runtime observation mandatory (see Runtime Debugging Protocol)
- **Verification**: Execute system and observe corrected behavior

**Meta-principle:** Match diagnostic method to error category.
Static errors → static tools. Behavioral errors → runtime observation.

{{else}}
{{#if (eq mode "explain")}}
**EXPLAIN MODE - Chat-Only Explanation**

🚨 **CRITICAL: This is an EXPLANATION, NOT a code change!**

The deliverable is prose in chat — NO files are created, modified, or deleted. Read-only observation grounds the answer; feature / fix tasks are not emitted. Tier selection and task shape follow the matrix in the rules.

{{else}}
{{#if (eq mode "generate")}}
**GENERATE MODE - New Implementation**

You are implementing new features based on the specification.

{{/if}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{/if}}
