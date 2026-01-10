## ui-assets.json Generation Guide

### Purpose
Create a JSON mapping document that connects source assets to their runtime destinations and usage contexts.

### ⚠️ CRITICAL: Path Consistency for Multi-Chapter Generation

**When generating ui-assets chapters (ch1, ch2, etc.), ALL chapters MUST use the SAME destination path patterns.**

#### For ch1 (First Chapter):
1. **Define the canonical path pattern** in the JSON structure
2. **Use consistent paths** throughout the document

#### For ch2+ (Continuation Chapters):
1. **Read the existing JSON structure** (shows ch1's patterns)
2. **MUST follow the exact same patterns** - DO NOT create new patterns!
3. **If an asset was documented in ch1** → Skip it, don't re-document

**❌ WRONG (Path Inconsistency):**
```json
// ch1: 
"icon-telegram": { "dest": "public/icons/telegram.svg" }
// ch2: 
"icon-telegram": { "dest": "public/icons/social/telegram.svg" }  // DIFFERENT PATH!
```

**✅ CORRECT:**
```json
// ch1 established pattern, ch2 follows:
"icon-newasset": { "dest": "public/icons/newasset.svg" }
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
      "logos": "public/logos/",
      "icons": "public/icons/",
      "backgrounds": "public/backgrounds/"
    }
  },
  "logos": {
    "logo-header": {
      "src": "inputs/assets/logos/header-logo.svg",
      "dest": "public/logos/header.svg",
      "format": "svg",
      "usage": "Header navigation (left-aligned)"
    },
    "logo-footer": {
      "src": "inputs/assets/logos/footer-logo.svg",
      "dest": "public/logos/footer.svg",
      "format": "svg",
      "usage": "Footer branding (centered)"
    }
  },
  "icons": {
    "icon-telegram": {
      "src": "inputs/assets/icons/telegram.svg",
      "dest": "public/icons/telegram.svg",
      "format": "svg",
      "usage": "Social section link"
    },
    "icon-gas": {
      "src": "inputs/assets/icons/icon-gas.svg",
      "dest": "public/icons/gas.svg",
      "format": "svg",
      "usage": "Token section: Gas & Network Fees card"
    }
  },
  "backgrounds": {
    "bg-hero": {
      "src": "inputs/assets/bg/hero-main.png",
      "dest": "public/backgrounds/hero.png",
      "format": "png",
      "usage": "Hero section full-width background",
      "overlay": "colors.overlay.gradientDark"
    },
    "bg-ecosystem-ogf": {
      "src": "inputs/assets/bg/bg-discover-1.png",
      "dest": "public/backgrounds/ecosystem-ogf.png",
      "format": "png",
      "usage": "Ecosystem section: OGF card background"
    }
  }
}
```

**Note**: `_meta.pathPattern` ensures continuation chapters use the same destination paths.

### Output Format

{{#if lastSectionNumber}}
**Continuation chapter**: Merge additional asset categories into existing JSON.
{{else}}
**First chapter**: Create initial JSON structure with asset mappings.
{{/if}}

### Example Output

**For first chapter (task: ui-assets or ui-assets-ch1)**:

```xml
<file path="outputs/design/ui-assets.json">
{
  "_meta": {
    "lastSection": 2,
    "sectionPattern": "top-level",
    "pathPattern": {
      "logos": "public/logos/",
      "backgrounds": "public/backgrounds/"
    }
  },
  "logos": {
    "logo-header": {
      "src": "inputs/assets/logos/header-logo.svg",
      "dest": "public/logos/header.svg",
      "format": "svg",
      "usage": "Header navigation"
    }
  },
  "backgrounds": {
    "bg-hero": {
      "src": "inputs/assets/bg/hero.png",
      "dest": "public/backgrounds/hero.png",
      "format": "png",
      "usage": "Hero section background"
    }
  }
}
</file>
```

**For continuation chapter (task: ui-assets-ch2)**:

```xml
<append path="outputs/design/ui-assets.json">
{
  "_meta": {
    "lastSection": 3,
    "pathPattern": {
      "icons": "public/icons/"
    }
  },
  "icons": {
    "icon-telegram": {
      "src": "inputs/assets/icons/telegram.svg",
      "dest": "public/icons/telegram.svg",
      "format": "svg",
      "usage": "Social links section"
    },
    "icon-gas": {
      "src": "inputs/assets/icons/icon-gas.svg",
      "dest": "public/icons/gas.svg",
      "format": "svg",
      "usage": "Token feature card icon"
    }
  }
}
</append>
```

**Note**: The system automatically merges new asset categories into existing JSON.

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

Example - if ch1 used `icons → public/icons/`:
- ✅ CORRECT: `"icon-new": { "dest": "public/icons/new.svg" }`
- ❌ WRONG: `"icon-new": { "dest": "public/icons/social/new.svg" }` (new subdirectory!)

**DO NOT create new subdirectories or change the path structure!**
════════════════════════════════════════════════════════════════════════════════
{{/if}}
