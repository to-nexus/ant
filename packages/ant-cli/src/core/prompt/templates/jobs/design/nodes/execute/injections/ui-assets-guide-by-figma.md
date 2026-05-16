## ui-assets.json Generation Guide (Figma-driven)

### Purpose
Emit a JSON catalog of the **logical** asset surface — what each asset is, how it should be rendered, and where it appears in the UI. Physical placement (which folder under the generated project) is decided by the code phase based on the target framework. Design phase MUST NOT commit to a destination path.

### PRD Integration
**When to reference PRD**:
- **Asset purpose**: Understand why an asset is needed
- **Content context**: Identify which sections/features use specific assets
- **Branding requirements**: Extract logo variations, icon sets mentioned in PRD

### Core Principles

#### 1. Asset Reference Integrity

**CONSTRAINT: Every `src` field in ui-assets.json MUST reference a file that exists on the local filesystem.**

- Code Job consumes local file paths. Non-existent paths break the build.
- If a local file does not exist for an asset, it has NOT been downloaded yet.
- The system validates this constraint after task completion. Violations cause task failure.

#### 2. Accuracy
- Preserve Figma node names as filenames unless semantic clarity requires change
- The `src` field in ui-assets.json must point to the actual downloaded file path (e.g., `assets/icons/logo.svg`)

#### 3. Logical Metadata Only — No Physical Paths
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

> **Constraint**: Categories are determined by observing asset purpose from Figma node names and component hierarchy. Do NOT assume fixed category names — infer from the design structure.

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

1. **Complete**: All exportable asset nodes from Figma documented
2. **Accurate**: `src` paths point to actual downloaded files
3. **Valid JSON**: Proper JSON syntax
4. **Framework-agnostic**: No physical paths, no `dest`, no `_meta.pathPattern` — those belong to the code phase
5. **Contextual**: Usage context is clear

### Workflow

1. Review nodeSummary in Available Resources → Identify exportable asset nodes
2. Query specific nodeIds (not root) for asset details and download URLs
3. Download each asset to `assets/` before referencing it in ui-assets.json
4. Generate ui-assets.json with logical metadata only — no placement decisions
