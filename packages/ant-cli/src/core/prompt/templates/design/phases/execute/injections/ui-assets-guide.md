## ui-assets.json Generation Guide

### Purpose
Create a JSON mapping document that connects source assets to their runtime destinations and usage contexts.

### ⚠️ CRITICAL: Scope & Path Consistency

**🚨 READ YOUR TASK DESCRIPTION - generate only the asset categories it specifies!**

#### For First Task (no existing document):
1. **Define the canonical path pattern** in `_meta.pathPattern`
2. **Generate only categories specified in YOUR task description**

#### For Continuation Tasks (existing document):
1. **Read the existing JSON structure** to see established patterns
2. **MUST follow the exact same path patterns** - DO NOT create new subdirectories!
3. **Skip any assets already documented** - check existing content
4. **Generate only categories specified in YOUR task description**

**❌ WRONG (Path Inconsistency):**
```json
// ch1 established: <category> → public/<category>/
// ch2 uses different path structure — INCONSISTENT!
"asset-new": { "dest": "public/<category>/subdir/new.svg" }
```

**✅ CORRECT:**
```json
// ch1 established pattern, ch2 follows exactly:
"asset-new": { "dest": "public/<category>/new.svg" }
```

### PRD Integration
**When to reference PRD**:
- **Asset purpose**: Understand why an asset is needed
- **Content context**: Identify which sections/features use specific assets
- **Branding requirements**: Extract logo variations, icon sets mentioned in PRD

### Core Principles

#### 1. Accuracy - Verify Before Documenting
- Use `list_assets` tool to discover actual files in `inputs/assets/`
- Document only files that exist
- Preserve original filenames unless semantic clarity requires change

#### 2. Token Reference
- Use token keys from `ui-tokens.json` when describing asset usage context
- Example: `"overlay": "colors.overlay.dark"` instead of raw hex values

### JSON Structure

```json
{
  "_meta": {
    "lastSection": 3,
    "sectionPattern": "top-level",
    "pathPattern": {
      "<category>": "public/<category>/"
    }
  },
  "<category>": {
    "<asset-id>": {
      "src": "inputs/assets/<source-path>",
      "dest": "public/<category>/<dest-filename>",
      "format": "svg | png | jpg | webp",
      "usage": "<where this asset appears in the UI>",
      "rendering": {
        "method": "explicit | fill | css-background",
        "width": 120,
        "height": 32
      }
    }
  }
}
```

> **Constraint**: Categories are determined by observing asset purpose from filenames and directory structure returned by `list_assets`. Do NOT assume fixed category names — use what the user organized or infer from file content.

### 🎯 Rendering Field (CRITICAL for Code Implementation)

**Every image asset MUST include a `rendering` field** to specify how it should be displayed.

| Rendering Method | When to Use | Required Fields |
|------------------|-------------|-----------------|
| `explicit` | Logos, icons with known size | `width`, `height` (pixels) |
| `fill` | Card backgrounds, thumbnails | `containerSize` (e.g., "300x200") |
| `css-background` | Full-section backgrounds | `containerSize: "full-width"` |

**Why this matters:**
- Without sizing info, Code Job must guess → often guesses wrong
- Explicit dimensions prevent invisible images (0x0 rendering bug)
- Code Job can directly use these values in implementation

**Note**: `_meta.pathPattern` ensures continuation chapters use the same destination paths.

### Output Format

{{#if lastSectionNumber}}
**Continuation chapter**: Merge additional asset categories into existing JSON.
{{else}}
**First chapter**: Create initial JSON structure with asset mappings.
{{/if}}

### Example Output

{{#if lastSectionNumber}}
**Continuation task** - use `<append>` to add YOUR asset categories:

```xml
<append path="outputs/design/ui-assets.json">
{
  "_meta": {
    "lastSection": {{add lastSectionNumber 1}},
    "pathPattern": { "YOUR_CATEGORY": "public/YOUR_CATEGORY/" }
  },
  "YOUR_CATEGORY": {
    "asset-id": {
      "src": "inputs/assets/...",
      "dest": "public/YOUR_CATEGORY/...",
      "format": "svg|png",
      "usage": "Usage context"
    }
  }
}
</append>
```
{{else}}
**First task** - use `<file>` to create the document:

```xml
<file path="outputs/design/ui-assets.json">
{
  "_meta": {
    "lastSection": 1,
    "sectionPattern": "top-level",
    "pathPattern": { "YOUR_CATEGORY": "public/YOUR_CATEGORY/" }
  },
  "YOUR_CATEGORY": {
    "asset-id": {
      "src": "inputs/assets/...",
      "dest": "public/YOUR_CATEGORY/...",
      "format": "svg|png",
      "usage": "Usage context"
    }
  }
}
</file>
```
{{/if}}

**Note**: Replace `YOUR_CATEGORY` with the actual category determined from the asset directory structure and filenames. The system automatically merges new categories.

### Quality Criteria

1. **Complete**: All assets in `inputs/assets/` documented
2. **Accurate**: Paths are correct and verified with `list_assets`
3. **Valid JSON**: Proper JSON syntax
4. **Consistent**: Same destination path patterns throughout
5. **Contextual**: Usage context is clear

### Workflow

1. Review the `# REFERENCE: ui-tokens.json` section in this prompt
2. `list_assets` → Discover all available asset files
3. Optionally use `read_reference_image` to understand asset context
4. Generate ui-assets.json with complete mapping structure

{{#if pathPattern}}
════════════════════════════════════════════════════════════════════════════════
📁 **PATH_PATTERN - ESTABLISHED IN CHAPTER 1 (MUST FOLLOW!)**
════════════════════════════════════════════════════════════════════════════════

**ch1 established these destination path patterns:**
`{{pathPattern}}`

**⚠️ CRITICAL: You MUST use these EXACT paths for new assets!**

Example - if ch1 used `<category> → public/<category>/`:
- ✅ CORRECT: Follow the same path pattern exactly
- ❌ WRONG: Create new subdirectories not established in ch1

**DO NOT create new subdirectories or change the path structure!**
════════════════════════════════════════════════════════════════════════════════
{{/if}}
