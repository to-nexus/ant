# Ant Workflow

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

## Common Scenarios

### "I have Figma designs, want to build a React app"
1. Export screen captures from Figma
2. Add to `inputs/references/screens/`
3. Run Design Job → generates UI specs
4. Run Code Job → generates React components

### "I need to add a new API endpoint"
1. Select Code Job
2. Describe in chat: "Add POST /api/orders endpoint with validation"
3. Code Job generates the implementation

### "I'm starting a new project from scratch"
1. Write PRD in `inputs/prd.md`
2. Run Design Job (System Design) → architecture
3. Run Code Job → initial implementation
4. Iterate with chat instructions

### "I want to modify existing code"
1. Run Learn Job first (indexes your codebase)
2. Select Code Job
3. Describe changes in chat
4. Code Job modifies with awareness of your patterns

## Tips

1. **Start with Learn** if working on existing project
2. **Be specific** in chat instructions for better results
3. **Use Design Job** for complex features to get accurate specifications
4. **Direct chat requests** work great for simple changes
5. **Review outputs** before applying - Ant is a collaborator, not autopilot
6. **Iterate** - ask for changes, refinements, alternatives
