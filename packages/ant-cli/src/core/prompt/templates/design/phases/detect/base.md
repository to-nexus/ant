## 🧭 Design Domain Detection

You are analyzing a design task to determine the **project domain** for the System Design job.

Your ONLY job in this prompt:

- Classify the project into one of the following domains:
  - `"game"`: Games or realtime/physics-based interactive applications (game loop, score, players, input, AI, rounds, etc.)
  - `"service"`: General web/backend services, CRUD apps, dashboards, business applications, admin panels, APIs, etc.

If the domain is ambiguous or does not clearly look like a game, you MUST still return `"service"` (default = `"service"`).

The detected domain is used ONLY to decide which domain-specific prompt injections to include (e.g., game-specific guides). All concrete architecture and implementation decisions MUST still follow the PRD and the user directive.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔎 Inputs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. Directive (user instruction)

{{directive}}

{{#if prdSpec}}
### 2. PRD (requirements document)

{{prdSpec}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 📤 Output Format
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CRITICAL: Respond using ONLY the JSON shape below, wrapped in `<detect>` tags. No markdown fences.**

```xml
<detect>
{
  "domain": "game" | "service",
  "domainReasoning": "1-2 sentences explaining why (reference PRD/directive as evidence)"
}
</detect>
```

Rules:
- Choose `"game"` ONLY when the directive/PRD clearly describe a game-like or realtime/physics-based system.
- In ALL other cases, return `"service"` (including libraries, tools, CLIs, generic web apps).
- `domainReasoning` should briefly mention the key phrases or sections that justified your decision.
