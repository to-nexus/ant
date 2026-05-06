# PRD Evaluation Rubric

> Rubric for evaluating the quality of externally authored PRDs (`plan/prd.md`) in the Ant CLI pipeline.

## Table of Contents

1. [Overview](#1-overview)
2. [PRD Role in the Ant Pipeline](#2-prd-role-in-the-ant-pipeline)
3. [Evaluation Categories](#3-evaluation-categories)
4. [Evaluation Checklist](#4-evaluation-checklist)
5. [Scoring Guide](#5-scoring-guide)
6. [Report Template](#6-report-template)
7. [Usage](#7-usage)

---

## 1. Overview

### Purpose

- Evaluate whether an externally authored PRD contains sufficient information for the Ant pipeline to produce correct outputs.
- The central question: **"Can the Design Job auto-generate a correct System Design from this PRD alone?"**
- Identify gaps that would force the Design Job or Code Job to make assumptions.

### PRD Definition

**PRD (Product Requirements Document)** is the **Source of Truth** for all design and implementation decisions in Ant CLI.

**Location**: `plan/prd.md`

**Core Principles**:
- **"PRD = ABSOLUTE TRUTH"** — final authority for all design and implementation decisions.
- What is not specified in the PRD must not be invented.
- When conflicts arise: PRD > directive > other documents.

### PRD vs System Design — Responsibility Boundary

The Ant pipeline auto-generates System Design from PRD. This creates a clear responsibility split:

| Responsibility | PRD (WHAT) | System Design (HOW) |
|---------------|------------|---------------------|
| Product goals, non-goals | Required | — |
| Functional requirements (behavior, conditions, outcomes) | Required | — |
| Non-functional requirements (performance, security, a11y) | Required | — |
| User scenarios / flows | Required | — |
| UI content (text, links, data) | Required | — |
| Business constraints | Required | — |
| Tech stack | **Optional** | Auto-determined |
| Architecture patterns | Not expected | Auto-generated |
| API contracts | Not expected | Auto-generated |
| Data models | Not expected | Auto-generated |

**Tech stack in PRD — optional with accuracy requirement:**
- **Absent**: No penalty. The Design Job auto-selects appropriate technology.
- **Present and accurate**: No penalty. Treated as an intentional engineering preference.
- **Present but inaccurate**: Penalized. Version conflicts, non-existent libraries, or internal contradictions degrade downstream output.

### Scope

- **Input**: PRD document (`plan/prd.md`)
- **Output impact**:
  - Design Job → `ui-spec.json`, `ui-tokens.json`, `ui-assets.json`, system design documents
  - Code Job → source code
- **Evaluation target**: PRD content sufficiency for correct downstream auto-generation
- **Evaluation output**: `meta/evals/prd/evalprd-{timestamp}.md`

### Workspace Structure

```
ant-workspaces/{org}/{group}/{project}/
└── features/{feature}/
    ├── plan/
    │   └── prd.md                     # PRD document ★
    ├── architecture/
    │   ├── system/                    # Auto-generated from PRD
    │   │   ├── fe-system-*.md
    │   │   ├── be-system-*.md
    │   │   └── api-contract-*.md
    │   └── spec/
    ├── visual/
    │   └── ui/ant/                    # Auto-generated from PRD
    │       ├── ui-spec.json
    │       ├── ui-tokens.json
    │       └── ui-assets.json
    ├── meta/
    │   └── evals/
    │       └── prd/
    │           └── evalprd-{timestamp}.md
    └── sessions/
```

---

## 2. PRD Role in the Ant Pipeline

### 2.1 Data Flow

```
External Author
    ↓ writes
plan/prd.md (PRD)
    ↓ read by ArtifactService
Design Job
    ├─ detect: determines domain/environment from PRD alone
    ├─ decompose: breaks down into system design tasks based on PRD
    └─ docGen: generates system design treating PRD as "ABSOLUTE TRUTH"
        └─► architecture/system/, architecture/spec/, visual/ui/ (system design, UI design documents)
            ↓
Code Job (consumes PRD + system design simultaneously)
    ├─ detect: uses PRD + directive only (no system design)
    ├─ decompose: plans implementation tasks
    └─ execute: generates code from prdSpec + designDoc + directive
```

### 2.2 What Each Pipeline Stage Needs from PRD

| Stage | What it reads from PRD | Why it matters |
|-------|----------------------|----------------|
| **detect** | Domain hints, platform signals | Determines frontend/backend/fullstack routing |
| **System Design generation** | Functional requirements, business constraints, NFRs | Produces architecture, API contracts, domain models |
| **UI Design generation** | Visual intent, interaction requirements, content | Produces UI specs, tokens, assets |
| **Code decompose** | Scope, feature boundaries | Plans implementation tasks |
| **Code execute** | Exact requirements (PRD injected alongside design to prevent information loss) | Ensures implementation matches intent |

### 2.3 Screenshot vs PRD Roles

| Source | Role | Content |
|--------|------|---------|
| **Screenshots** | HOW it looks | Layout, colors, typography, visual structure |
| **PRD** | WHAT it does | Text content, functional requirements, interactions, constraints |

### 2.4 Intent Extraction Principle

PRD authors often use implementation-specific language. The system extracts **intent**, not literal instructions:

```
❌ Literal: "Use browser storage"
✅ Intent: "Client-side persistence required"

❌ Literal: "Save bookmarks to LocalStorage"
✅ Intent: "Bookmarks must persist locally"
```

---

## 3. Evaluation Categories

PRD is evaluated across **6 categories**, weighted by impact on downstream auto-generation quality.

### 3.1 Specification Depth (35 points)

**"Are functional requirements described at specification level, not just title level?"**

This is the highest-weighted category because under-specified requirements are the primary cause of incorrect auto-generation. A title-only FR forces the Design Job to guess.

**The Implementability Test:**
> Read this FR alone. Can the Design Job produce a correct system design component from it?
> Specifically: Are **behavior** (what happens), **condition** (when/how it triggers), and **outcome** (expected result) stated?

**"Title" vs "Specification" distinction:**

| Level | Example | Verdict |
|-------|---------|---------|
| Title only | "Product management" | Unusable — what CRUD? what fields? what states? |
| One-line summary | "Admin can create/edit/delete products" | Insufficient — fields, validation, state transitions unknown |
| Specification | "Admin creates product: name (required, max 100 chars), price (required, >= 0), description (optional, max 1000 chars), images (max 5). Created in 'pending_review' state. Transitions to 'active' on admin approval." | Design Job can derive domain model, API, state machine |

**Depth cap rule:**
- If >= 80% of FRs are title-only → this category is capped at 7 points.
- If >= 50% of FRs are title-only → this category is capped at 14 points.

**Signals of shallow specification:**
- FR has no sub-items, conditions, or field definitions.
- FR uses only a verb + noun ("manage products", "handle payments").
- Reading the FR raises more questions than it answers.
- "TBD", "TODO", "to be determined" markers.

### 3.2 Clarity (20 points)

**"Are requirements free from ambiguity AND information gaps?"**

This category covers TWO types of unclarity:

**Type 1 — Ambiguous language** (traditional):
- Vague qualifiers: "fast", "appropriate", "if needed", "as necessary"
- Unquantified metrics: "high performance", "good UX"
- Conditional requirements with unclear conditions: "show X depending on the situation"

**Type 2 — Under-specification** (often missed):
- No ambiguous words present, but insufficient information for implementation.
- Example: "Shopping cart feature" — no ambiguous word, but what does it do?
- Example: "SKU, name, description, price" — clear words, but validation rules? required/optional? character limits?

**Terminology consistency:**
- Same concept must use the same term throughout (e.g., "user" vs "customer" — pick one).
- Technical terms must be used correctly.

**Signals of unclarity:**
- "appropriately", "properly", "if needed", "as necessary", "etc."
- Quantifiable properties stated qualitatively ("fast loading" instead of "< 3s")
- Same concept referred to by multiple terms
- FR that is grammatically clear but leaves the reader with unanswered implementation questions

### 3.3 Scope Definition (15 points)

**"Is the project boundary clearly drawn — what is in, what is out, and what quality bar applies?"**

**Required elements:**
- **Goals**: What the project aims to achieve (measurable when possible).
- **Non-goals**: What is explicitly excluded from this iteration. Absence of non-goals is a deficiency — it forces the Design Job to guess boundaries.
- **User scenarios**: At least one primary user flow described end-to-end.
- **Non-functional requirements (NFRs)**: Performance targets, security requirements, accessibility standards — stated quantitatively where possible.
- **Business constraints**: Regulatory requirements, timeline constraints, budget limitations, partner/vendor restrictions.

**Signals of weak scope:**
- No non-goals section (everything could be in scope).
- NFRs stated qualitatively ("should be fast") or absent entirely.
- No user scenario — only a feature list with no flow connecting them.
- Goals stated as activities ("build a dashboard") rather than outcomes ("enable managers to track KPIs in real-time").

### 3.4 Content Fidelity (20 points)

**"Is every piece of user-facing content explicitly provided?"**

**Evaluation targets:**
- All UI text: headings, button labels, placeholder text, empty states, error messages, success messages, tooltips.
- All external URLs: social media links, documentation links, partner links — exact URLs, not placeholders.
- Data definitions: field names, types, validation rules, display formats.
- Tone/voice guidance (when applicable).

**Signals of content gaps:**
- "Display appropriate message" (actual message text missing)
- "Social links" (URLs missing)
- "Show error" (error message text missing)
- "Contact information" (actual email/phone/address missing)
- "Logo" (no file path or asset reference)

### 3.5 Structure (7 points)

**"Is information organized for efficient consumption by both humans and the pipeline?"**

**Evaluation targets:**
- Logical section hierarchy with clear headings.
- Related information grouped together (not scattered across sections).
- Numbered sections or IDs that enable cross-reference (e.g., "per §3.2", "see FR-05").
- Appropriate use of tables, lists, and formatting.
- File references (Figma URLs, handoff bundle paths, assets) with correct paths.

**Signals of poor structure:**
- All content in flat prose with no section headings.
- Related information scattered across unrelated sections.
- Broken file paths or dead references.
- No numbering system — impossible to reference specific requirements.

### 3.6 Constraints (3 points)

**"Are business and technical boundaries explicitly declared?"**

**Business constraints (primary — always evaluated):**
- Platform/environment requirements (e.g., "mobile-first", "static hosting only")
- External service restrictions (e.g., "X API excluded due to CORS")
- Exclusion items with reasoning
- Regulatory or compliance requirements

**Tech stack (secondary — evaluated only when present):**
- If tech stack is **absent**: No penalty. The Design Job auto-determines technology.
- If tech stack is **present**: Verify accuracy:
  - [ ] Named libraries/frameworks actually exist?
  - [ ] Versions are mutually compatible? (e.g., React 18 + Next.js 14 ✅, React 16 + Next.js 14 ❌)
  - [ ] No internal contradictions? (e.g., "Use Tailwind v3" + references to v4-only features)
  - Inaccuracies found → deduct from this category AND flag in Clarity.

**Signals of constraint gaps:**
- No exclusions or non-goals for technology choices.
- Tech stack present but versions missing or contradictory.
- External service names mentioned without specifics (endpoint, documentation link).

---

## 4. Evaluation Checklist

### 4.1 Required Sections Check

| Section | Required | Check |
|---------|----------|-------|
| **One-line summary** | Required | Project described in 1-2 sentences |
| **Goals / Non-goals** | Required | Both goals AND non-goals explicitly stated |
| **User scenarios** | Required | At least one primary user flow end-to-end |
| **Requirements (Functional)** | Required | All features listed with behavior/condition/outcome |
| **Non-functional requirements** | Required | Performance, security, accessibility with quantitative targets |
| **Content (Text/Data)** | Required | All user-facing text, links, data |
| **Tech stack** | Optional | No penalty if absent. If present, must be accurate |
| **Constraints / Risks** | Recommended | Known constraints, risk factors |
| **Asset mapping** | Conditional | Source→destination mapping when assets exist |
| **UI specification** | Conditional | Interaction specs not expressible via screenshots |

### 4.2 Specification Depth Check

**For each functional requirement, verify:**
- [ ] Behavior is described (what the system does, not just a feature name)
- [ ] Trigger conditions are stated (when/how the behavior activates)
- [ ] Expected outcome is defined (what happens as a result)
- [ ] Edge cases or error conditions are addressed (at least the obvious ones)
- [ ] Percentage of title-only FRs is below 50%

**Depth levels for classification:**

| Depth | Criteria | Score impact |
|-------|----------|-------------|
| **Full spec** | Behavior + condition + outcome + edge cases | Full credit |
| **Partial spec** | Behavior + outcome, but missing conditions or edge cases | Partial credit |
| **One-liner** | Single sentence describing intent, no details | Minimal credit |
| **Title only** | Feature name or verb+noun phrase only | Subject to depth cap |

### 4.3 Content Quality Check

**Text/Copy:**
- [ ] All heading/button text explicitly provided (not "appropriate text")?
- [ ] Error messages, notifications, tooltips included?
- [ ] Empty state messages specified?

**Links/URLs:**
- [ ] All external links provided as exact URLs?
- [ ] Email addresses in `mailto:` format?
- [ ] Social media links as actual account URLs?

**Data:**
- [ ] Form fields with validation rules specified?
- [ ] Data sources (API endpoints, external services) named specifically?
- [ ] Display formats defined (dates, numbers, currency)?

### 4.4 Clarity Check

**Ambiguous language scan:**
- [ ] No instances of: "appropriately", "properly", "if needed", "as necessary", "etc.", "and so on"
- [ ] All quantifiable properties stated as numbers (e.g., "< 3 seconds", not "fast")
- [ ] All conditional requirements have explicit conditions

**Under-specification scan:**
- [ ] Each FR answers "what happens?" not just "what exists?"
- [ ] Field definitions include constraints (required/optional, length, format)
- [ ] State transitions are explicit (not implied)

**Terminology consistency:**
- [ ] Same concept uses same term throughout
- [ ] Technical terms used correctly

### 4.5 Tech Stack Accuracy Check (only when tech stack is present)

- [ ] All named libraries/frameworks exist and are current?
- [ ] Version numbers are mutually compatible?
- [ ] No contradictions between stated stack and described behavior?
- [ ] Platform constraints consistent with chosen stack?

### 4.6 Reference Files Check

**Visual sources:**
- [ ] If Figma is used, `visual/ui/figma/figma.json` is configured with the file URL?
- [ ] If a free-form handoff bundle exists (`visual/ui/handoff/`), each file's purpose is explained?

**Assets:**
- [ ] Asset source paths specified? (`assets/`)
- [ ] Asset destination paths specified? (e.g., `public/images/`)
- [ ] Asset purpose described? (logo, icon, background, etc.)

---

## 5. Scoring Guide

### 5.1 Grade Scale

| Grade | Range | Description |
|-------|-------|-------------|
| **S (Excellent)** | 95-100 | All requirements at spec level, complete content, clear scope. Design Job needs zero assumptions. |
| **A (Good)** | 85-94 | Most requirements at spec level, minor content gaps. Design Job needs minimal assumptions. |
| **B (Acceptable)** | 70-84 | Core requirements specified but gaps exist. Design Job needs some assumptions. |
| **C (Insufficient)** | 50-69 | Significant specification gaps. Design Job must make many assumptions. |
| **D (Poor)** | 0-49 | Fundamental rewrite required. Design Job cannot produce reliable output. |

### 5.2 Category Weights

| Category | Points | Core question |
|----------|--------|--------------|
| **Specification Depth** | 35 | Are FRs at "specification" level, not "title" level? |
| **Clarity** | 20 | Free from ambiguity AND information gaps? |
| **Content Fidelity** | 20 | All user-facing content explicitly provided? |
| **Scope Definition** | 15 | Goals, non-goals, user scenarios, NFRs, business constraints? |
| **Structure** | 7 | Organized for efficient human and pipeline consumption? |
| **Constraints** | 3 | Business boundaries declared? Tech stack accurate if present? |
| **Total** | 100 | |

### 5.3 Category Scoring Anchors

#### Specification Depth (35 points)

| Score | Criteria |
|-------|----------|
| **35** | 100% of FRs include behavior, conditions, and outcomes. Zero TBD markers. |
| **28** | >= 80% of FRs at spec level. Remaining FRs have partial specs (missing conditions or edge cases). |
| **21** | 50-80% of FRs at spec level. Rest are one-liners or titles. |
| **14** | 30-50% of FRs at spec level. Majority are titles or one-liners. **Depth cap applies if >= 50% title-only.** |
| **7** | < 30% of FRs at spec level. Almost all are title-only. **Depth cap applies (>= 80% title-only).** |
| **0-6** | No FRs have meaningful specification. Feature list is just a bullet list of names. |

#### Clarity (20 points)

| Score | Criteria |
|-------|----------|
| **20** | Zero ambiguous expressions. Zero under-specified requirements. 100% terminology consistency. |
| **16** | 1-2 ambiguous expressions OR 1-3 under-specified items. Terminology consistent. |
| **12** | 3-5 ambiguous expressions OR 4-7 under-specified items. Minor terminology inconsistencies. |
| **8** | 6-10 ambiguous expressions OR 8-15 under-specified items. Multiple terminology issues. |
| **4** | > 10 ambiguous expressions OR > 15 under-specified items. Pervasive unclarity. |
| **0-3** | Document is fundamentally ambiguous or information-starved. |

#### Scope Definition (15 points)

| Score | Criteria |
|-------|----------|
| **15** | Goals measurable. Non-goals explicit. >= 1 user scenario end-to-end. NFRs quantitative. Business constraints stated. |
| **12** | Goals clear. Non-goals present. User scenario exists but incomplete. NFRs present but some qualitative. |
| **9** | Goals stated. Non-goals missing. NFRs partially present. No user scenario. |
| **6** | Goals only. No non-goals, no NFRs, no user scenarios. |
| **0-5** | Scope itself is unclear. Cannot determine what the project aims to achieve. |

#### Content Fidelity (20 points)

| Score | Criteria |
|-------|----------|
| **20** | 100% of UI text, links, and data provided as actual values. |
| **16** | >= 90% provided. Missing items are minor (e.g., one tooltip text). |
| **12** | 70-90% provided. Some important content missing (e.g., error messages). |
| **8** | 50-70% provided. Significant content gaps. |
| **4** | < 50% provided. Placeholder language dominant ("appropriate text", "relevant link"). |
| **0-3** | Virtually no actual content — only feature descriptions with no text/data. |

#### Structure (7 points)

| Score | Criteria |
|-------|----------|
| **7** | Logical hierarchy. Numbered sections/IDs. Cross-references possible. Clean formatting. |
| **5** | Section structure exists. Some numbering. Minor organizational issues. |
| **3** | Structure present but confusing. Related info scattered. |
| **1-2** | Minimal structure. Mostly flat prose. |
| **0** | No structure. Stream-of-consciousness text. |

#### Constraints (3 points)

| Score | Criteria |
|-------|----------|
| **3** | Business constraints explicit. Tech stack absent OR present and fully accurate. |
| **2** | Business constraints partially stated. Tech stack (if present) has minor issues (e.g., missing versions). |
| **1** | Business constraints weak. OR tech stack present with clear errors (incompatible versions, non-existent libraries). |
| **0** | No constraints stated. OR tech stack present with critical contradictions. |

---

## 6. Report Template

```markdown
# PRD Evaluation Report

**Date**: YYYY-MM-DD
**Project**: {org}/{group}/{project}
**Feature**: {feature-name}

---

## 1. Summary Score

| Category | Score | Notes |
|----------|-------|-------|
| Specification Depth | X / 35 | |
| Clarity | X / 20 | |
| Content Fidelity | X / 20 | |
| Scope Definition | X / 15 | |
| Structure | X / 7 | |
| Constraints | X / 3 | |
| **Total** | **X / 100** | **Grade: S/A/B/C/D** |

---

## 2. Required Sections Check

| Section | Present | Depth | Notes |
|---------|---------|-------|-------|
| One-line summary | Yes/No | — | |
| Goals / Non-goals | Yes/No | High/Med/Low | |
| User scenarios | Yes/No | High/Med/Low | |
| Requirements (Functional) | Yes/No | High/Med/Low | |
| Non-functional requirements | Yes/No | High/Med/Low | |
| Content (Text/Data) | Yes/No | High/Med/Low | |
| Tech stack | Yes/No/N/A | Accurate/Inaccurate | Optional — no penalty if absent |

---

## 3. Key Findings

### 3.1 Strengths
- [specific strength with evidence]

### 3.2 Weaknesses
- [specific weakness with example from PRD]

### 3.3 Critical Issues
> Issues that block correct auto-generation or cause the Design Job to make wrong assumptions.

- [ ] **[Issue type]**: [description]
  - **Location**: PRD §X.X
  - **Pipeline impact**: [which stage is affected and how]
  - **Recommended fix**: [specific action]

---

## 4. Detailed Analysis

### 4.1 Specification Depth Analysis

**FR depth distribution:**
- Full spec: X / N (X%)
- Partial spec: X / N (X%)
- One-liner: X / N (X%)
- Title only: X / N (X%)

**Depth cap applied?** Yes/No (threshold: 50% or 80% title-only)

**Title-only FRs that need expansion:**
- [ ] FR-XX: "[title]" — missing: [what needs to be specified]

### 4.2 Clarity Analysis

**Ambiguous expressions found:**
| Location | Expression | Issue | Recommended fix |
|----------|-----------|-------|----------------|
| §X.X | "handle appropriately" | No definition of "appropriate" | Define specific behavior |

**Under-specified items:**
| Location | Item | Missing information |
|----------|------|-------------------|
| §X.X | "cart feature" | Add/remove behavior, quantity limits, persistence |

### 4.3 Content Gaps

**Missing text:**
- [ ] [UI element]: [location] — placeholder used instead of actual text

**Missing links:**
- [ ] [button/link]: [location] — URL not provided

**Missing data definitions:**
- [ ] [data item]: [location] — fields/validation not defined

### 4.4 Constraint Analysis

**Business constraints:**
- [stated constraints summary]

**Tech stack (if present):**
- Accuracy: [accurate / issues found]
- Issues: [list any version conflicts or contradictions]

---

## 5. Recommended Actions

### 5.1 Critical (must fix before Design Job)
1. **[action]**
   - **Problem**: [description]
   - **Location**: PRD §X.X
   - **Fix**: [specific content to add/change]

### 5.2 Recommended (quality improvement)
1. **[action]**

### 5.3 Long-term (for future PRDs)
1. **[improvement]**

---

## 6. Pipeline Impact Prediction

### Design Job
- **System Design risk**: [prediction based on PRD gaps]
- **UI Design risk**: [prediction based on PRD gaps]

### Code Job
- **Implementation risk**: [over/under-implementation likelihood]

---

**Evaluation tool**: Ant CLI PRD Rubric v2.0
**Completed**: YYYY-MM-DD HH:MM
```

---

## 7. Usage

### 7.1 Evaluation Process

```
1. Read PRD
   └─ plan/prd.md

2. Required sections check
   └─ Checklist §4.1

3. Specification depth assessment
   └─ Classify each FR: full spec / partial / one-liner / title-only
   └─ Calculate depth distribution and apply cap if needed

4. Category-by-category evaluation
   ├─ Specification Depth (§4.2)
   ├─ Clarity — ambiguity + under-specification (§4.4)
   ├─ Scope Definition (§4.1 goals/non-goals/scenarios/NFRs)
   ├─ Content Fidelity (§4.3)
   ├─ Structure (§4.6 references + section organization)
   └─ Constraints — business + tech stack accuracy if present (§4.5)

5. Score assignment
   └─ Use scoring anchors (§5.3) — match evidence to the closest anchor

6. Report generation
   └─ Template §6
```

### 7.2 Evaluation Timing

**Recommended checkpoints:**
1. **After PRD authoring** (before Design Job): catch critical gaps early.
2. **After Design Job**: assess how PRD gaps affected auto-generated output.
3. **After Code Job**: trace quality through the full pipeline.

### 7.3 Scoring Discipline

**Evaluate strictly and without leniency.** The purpose of this rubric is to surface PRD deficiencies before they propagate through the pipeline. An inflated score harms the author by concealing fixable gaps.

**Anti-leniency principle:**
LLM evaluators have a systematic tendency to score generously — awarding partial credit for "effort", rounding up when in doubt, and treating structural presence as evidence of quality. This tendency must be actively countered:
- **When in doubt, score lower.** Uncertainty about quality is itself a signal of insufficient specification.
- **Do not give credit for intent.** "The author probably meant X" is not evidence. Only what is explicitly written counts.
- **Do not award points for section existence.** A section titled "Non-functional Requirements" that contains only "should be fast" deserves zero credit, not partial credit for being present.
- **Treat every gap as a downstream failure.** Each missing specification forces the Design Job to guess. Score as if the guess will be wrong — because it often is.

**Rules:**
- Every score must cite specific evidence (or specific absence of evidence).
- "Section exists" is not sufficient for credit — depth and accuracy matter.
- Do not award partial credit for placeholder content ("TBD", "TODO", "appropriate text").
- Count ambiguous expressions and under-specified items explicitly — do not estimate.
- Apply the depth cap mechanically: count title-only FRs, calculate percentage, cap if threshold met.

---

## 8. Examples

### 8.1 Good PRD (A grade)

```markdown
# OGF Homepage - PRD

> Content (text/data) + Functional requirements

## 1) One-line Summary
Build the OpenGame Foundation (OGF) landing page (single page) based on reference screenshots.

## 2) Goals / Non-goals
- **Goals**: Introduce OGF brand, explain ecosystem, drive social media traffic
- **Non-goals**: CMS, admin panel, i18n, membership features ❌

## 3) Content

### Hero
- Headline: `Open Ownership` / `Open World` (2 lines)
- Sub: `Ownership is distributed. Worlds are built together.`

### Technology (External links — use exactly!)
| Card | Learn more link |
|------|----------------|
| CROSS Mainnet | **https://crossscan.io** |
| CROSS Protocol | **https://docs.example.com/** |

⚠️ "Learn more" buttons must navigate to the exact URLs above.

## 4) Requirements (Functional)
- Single page (SPA), section order: Hero → About → Ecosystem → ...
- GNB: fixed top, smooth scroll on menu click
- Ecosystem: 3 cards, hover reveals description overlay

## 5) Non-functional
- Performance: image optimization, initial load < 3 seconds
- Accessibility: WCAG 2.1 AA, keyboard navigation

## 6) Tech Stack (optional — engineer preference)

| Library | Version | Notes |
|---------|---------|-------|
| Tailwind CSS | **v3.x** (v4 prohibited) | v4 has incompatible config |
| React | 18.x | |
| Next.js | 14.x | App Router |
```

**Strengths:**
- All required sections present
- External links exact
- Tech preferences accurate and internally consistent (optional, but correctly specified)
- Goals/non-goals clearly separated
- Quantitative NFR (3 seconds)

**Weaknesses:**
- FR section uses one-liners (behavior described, but conditions/outcomes sparse)
- No user scenario / flow

---

### 8.2 Poor PRD (D grade)

```markdown
# Project - PRD

## Goal
Build a homepage

## Features
- Main page
- About section
- Contact

## Tech
- React
- Appropriate styling library
```

**Problems:**
- No one-line summary
- No non-goals
- No content (zero UI text)
- No external links
- Requirements are title-only ("Main page" means what exactly?)
- No non-functional requirements
- "Appropriate styling library" — ambiguous
- No reference files
- Design Job cannot produce any reliable output from this

---

## 9. PRD Writing Guide (for authors)

### 9.1 Writing Principles

1. **Be specific**
   - ❌ "Fast loading"
   - ✅ "Initial load < 3 seconds"

2. **Include actual content**
   - ❌ "Display appropriate headline"
   - ✅ "Headline: `Open Ownership`"

3. **Specify external links exactly**
   - ❌ "Learn more button"
   - ✅ "Learn more button → `https://docs.example.com`"

4. **Describe features at specification level**
   - ❌ "Product management"
   - ✅ "Admin creates product: name (required, max 100 chars), price (required, >= 0). Created in 'pending' state."

5. **State what you will NOT build**
   - Add a "Non-goals" section listing features excluded from this iteration.

6. **Tech stack is optional — but if you include it, be precise**
   - ❌ "React" (which version?)
   - ✅ "React 18.x, Tailwind CSS v3.x (v4 prohibited)"
   - Omitting tech stack entirely is perfectly fine — the system auto-selects.

### 9.2 Self-check Checklist

After writing, verify:

- [ ] **One-line summary**: project described in 1-2 sentences
- [ ] **Goals / Non-goals**: both what you want AND what you exclude
- [ ] **User scenario**: at least one end-to-end flow
- [ ] **Content**: all UI text, links, data — actual values, not placeholders
- [ ] **Requirements**: each feature has behavior, conditions, outcomes
- [ ] **Non-functional**: performance, security, accessibility with numbers
- [ ] **References**: Figma URL or handoff bundle paths specified (if applicable)

### 9.3 Common Mistakes

| Mistake | Correct approach |
|---------|-----------------|
| "TODO: decide later" | Decide and specify now |
| "Handle appropriately" | Define specific criteria (e.g., "respond within 3 seconds") |
| "Latest version" | Specify exact version (e.g., "18.x") or omit tech stack entirely |
| "Social links" | Provide actual URLs (e.g., "https://x.com/...") |
| Mixed terminology | Pick one term per concept and use consistently |
| Feature titles without details | Add behavior, conditions, and outcomes for each feature |

---

## 10. Appendix

### 10.1 PRD Template (for authors)

```markdown
<!-- ant:template -->
<!-- Delete the ant:template line after filling in. -->

# {Project Name} - PRD

> Content (text/data) + Functional requirements

## 1) One-line Summary
- [Describe the project in 1-2 sentences]

## 2) Goals / Non-goals
- **Goals**: [What to achieve]
- **Non-goals**: [What to exclude] ❌

## 3) User Scenarios
### Primary flow
1. User [action] → System [response]
2. User [action] → System [response]
3. ...

## 4) Content (Text/Data)

### [Section name]
- [Actual text to display]
- [Link]: [exact URL]

## 5) Requirements (Functional)
- **[Feature 1]**: [behavior] when [condition] → [outcome]
- **[Feature 2]**: [behavior] when [condition] → [outcome]

## 6) Non-functional Requirements
- **Performance**: [quantitative target]
- **Accessibility**: [standard/requirement]
- **Security**: [requirement]

## 7) Tech Stack (optional — only if you have a preference)

| Library | Version | Notes |
|---------|---------|-------|
| [library] | [X.x] | [constraint] |

## 8) Constraints / Risks
- [Known constraints]
- [Risk factors]

## 9) References
- Figma workfile: `visual/ui/figma/figma.json` (URL only)
- Handoff bundle: `visual/ui/handoff/[path]` (free-form)
- Assets: `assets/[path]`
```

### 10.2 Related Documents

- **System Design Rubric**: `docs/rubric/SYSTEM-DESIGN-RUBRIC.md`
- **UI Design Rubric**: `docs/rubric/UI-DESIGN_RUBRIC.md`
- **Code Rubric**: `docs/rubric/CODE-RUBRIC.md`

---

**Document version**: 2.0
**Last updated**: 2026-04-06
**Author**: Ant CLI Team
