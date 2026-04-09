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
// ch1 established: images → public/images/
// ch2 uses different path structure — INCONSISTENT!
"asset-new": { "dest": "public/images/subdir/new.png" }
```

**✅ CORRECT:**
```json
// ch1 established pattern, ch2 follows exactly:
"asset-new": { "dest": "public/images/new.png" }
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

### JSON Structure

**`dest` is determined by `format`:**

| format | dest pattern | Why |
|--------|-------------|-----|
| `svg` | `src/assets/<category>/<file>` | Source tree — required for SVGR import (webpack processes source tree only) |
| `png`, `jpg`, `webp` | `public/<category>/<file>` | Static serving via framework image component |

```json
{
  "_meta": {
    "pathPattern": {
      "<svg-category>": "src/assets/<svg-category>/",
      "<raster-category>": "public/<raster-category>/"
    }
  },
  "<category>": {
    "<asset-id>": {
      "src": "inputs/assets/<source-path>",
      "dest": "<see format-based rule above>",
      "format": "svg | png | jpg | webp",
      "themeAdaptation?": "currentColor | static | partial",
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

### Example Output

```xml
<file path="outputs/design/ui/ui-assets.json">
{
  "_meta": {
    "pathPattern": { "icons": "src/assets/icons/", "images": "public/images/" }
  },
  "icons": {
    "icon-id": {
      "src": "inputs/assets/...",
      "dest": "src/assets/icons/...",
      "format": "svg",
      "themeAdaptation": "currentColor",
      "usage": "Usage context"
    }
  },
  "images": {
    "image-id": {
      "src": "inputs/assets/...",
      "dest": "public/images/...",
      "format": "png",
      "usage": "Usage context"
    }
  }
}
</file>
```

**Note**: Replace `YOUR_CATEGORY` with the actual category determined from the asset directory structure and filenames. The system automatically merges new categories.

### 🎨 SVG Color Theming (CRITICAL for dark/light mode)

**Principle**: SVG icons must adapt to the application's color theme. Hardcoded colors in SVGs become invisible when the theme changes.

**Guideline**: For SVG assets, you MAY include a `themeAdaptation` field. If omitted, Code Job defaults to `"currentColor"`.

| SVG Content | themeAdaptation | Action |
|-------------|----------------|--------|
| Monochrome icon (single stroke/fill color) | `"currentColor"` | Replace hardcoded color with `currentColor` |
| Brand logo with specific colors | `"static"` | Keep original colors |
| Mixed brand + adaptive colors | `"partial"` | Keep brand colors, replace others with `currentColor` |

```json
{
  "icon-wallet": {
    "src": "inputs/assets/icons/wallet.svg",
    "dest": "src/assets/icons/icon-wallet.svg",
    "format": "svg",
    "themeAdaptation": "currentColor",
    "rendering": { "method": "explicit", "width": 20, "height": 20 }
  }
}
```

**⚠️ `<img>` tag cannot style SVG internals**: If `themeAdaptation` is `"currentColor"`, the asset MUST be rendered inline (React component, SVG sprite) — NOT via `<img src="...">`. Document the required rendering method accordingly.

### Quality Criteria

1. **Complete**: All assets in `inputs/assets/` documented
2. **Accurate**: Paths are correct and verified with `list_assets`
3. **Valid JSON**: Proper JSON syntax
4. **Consistent**: Same destination path patterns throughout
5. **Contextual**: Usage context is clear

### Workflow

1. `list_assets` → Discover all available asset files
2. Optionally use `read_reference_image` to understand asset context
3. Generate ui-assets.json with complete mapping structure

{{#if pathPattern}}
════════════════════════════════════════════════════════════════════════════════
📁 **PATH_PATTERN - ESTABLISHED IN CHAPTER 1 (MUST FOLLOW!)**
════════════════════════════════════════════════════════════════════════════════

**ch1 established these destination path patterns:**
`{{pathPattern}}`

**⚠️ CRITICAL: You MUST use these EXACT paths for new assets!**

Example - if ch1 used `icons → src/assets/icons/`, `images → public/images/`:
- ✅ CORRECT: Follow the same path pattern exactly (SVG → src/assets/, raster → public/)
- ❌ WRONG: Create new subdirectories not established in ch1

**DO NOT create new subdirectories or change the path structure!**
════════════════════════════════════════════════════════════════════════════════
{{/if}}
