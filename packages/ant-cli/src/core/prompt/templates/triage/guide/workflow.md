# Ant Workflow

## Workflow Selection Principles

### Principle 1: Inputs Determine Quality

| Input Completeness | Expected Output Quality |
|-------------------|------------------------|
| PRD + References + Design Docs | Highest - Consistent, well-architected code |
| PRD or References only | Medium - May need iterations |
| Chat directive only | Variable - Good for simple changes |

### Principle 2: Structured vs Direct Approach

| Project Scope | Recommended Approach |
|--------------|---------------------|
| New feature / New project | Structured: Inputs → Design → Code |
| Simple modification | Direct: Chat directive → Code Job |
| Bug fix / Minor change | Direct: Chat directive → Code Job |

### Principle 3: When to Skip Design Phase

Design phase can be skipped when:
- Making isolated, well-defined changes
- Modifying existing patterns
- Quick prototyping (accepting lower consistency)

Design phase is recommended when:
- Building new features
- Starting new projects
- Complex multi-component changes
- Team collaboration needed

## Standard Development Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ANT WORKFLOW                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1️⃣ PREPARE INPUTS                                          │
│     ├── PRD (inputs/prd.md)                                 │
│     ├── Screen captures (inputs/references/screens/)        │
│     └── Assets (inputs/assets/)                             │
│                                                             │
│  2️⃣ DESIGN                                                   │
│     ├── UI Design: Screen images → UI Spec Documents        │
│     └── System Design: PRD → Architecture Document          │
│                                                             │
│  3️⃣ CODE                                                     │
│     └── Design Docs → Implementation                        │
│                                                             │
│  4️⃣ ITERATE                                                  │
│     └── Refine through conversation                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Workflow by Project Type

### Frontend Development

**With UI Reference:**
```
Screen captures → Design Job (UI Design) → Code Job
```
- Add screen captures to `inputs/references/screens/`
- Design Job generates: ui-tokens, ui-assets, ui-spec
- Code Job generates: components, styles, pages

**Without UI Reference:**
```
Chat description → Code Job
```
- Describe what you want: "Create a login form with email/password"
- Code Job generates implementation directly

### Backend Development

**With PRD:**
```
PRD → Design Job (System Design) → Code Job
```
- Write PRD in `inputs/prd.md`
- Design Job generates: API specs, data models, architecture
- Code Job generates: routes, controllers, services, models

**Quick Changes:**
```
Chat description → Code Job
```
- Describe the change: "Add pagination to the users endpoint"
- Code Job modifies existing code

### Fullstack Development

**Recommended Flow:**
```
Learn Job → Design Job → Code Job
```

1. **Learn Job**: Index existing codebase for context
2. **Design Job**: Create specs for both frontend and backend
3. **Code Job**: Generate implementation with full stack awareness

### Monorepo Development

**Per-Package Approach:**
```
monorepo/
├── apps/
│   ├── web/        ← Create feature here
│   └── api/        ← Create feature here
└── packages/
    └── shared/     ← Create feature here
```

- Create a feature in the specific package/app
- Ant works within that context
- Use Learn Job at root for cross-package awareness

## Input Types

### PRD (Product Requirements Document)
- Location: `inputs/prd.md`
- Purpose: Define what to build
- Used by: System Design mode
- Format: Markdown with requirements, user stories, constraints

### Reference Images
- Location: `inputs/references/screens/`
- Purpose: UI screen captures from any source
- Used by: UI Design mode
- Formats: PNG, JPG, WebP

### Component Snapshots
- Location: `inputs/references/components/`
- Purpose: Reusable component examples
- Used by: UI Design mode (optional)

### Assets
- Location: `inputs/assets/`
- Purpose: Icons, images, fonts
- Used by: UI Design mode (optional)

## Output Types

### Design Documents
- Location: `outputs/design/`
- Contents:
  - `ui-tokens.json` - Colors, typography, spacing
  - `ui-assets.json` - Asset mappings
  - `ui-spec.json` - Component specifications
  - `system-design.md` - Architecture document

### Generated Code
- Location: Your project source directories
- Matches your existing code style (if Learn Job was run)
- Includes necessary imports and dependencies

## Workflow Decision Guide

### Observe Your Current State

| Observable State | Recommended Next Step |
|-----------------|----------------------|
| Empty workspace, new project | Prepare inputs (PRD or references) |
| PRD exists, no design docs | Run Design Job (System Design) |
| Reference images exist, no UI specs | Run Design Job (UI Design) |
| Design docs exist, no code | Run Code Job with design docs |
| Existing codebase, not indexed | Run Learn Job first |

### Quick Reference

| Goal | Recommended Path |
|------|-----------------|
| Build new feature (structured) | Inputs → Design Job → Code Job |
| Build new feature (quick) | Code Job with detailed chat directive |
| Modify existing code | Learn Job → Code Job |
| Create UI from designs | References → Design Job (UI) → Code Job |
| Create API from requirements | PRD → Design Job (System) → Code Job |

## Tips

1. **Observe first** - Check workspace state before deciding workflow
2. **Structured for new** - Use Design Job for new features/projects
3. **Direct for changes** - Chat directives work well for modifications
4. **Learn for existing** - Index codebase before modifying
5. **Quality vs Speed** - More inputs = better outputs, but takes more time
