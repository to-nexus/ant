## ANT Works: Spec-to-Branch Pipeline

### One-line
ANT Works turns specs into feature-scoped branches and runs a repeatable workflow from design to implementation and preview.

### Definition
- **Spec**: PRD, directives, and reference materials (including UI screenshots when available).
- **Branch**: an operational unit of work that a team can review, preview, merge, roll back, and trace.
- **Pipeline**: a standardized flow that converts spec into a verifiable result (preview/buildable state).

---

## Summary

### Category
- Idea-to-Prototype: conversational, fast iteration, prototype-oriented.
- Spec-to-Branch Pipeline (ANT): spec-driven, team-operable change units, preview-oriented operations.

### Core Value
- Produces branch-scoped work units suitable for parallel development and review.
- Runs feature-scoped preview/dev operations.
- Supports job/node-aware model routing for step-level optimization (cost/latency/quality).

---

## Problem

### What Actually Slows Teams Down
- Turning specs into scoped work units and architectural boundaries.
- Operating changes as team units (review/merge/rollback) rather than ad-hoc file outputs.
- Running isolated previews per feature to enable parallel delivery.

---

## Category Framing

### Idea-to-Prototype
- Produces a working prototype quickly from conversational input.
- Optimized for rapid iteration and exploration.

### Spec-to-Branch Pipeline (ANT)
- Uses explicit specifications as the primary input.
- Outputs feature-scoped work units (branches) designed for team operations.
- Optimized for parallel work, review, preview, merge, and continuation by human developers.

---

## Branch in Development Operations

### Meaning
- Branch is not the Git feature itself.
- Branch is the operational unit for a scoped change package.
- Git branch is the mechanism used to represent that unit.

### Why It Matters
- Parallel development without blocking on a shared base.
- Risk isolation from the base branch.
- Reviewability and traceability of changes.
- Controlled integration via merge and rollback.

### What ANT Implements (Observable Behaviors)
- Feature creation can switch/create a feature branch.
- Branch naming is standardized (`feature/{featureName}`) with sanitization.
- Base branch is configurable (`branchBase`).
- Upstream/remote handling exists for branch switching and synchronization.

---

## Pipeline in Development Operations

### Meaning
Pipeline is the repeatable operational flow that converts spec into a verifiable outcome.

### Why It Matters
- Reduced lead time from spec to verifiable output.
- Reduced variance across developers and projects through standard steps.
- Enables consistent artifacts and quality gates.

### What ANT Implements (Observable Behaviors)
- Jobs executed per feature workspace (design/code/learn).
- Feature-level workspace paths and job-level state persistence.
- Dev server management supports multi-package projects with proxy access.

---

## Design as a First-Class Constraint

### Claim
ANT aims to generate code that is continuable by a development team, not only visually correct output.

### Evidence Signals in Generated Codebases
- Layered boundaries (domain/application/infrastructure/presentation patterns).
- Shared contracts and typed DTO structures in fullstack setups.
- Strict TypeScript configs and lint/typecheck scripts in generated projects.
- Tests exist in parts of generated codebases.

---

## Supported Work Modes

### New Project Bootstrapping
- Creates a runnable codebase scaffold aligned with the spec.
- Sets up scripts for dev/build/typecheck/lint depending on stack.

### Existing Project Work
- Feature additions within an existing codebase.
- Refactoring under existing constraints.
- Design/code jobs operate with codebase context (retrieval/semantic search).

---

## Preview and Dev Environment

### Feature-scoped Preview
- Dev server proxy keys include feature scope (`tenant:user:project:feature`).
- Feature previews can run independently per feature.

### IDE Scope
- IDE proxy is project-scoped and opens the project codebase.
- Branch selection determines what the IDE shows for that project.

---

## Task-Aware Model Routing (Job/Node Optimization)

### Concept
Different workflow steps have different optimal model requirements (cost/latency/quality).

### Implementation
- Model selection supports job type (`design`, `code`, `learn`) and node type (e.g., `decompose`, `plan`, `docGen`, `codeGen`, `validate`).
- Resolution priority:
  1. job+node specific model
  2. job default model
  3. environment default
  4. hardcoded fallback

---

## Developer Time Reallocation

### Claim
Agents execute long-running steps while developers focus on decisions, review, and prioritization.

---

## Proof / Traction (Early, Fact-based)

### Validation So Far
- Verified generated codebases across different project types:
  - frontend consuming external APIs
  - fullstack monorepo (frontend + backend)
  - screenshot-driven landing/SSR with spec adherence

### Observed Outcome Signals
- Generated projects include runnable scripts and typecheck/lint setup.
- Architectural boundaries and typed contracts appear in outputs.
- Feature work can be operated as branch-scoped units.

---

## ICP / Buyer

### ICP
- Teams with explicit specs (PRDs/design references) and repeated feature delivery.
- Teams operating via PR review and feature branches where previews matter.
- Organizations where standardization and onboarding cost is a recurring issue.

### Buyer
Engineering/Platform/DevEx leadership.

---

## Business Model (Hypothesis)

### Pricing Unit
Seats (team) + usage (job execution / resources).

### Packaging Direction
- cloud standard offering
- enterprise offering (private deployment, governance, compliance)

---

## Risks and Evaluation Questions

### Output Quality Variance
- Question: does the generated change pass team review without heavy rewrite?
- Measure: review iteration count, regression rate, hotfix frequency.

### Cost Structure
- Question: can execution cost be controlled per job/node and per workflow?
- Measure: runtime and model cost per completed work unit, rerun rate.

### Adoption
- Question: can teams integrate ANT workflow into existing Git-based operations?
- Measure: onboarding time, repeated usage rate, time-to-preview for new features.

---

## Roadmap

### Q1: Nexus Internal Rollout
- Roll out to all Nexus internal development teams.
- Standardize the operating workflow.

### Q2: Cloud Service Beta
- Launch cloud service beta for external developer teams.
- Validate pricing, quotas, and multi-tenant operations.

### Q3: Cloud Service Production Launch
- Launch cloud service production.
- Decide packaging strategy:
  - cloud standard offering
  - enterprise offering (private deployment, governance, compliance)

