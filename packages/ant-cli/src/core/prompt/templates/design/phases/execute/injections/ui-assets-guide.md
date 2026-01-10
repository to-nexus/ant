## ui-assets.md Generation Guide

### Purpose
Create an **accurate** mapping document that connects source assets to their runtime destinations and usage contexts.

### PRD Integration
**When to reference PRD**:
- **Asset purpose**: Understand why an asset is needed (e.g., "hero background" in PRD + image in assets = hero-bg.jpg)
- **Content context**: Identify which sections/features use specific assets
- **Branding requirements**: Extract logo variations, icon sets mentioned in PRD
- **Platform variants**: Check if PRD specifies different assets for mobile/desktop/dark mode

**Principles**:
- **PRD as naming guide**: Use PRD terminology for semantic asset naming (e.g., "Token Section Central Graphic" in PRD → `token-section-graphic.png`)
- **Visual-first verification**: Confirm PRD-mentioned assets exist in `inputs/assets/`
- **Usage context from PRD**: Document where/how assets are used based on PRD feature descriptions

### Core Principles

#### 1. Accuracy - Verify Before Documenting

**Always verify file existence:**
- Use `list_assets` tool to discover actual files in `inputs/assets/`
- Document only files that exist
- Preserve original filenames unless semantic clarity requires change

**When to rename:**
- **Keep original** if filename already conveys purpose clearly
- **Clarify purpose** if original name is generic or unclear (numbered files, temp names)
- **Match usage** if renaming aligns with section/component names in ui-spec

**Avoid arbitrary changes:** Don't rename based on personal preference; rename only when it improves clarity or matches documented usage.

#### 2. File Reuse - Document Once, Reference Multiple

When the same file serves multiple purposes:
- Map it once to a single destination
- Note all usage contexts in the usage column
- Or create a separate "Asset Reuse" section listing shared files

**Principle:** Don't duplicate files unnecessarily; document the reuse relationship.

#### 3. Destination Path Consistency

Establish consistent patterns for asset organization:
- Group by type (logos/, icons/, backgrounds/, images/)
- Keep structure flat when possible (avoid deep nesting)
- Follow framework conventions if applicable (e.g., static asset directories)

**Principle:** Predictability aids developers. Choose a pattern and maintain it throughout.

#### 4. Token Reference
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

### Documentation Approach

**Organize by category:**
Group assets by their functional type (logos, icons, backgrounds, media, etc.) using your judgment based on file names and content.

**For each asset, provide:**
- Original filename
- Source path (location in inputs/)
- Destination path (target location in codebase)
- Usage context (which sections/components use it)
- Any special notes (size recommendations, format notes, etc.)

**Maintain consistency:**
- Use consistent destination path patterns throughout
- Group similar assets in the same destination folders
- Keep naming conventions predictable

**Ensure completeness:**
All files discovered via `list_assets` must be documented. No asset should be left unmapped.

### Workflow

1. Review the `# REFERENCE: ui-tokens.md` section in this prompt
2. `list_assets` → Discover all available asset files
3. Optionally use `read_reference_image` to understand asset context
4. Generate ui-assets.md with complete mapping tables, referencing tokens where relevant
