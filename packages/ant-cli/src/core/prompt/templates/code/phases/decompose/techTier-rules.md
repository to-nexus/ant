## TechTier Detection Rules

### Stack (Tier Scope)

**Principle**: Document names follow a tier prefix convention (`fe-` = frontend, `be-` = backend).
Observe the prefix to determine which tier(s) are in scope, regardless of specific
package or service names that follow.

**Observation Priority:**

1. If the directive explicitly specifies the stack scope, that is the final answer.
2. If design documents exist, observe the **Design Document Availability** section.
   The categories of documents that are present define the current work scope.
   Do NOT assume a missing category means "not yet created" — absence signals that tier is outside scope.
3. PRD describes the overall project and may cover a broader scope than the current workspace.
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

1. Observe the **design document content** (in the specification).
   The technology stack is typically stated in the document (language, runtime, framework).
2. If tier-prefixed documents (`fe-` or `be-`) exist, the techTier language and framework
   MUST reflect the technology stack of the tier(s) that HAVE documents — not any other
   tier mentioned in the PRD.
3. If ONLY `system-design (unified)` exists with no tier-prefixed documents,
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
