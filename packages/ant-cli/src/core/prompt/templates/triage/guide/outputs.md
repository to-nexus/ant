# Ant Output Documents

## Design Job Outputs

### UI Design Mode Outputs

When you run Design Job with screen captures, Ant generates **3 documents**:

#### 1. ui-tokens.json
Design system tokens extracted from your screens.

**Contains:**
- Colors (primary, secondary, semantic colors)
- Typography (font families, sizes, weights, line heights)
- Spacing scale (margin, padding values)
- Border radius values
- Shadow definitions
- Breakpoints

**Used for:** Consistent styling across components

#### 2. ui-assets.json
Asset mappings from your design.

**Contains:**
- Icon mappings (name → file path)
- Image assets
- Logo variants
- Custom graphic elements

**Used for:** Asset management in code generation

#### 3. ui-spec.json
Component specifications.

**Contains:**
- Component hierarchy (pages → sections → components)
- Props and variants for each component
- Layout structure (flex, grid)
- Responsive behavior
- State variations (hover, active, disabled)

**Used for:** Accurate component implementation

---

### System Design Mode Outputs

When you run Design Job with PRD (no screen captures), Ant generates:

#### system-design.md
Architecture and technical specification.

**Contains:**
- System overview and boundaries
- API specifications (endpoints, request/response)
- Data models and schemas
- Service architecture
- Authentication/authorization design
- Error handling patterns

**Used for:** Backend and fullstack implementation

---

## Output by Project Type

| Project Type | Design Job Mode | Outputs |
|-------------|-----------------|---------|
| **Frontend only** | UI Design | ui-tokens, ui-assets, ui-spec |
| **Backend only** | System Design | system-design.md |
| **Fullstack** | Both modes | All 4 documents |

### Frontend Project
```
outputs/design/
├── ui-tokens.json    ← Color, typography, spacing
├── ui-assets.json    ← Icons, images
└── ui-spec.json      ← Component specs
```

### Backend Project
```
outputs/design/
└── system-design.md  ← API, data models, architecture
```

### Fullstack Project
Run Design Job twice (or provide both inputs):
```
outputs/design/
├── ui-tokens.json
├── ui-assets.json
├── ui-spec.json
└── system-design.md
```

---

## Code Job Outputs

Code Job generates files **in your project source directories**, not in outputs/.

### From UI Specs (Frontend)
- Component files (`.tsx`, `.vue`, `.svelte`, etc.)
- Style files (CSS, Tailwind classes, styled-components)
- Type definitions
- Test files (optional)

### From System Design (Backend)
- Route/controller files
- Service/business logic files
- Model/schema definitions
- Middleware
- Test files (optional)

### File Location
Code Job respects your existing project structure:
- If you have `src/components/`, new components go there
- If you have `app/api/`, new routes go there
- Learns from your codebase (via Learn Job) for consistency

---

## Document Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENT FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Screen Captures                                            │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────┐                                            │
│  │ UI Design   │ → ui-tokens.json (design system)          │
│  │   Mode      │ → ui-assets.json (asset mappings)         │
│  │             │ → ui-spec.json (component specs)          │
│  └─────────────┘                                            │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────┐                                            │
│  │ Code Job    │ → Components, Styles, Types               │
│  └─────────────┘                                            │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  PRD Document                                               │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────┐                                            │
│  │ System      │ → system-design.md (architecture)         │
│  │ Design Mode │                                            │
│  └─────────────┘                                            │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────┐                                            │
│  │ Code Job    │ → Routes, Services, Models                │
│  └─────────────┘                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Quality Tips

### Better UI Specs
- Provide **multiple screen captures** (different pages, states)
- Include **component close-ups** in `inputs/references/components/`
- Add **icon/asset files** in `inputs/assets/`

### Better System Design
- Write **detailed PRD** with user stories and constraints
- Specify **technology preferences** (e.g., "use PostgreSQL")
- Describe **integration points** with external systems

### Better Code Generation
- Run **Learn Job first** for existing projects
- Review design documents before Code Job
- Use **specific instructions** in chat for modifications
