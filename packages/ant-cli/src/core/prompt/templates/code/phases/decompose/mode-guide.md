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

{{else}}
{{#if (eq mode "explain")}}
**EXPLAIN MODE - Minimal Bug Fix**

🚨 **CRITICAL: This is a BUG FIX, not a feature implementation!**

{{else}}
{{#if (eq mode "generate")}}
**GENERATE MODE - New Implementation**

**CREATION MODE: Build from scratch**

You are implementing new features based on the specification.

{{/if}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{/if}}
