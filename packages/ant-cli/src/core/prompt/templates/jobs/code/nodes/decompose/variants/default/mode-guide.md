{{#if mode}}
════════════════════════════════════════════════════════════════════════════════
🎯 WORK MODE: {{mode}}
════════════════════════════════════════════════════════════════════════════════

**Modes and task types are orthogonal axes.** This file owns mode semantics only. The task `type` enum is owned by the Task Schema in the decompose rules. The only overlap is `explain` — both a mode AND a task type by design; `generate` is mode-only and MUST NOT appear as a `type` value.

{{#if (eq mode "explain")}}
**EXPLAIN MODE - Chat-Only Explanation**

🚨 **CRITICAL: This is an EXPLANATION, NOT a code change!**

The deliverable is prose in chat — NO files are created, modified, or deleted. Read-only observation grounds the answer; feature / fix tasks are not emitted. Tier selection and task shape follow the matrix in the rules.

{{else}}
{{#if (eq mode "generate")}}
**GENERATE MODE - Producing or Modifying Code**

You are realizing the directive/specification in code. Whether that means new
files or changes to existing ones is decided by workspace presence (see the
existing-codebase section), not by the mode.

{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{/if}}
