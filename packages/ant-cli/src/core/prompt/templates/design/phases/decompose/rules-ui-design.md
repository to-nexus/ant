## 📋 CRITICAL RULES

### 1. Token Limit Safety (MOST IMPORTANT)

- **Claude Sonnet max output: 8,192 tokens**
- **~600 lines = ~7,200 tokens** (safe threshold)
- **Each TASK output must stay under 600 lines**
- Split into chapters if ANY document exceeds this

### 2. Chapter-Based = Sequential Append

- `ui-tokens-ch1` → writes to **ui-tokens.md**
- `ui-tokens-ch2` → **appends** to **ui-tokens.md**
- All chapters of same document share same `targetFile`

### 3. Line Budget Guidelines

**Each chapter ≤ 400 lines** (safe margin for ~8K token limit)

Adjust chapter count based on expected content:
- Simple content → fewer chapters
- Complex content → more chapters

### 4. Dependencies

- ui-assets chapters depend on ALL ui-tokens chapters
- ui-spec chapters depend on ALL ui-tokens + ui-assets chapters
- Chapters within same document are sequential (ch2 after ch1)

### 5. Priority Ranges

| Document | Priority Range |
|----------|----------------|
| ui-tokens | 100-149 |
| ui-assets | 200-249 |
| ui-spec | 300-349 |

### 6. Overlap Prevention

- Add "Skip any topics already documented" to continuation chapter descriptions
- Execution phase will automatically detect and skip duplicates

---

## 🚫 FORBIDDEN TASKS

DO NOT CREATE:
- ❌ "Final verification" or "review" tasks
- ❌ Deployment / Operations / Infrastructure tasks
- ❌ Separate documents per chapter (all chapters → same file)

---

## 📤 OUTPUT FORMAT

```json
{
  "targetFiles": ["ui-tokens.md", "ui-assets.md", "ui-spec.md"],
  "tasks": [
    {
      "id": "ui-tokens-ch1",
      "name": "Design Tokens: Colors",
      "targetFile": "ui-tokens.md",
      "description": "Color palette and backgrounds. MAX ~200 lines.",
      "priority": 100
    },
    {
      "id": "ui-spec-ch1",
      "name": "UI Spec: Global Settings",
      "targetFile": "ui-spec.md",
      "description": "Establish outline (TOC), breakpoints, layout rules. NO components. MAX ~150 lines.",
      "priority": 300
    }
  ]
}
```

### targetFiles Selection

| Scenario | targetFiles |
|----------|-------------|
| Full generation | `["ui-tokens.md", "ui-assets.md", "ui-spec.md"]` |
| Spec only (tokens/assets exist) | `["ui-spec.md"]` |
| Tokens only | `["ui-tokens.md"]` |
| Assets only | `["ui-assets.md"]` |

**Rule**: Only include documents that will be generated. Tasks MUST match targetFiles.

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique (e.g., "ui-tokens", "ui-spec-ch2") |
| name | Descriptive (e.g., "Design Tokens: Colors") |
| targetFile | MUST be in targetFiles array |
| description | Clear scope of what to document |
| priority | See priority ranges above |

---

## 📋 TASK DESCRIPTION GUIDELINES

### ui-spec-ch1 (Critical)

**MUST include in description:**
- "Establish document outline (numbered TOC)"
- "Global breakpoints, container widths"
- "NO component specs"

**ch1 creates the structural contract. ch2+ fill in content following that structure.**

### ch2+ (Continuation)

**MUST include in description:**
- "(append)" indicator
- "Follow ch1 outline structure"
- "Skip documented topics"

---

## ✅ VALIDATION CHECKLIST

Before outputting, verify:

### JSON Structure
- ✅ Valid JSON syntax
- ✅ `targetFiles` contains only requested documents (check directive!)
- ✅ Every task's `targetFile` is in `targetFiles` array
- ✅ All fields present (id, name, targetFile, description, priority)
- ✅ Priority in correct range (100-149, 200-249, 300-349)
- ✅ No forbidden tasks (verification, deployment, operations)

### Chapter Count
- ✅ At least 2 chapters for ui-spec (ch1 = outline, ch2+ = content)
- ✅ Chapter count reflects complexity (more content → more chapters)

### Task Descriptions
- ✅ **ui-spec-ch1 description includes "establish outline" or "TOC"**
- ✅ **ch2+ descriptions include "(append)" and "follow ch1 structure"**
