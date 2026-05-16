## ui-assets.json Generation Guide (Description-driven)

### Purpose
Emit a JSON catalog of the **logical** asset surface — what each asset is, how it should be rendered, and where it appears in the UI. Physical placement (which folder under the generated project) is decided by the code phase based on the target framework. Design phase MUST NOT commit to a destination path.

### Source-of-truth Priorities
**When to reference PRD / directive**:
- **Asset purpose**: Understand why an asset is needed
- **Content context**: Identify which sections/features use specific assets
- **Branding requirements**: Logo variations and icon sets called out by PRD/directive

**When to use `list_assets`**:
- Inputs already placed under `assets/` (icons, images, fonts, ...) ground the catalog in real files
- If `assets/` is empty, document the asset slots the project needs and use placeholder `src` paths under `assets/<category>/<file>`

### Core Principles

#### 1. Accuracy — Verify Before Documenting
- Use `list_assets` tool to discover actual files in `assets/`
- Document only files that exist (or clearly mark placeholder slots)
- Preserve original filenames unless semantic clarity requires change

#### 2. Logical Metadata Only — No Physical Paths
- `dest` and `_meta.pathPattern` are NOT part of this schema. The design phase does not know the target framework's static-asset conventions; committing a path here would propagate a framework-blind decision downstream.
- The code phase resolves placement per framework (e.g. Next.js → `public/assets/`, Vite with SVGR → `src/assets/`) based on `framework` and SVGR availability.

### JSON Structure

```json
{
  "<category>": {
    "<asset-id>": {
      "src": "assets/<source-path>",
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

> **Constraint**: Categories are determined by the asset purpose described in the directive / PRD or by directory structure returned by `list_assets`. Do NOT assume fixed category names — use what the user organized or what the requirements imply.

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

### Example Output

```xml
<file path="visual/ui/ant/ui-assets.json">
{
  "icons": {
    "icon-id": {
      "src": "assets/...",
      "format": "svg",
      "themeAdaptation": "currentColor",
      "usage": "Usage context",
      "rendering": { "method": "explicit", "width": 24, "height": 24 }
    }
  },
  "images": {
    "image-id": {
      "src": "assets/...",
      "format": "png",
      "usage": "Usage context",
      "rendering": { "method": "fill", "containerSize": "300x200" }
    }
  }
}
</file>
```

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
    "src": "assets/icons/wallet.svg",
    "format": "svg",
    "themeAdaptation": "currentColor",
    "rendering": { "method": "explicit", "width": 20, "height": 20 }
  }
}
```

**⚠️ `<img>` tag cannot style SVG internals**: If `themeAdaptation` is `"currentColor"`, the asset MUST be rendered inline (React component, SVG sprite) — NOT via `<img src="...">`. Document the required rendering method accordingly; the code phase will then decide between inline rendering and URL reference per framework.

### Quality Criteria

1. **Complete**: All assets present under `assets/` are documented; missing slots are noted as placeholders if the project needs them
2. **Accurate**: `src` paths are correct and verified with `list_assets`
3. **Valid JSON**: Proper JSON syntax
4. **Framework-agnostic**: No physical paths, no `dest`, no `_meta.pathPattern` — those belong to the code phase
5. **Contextual**: Usage context is clear

### Workflow

1. `list_assets` → Discover all available asset files
2. Cross-reference the directive / PRD to confirm naming, categories, and per-asset purpose
3. Generate ui-assets.json with logical metadata only — no placement decisions
