## ui-assets.md Generation Guide

### Purpose
Create a mapping document that connects source assets to their runtime destinations and usage contexts.

### Core Principles

#### 1. Token Reference
Look for the section titled `# REFERENCE: ui-tokens.md` elsewhere in this prompt.

- That section contains all design tokens (colors, typography, spacing, etc.)
- Use those token names when describing asset usage context
- Ensure consistency between asset documentation and design tokens

#### 2. Complete Inventory
- Document ALL files in `inputs/assets/`
- No asset should be undocumented
- Include metadata relevant to implementation

#### 3. Clear Mapping
- Every asset needs: source path → destination path
- Include usage context (where/how it's used)
- Note any special handling requirements

### Asset Categories

Document assets by type:

| Category | Contents |
|----------|----------|
| Logos | Brand marks, wordmarks, icons |
| Icons | UI icons, action icons, status indicators |
| Backgrounds | Section backgrounds, textures, patterns |
| Media | Images, illustrations, placeholders |
| Fonts | Custom font files (if applicable) |

### Mapping Structure

For each asset, document:

| Field | Description |
|-------|-------------|
| File | Original filename |
| Source | Path in `inputs/assets/` |
| Destination | Target path in codebase |
| Usage | Component/screen where used |
| Notes | Size, format, handling requirements |

### Quality Criteria

1. **Complete**: All assets in `inputs/assets/` documented
2. **Accurate**: Paths are correct and verified
3. **Contextual**: Usage context is clear
4. **Actionable**: Developer knows exactly how to use each asset

### Example Structure

```markdown
# ui-assets.md (Asset Mapping)

> Runtime asset file mapping

## Logos
| file | src | dest | usage |
|---|---|---|---|
| logo.svg | inputs/assets/logos/logo.svg | public/logos/logo.svg | Header logo |

## Icons
| file | src | dest | usage |
|---|---|---|---|
| arrow.svg | inputs/assets/icons/arrow.svg | public/icons/arrow.svg | Button arrow |

## Backgrounds
| file | src | dest | usage |
|---|---|---|---|
| hero-bg.webp | inputs/assets/bg/hero-bg.webp | public/bg/hero-bg.webp | Hero background |

## Copy Instructions

Runtime assets must be copied to the codebase's public/ folder:
- inputs/assets/ → codebase/public/
```

### Workflow

1. Review the `# REFERENCE: ui-tokens.md` section in this prompt
2. `list_assets` → Discover all available asset files
3. Optionally use `read_reference_image` to understand asset context
4. Generate ui-assets.md with complete mapping tables, referencing tokens where relevant
