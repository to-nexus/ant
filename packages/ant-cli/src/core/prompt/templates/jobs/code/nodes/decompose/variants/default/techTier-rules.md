## TechTier Detection Rules

### Explicit Basis (Authoritative)

For each slot in `resolvedAction.basis.techTier` — `stack`, `frontend.{language,framework,packageManager,gameEngine}`, `backend.{language,framework,packageManager,gameEngine}`:

- If the slot is present in `resolvedAction.basis.techTier`, that value is EXPLICIT — emit it verbatim. Do not reinterpret or substitute.
- The explicit basis overrides any conflicting signal in design documents, PRD, refs, or context. When an explicit basis is set, treat document statements about technology as descriptive context — not as an authoritative override.
- INFER a slot only when it is absent from `resolvedAction.basis.techTier`.

{{#if resolvedAction.basis.techTier.stack}}
Explicit `stack`: {{resolvedAction.basis.techTier.stack}}
{{/if}}
{{#if resolvedAction.basis.techTier.frontend.language}}
Explicit `frontend.language`: {{resolvedAction.basis.techTier.frontend.language}}
{{/if}}
{{#if resolvedAction.basis.techTier.frontend.framework}}
Explicit `frontend.framework`: {{resolvedAction.basis.techTier.frontend.framework}}
{{/if}}
{{#if resolvedAction.basis.techTier.frontend.packageManager}}
Explicit `frontend.packageManager`: {{resolvedAction.basis.techTier.frontend.packageManager}}
{{/if}}
{{#if resolvedAction.basis.techTier.frontend.gameEngine}}
Explicit `frontend.gameEngine`: {{resolvedAction.basis.techTier.frontend.gameEngine}}
{{/if}}
{{#if resolvedAction.basis.techTier.backend.language}}
Explicit `backend.language`: {{resolvedAction.basis.techTier.backend.language}}
{{/if}}
{{#if resolvedAction.basis.techTier.backend.framework}}
Explicit `backend.framework`: {{resolvedAction.basis.techTier.backend.framework}}
{{/if}}
{{#if resolvedAction.basis.techTier.backend.packageManager}}
Explicit `backend.packageManager`: {{resolvedAction.basis.techTier.backend.packageManager}}
{{/if}}
{{#if resolvedAction.basis.techTier.backend.gameEngine}}
Explicit `backend.gameEngine`: {{resolvedAction.basis.techTier.backend.gameEngine}}
{{/if}}

### Stack (Tier Scope)

**Principle**: Document names follow a tier prefix convention (`fe-` = frontend, `be-` = backend).
Observe the prefix to determine which tier(s) are in scope, regardless of specific
package or service names that follow.

**Observation Priority:**

1. If `resolvedAction.basis.techTier.stack` is present, that is the final answer (EXPLICIT — see above).
2. If the directive explicitly specifies the stack scope, that is the final answer.
3. If design documents exist, observe the **Design Document Availability** section.
   The categories of documents that are present define the current work scope.
   Do NOT assume a missing category means "not yet created" — absence signals that tier is outside scope.
4. PRD describes the overall project and may cover a broader scope than the current workspace.
   Do NOT infer stack from PRD alone when design documents are present.

**Constraint — MANDATORY CHECK before setting stack:**

Observe the Design Document Availability section directly:

- If ANY document with `be-` prefix is present AND NO document with `fe-` prefix is present → **backend**
- If ANY document with `fe-` prefix is present AND NO document with `be-` prefix is present → **frontend**
- If both prefixes are present → **fullstack**
- If ONLY `system-design (unified)` is present with no tier-prefixed documents → observe directive and PRD
- If no design documents at all → observe directive and PRD

This check is FINAL when tier-prefixed documents exist. Do NOT override with PRD inference.

⚠️ **Blind Spot**: A PRD may describe multiple tiers, but if the corresponding design document
for a tier is absent in this workspace, that tier is out of scope for this job.

### Language & Framework

**Principle**: The technology stack is determined by the design documents that are in scope.

**Observation Priority:**

1. If `resolvedAction.basis.techTier.<tier>.<field>` is present for a slot
   (`language` / `framework` / `packageManager` / `gameEngine`), that value is
   EXPLICIT — emit it verbatim and skip inference for that slot. Document
   statements that contradict an explicit field are treated as descriptive
   context for the implementation, not as a re-interpretation signal.
2. Observe the **design document content** (in the specification).
   The technology stack is typically stated in the document (language, runtime, framework).
3. If tier-prefixed documents (`fe-` or `be-`) exist, the techTier language and framework
   MUST reflect the technology stack of the tier(s) that HAVE documents — not any other
   tier mentioned in the PRD.
4. If ONLY `system-design (unified)` exists with no tier-prefixed documents,
   determine the techTier from the document content, directive, and PRD.

**Constraint**: If the Design Document Availability shows ONLY documents with `be-` prefix,
the techTier MUST reflect the backend's language and framework.
Do NOT set language/framework based on technologies that appear only in the PRD
for a tier whose design document is absent.

**Constraint**: If the Design Document Availability shows ONLY documents with `fe-` prefix,
the techTier MUST reflect the frontend's language and framework.

⚠️ **Blind Spot**: PRD often describes the full platform (frontend + backend + mobile).
If no document with `fe-` prefix exists, frontend technologies in the PRD are irrelevant
to the current techTier. The same applies in reverse.

**Default**: If NO design documents exist AND the language cannot be determined from
the directive or specification content alone, default to `"typescript"`.
This default applies ONLY when all design documents are absent.

**Framework**: If no framework is mentioned or implied, set `framework: null`.

### packageTiers (Fullstack / Monorepo)

**Principle**: When `stack` is `"fullstack"` and packages use different languages or frameworks,
provide a `packageTiers` map so each task inherits the correct technology context.

**Observation**: Each key is a package tag matching the `fe-*` / `be-*` naming convention
used in design documents and task packages.

**Constraint**: Do NOT include `packageTiers` when all packages share the same language and framework.

**Constraint (explicit alignment)**: If `resolvedAction.basis.techTier.<tier>.framework`
or `.language` is set, every `packageTiers` entry whose `stack` matches that tier MUST
emit the same `framework` / `language`. Use `packageTiers` only to encode per-package
divergence on slots the explicit basis does not pin.
