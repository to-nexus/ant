## 📝 Text Response Format Guidelines

When providing explanations, summaries, or general responses (NOT file operations), follow these formatting rules for optimal readability:

### ✅ GOOD: Compact, Readable Formatting

**Lists with parentheses:**
```
Created the following files: package.json (with dependencies), tsconfig.json (strict mode), and tailwind.config.ts (design tokens).
```

**Inline lists with commas:**
```
The configuration includes Next.js 14, React 18, TypeScript 5.x, TailwindCSS 3.x, and ESLint.
```

**Bulleted lists for multiple items:**
```
Created configuration files:
- package.json with ALL dependencies
- tsconfig.json with strict mode enabled
- tailwind.config.ts with design tokens from Design System chapter
- next.config.js, postcss.config.js, .eslintrc.json
```

**Structured sections:**
```
## Project Structure

Created the following folder structure:
- `src/domain/` - Business logic and entities
- `src/infrastructure/` - External services and APIs
- `src/presentation/` - UI components and pages
```

---

### ❌ BAD: Excessive Line Breaks

**DON'T break inside parentheses:**
```
❌ Created: package.json
(
with dependencies
)
, tsconfig.json
(
strict mode
)

❌ Full keyboard navigation (Tab, Enter, Escape)

ARIA attributes (
aria-label
,
aria-expanded
,
aria-controls
,
aria-hidden
,
aria-busy
)
```

**✅ CORRECT - Keep parentheses content inline:**
```
✅ Created: package.json (with dependencies), tsconfig.json (strict mode)

✅ Full keyboard navigation (Tab, Enter, Escape)
✅ ARIA attributes (aria-label, aria-expanded, aria-controls, aria-hidden, aria-busy)
```

**DON'T create orphan lines:**
```
❌ Folder structure
(
src/domain/
,
src/infrastructure/
,
src/presentation/
)
```

---

### 🎯 Core Principles

1. **Keep related items together** - Don't break lists unnecessarily
2. **Use inline formatting** - Parentheses and commas inline when possible
3. **Break for clarity, not decoration** - Line breaks for logical sections only
4. **Markdown lists for 3+ items** - Use `-` or `1.` for structured lists
5. **Avoid orphan punctuation** - Keep `(`, `)`, `,` attached to content
6. **Use inline code for technical terms** - Single backticks for variables, file names, function names

⚠️ **CRITICAL: Parentheses Content Must Stay Inline**
- ✅ CORRECT: `(aria-label, aria-expanded, aria-controls)`
- ❌ WRONG: Breaking each item inside parentheses onto separate lines
- **Rule**: If it starts with `(` and ends with `)`, keep everything on one line or use proper list format

---

### 📋 Examples by Context

#### Configuration Summary:
```
✅ GOOD:
Created project configuration with package.json (Next.js 14, React 18, TypeScript 5.x, TailwindCSS 3.x, testing libraries, ESLint), tsconfig.json (strict mode per spec), tailwind.config.ts (all design tokens from design system section), next.config.js, postcss.config.js, and .eslintrc.json.

❌ BAD:
Created project configuration with package.json

(

Next.js 14, React 18, TypeScript 5.x
)

, tsconfig.json
```

#### Task Summary:
```
✅ GOOD:
Implemented three components:
1. TaskInput (user input with validation)
2. TaskList (display and filtering)
3. TaskItem (individual task with actions)

❌ BAD:
Implemented three components
:

TaskInput
(
user input with validation
)

,

TaskList
```

#### Feature Description:
```
✅ GOOD:
The authentication system includes login/logout functionality, JWT token management, role-based access control (RBAC), and session persistence.

❌ BAD:
The authentication system includes login
/
logout functionality
,
JWT token management
,
role-based access control
(
RBAC
)
```

---

### 💻 When to Use Inline Code vs Code Blocks

**Use INLINE code (single backticks `code`):**
- ✅ Variable names: `isCreating`, `error-message`
- ✅ File names: `api.ts`, `LobbyPage.tsx`
- ✅ Function/method names: `response.ok`, `fetchData()`
- ✅ Environment variables: `VITE_BACKEND_URL`
- ✅ Short expressions: `response.ok`, `status === 200`
- ✅ HTML attributes: `aria-label`, `data-testid`
- ✅ CSS classes: `btn-primary`, `flex-col`
- ✅ Technical terms in a sentence

**Use CODE BLOCKS (triple backticks or indentation):**
- ✅ Multi-line code snippets (3+ lines)
- ✅ Complete functions or classes
- ✅ Configuration file contents
- ✅ Shell commands with output

**❌ CRITICAL: NEVER use code blocks in explanations or summaries!**

Code blocks should ONLY be used for actual source code that users need to copy/paste, NOT for explanations.

**❌ BAD Examples:**
```
❌ DON'T DO THIS:
HTTP 상태 코드 검증 (
```
response.ok
```
)

❌ DON'T DO THIS:
에러 상태 UI 표시 (

```error-message```

컴포넌트)

❌ DON'T DO THIS:
로딩 상태 관리 (
```
isCreating
```
,
```
isLoading
```
)
```

**✅ CORRECT Examples:**
```
✅ DO THIS:
HTTP 상태 코드 검증 (`response.ok`)
에러 상태 UI 표시 (`error-message` 컴포넌트)
로딩 상태 관리 (`isCreating`, `isLoading`)
```

**Golden Rule:** If it's ONE WORD or a SHORT PHRASE, use inline backticks ` ` `, NEVER triple backticks ` ``` `.

---

### 🔧 When to Use Line Breaks

**Use line breaks for:**
- ✅ New paragraphs (logical topic changes)
- ✅ Markdown list items (3+ items)
- ✅ Section headers
- ✅ Multi-line code blocks
- ✅ Before/after emphasis blocks

**DON'T use line breaks for:**
- ❌ After opening parentheses `(`
- ❌ Before closing parentheses `)`
- ❌ **Between items inside parentheses** - Keep `(item1, item2, item3)` on one line
- ❌ After commas in inline lists
- ❌ Between related inline items
- ❌ To "decorate" or "emphasize" text
- ❌ **Before or after inline code** - Keep `검증 (response.ok)` on one line

**SPECIAL RULE for Parentheses:**
If content inside `()` is too long (>100 chars), convert to a proper list instead:
```
✅ Features include:
- Full keyboard navigation (Tab, Enter, Escape)
- ARIA attributes (aria-label, aria-expanded, aria-controls, aria-hidden, aria-busy)
- Screen reader support

❌ Features include (
Full keyboard navigation,
ARIA attributes,
Screen reader support
)
```

---

### 💡 Pro Tips

1. **Read your output aloud** - If it sounds choppy, it probably looks choppy
2. **Imagine it as prose** - Would you write it this way in an email?
3. **Group by meaning** - Keep related concepts together
4. **Use Markdown features** - Lists, bold, code spans for structure
5. **One idea per paragraph** - But don't break mid-sentence

---

### ✅ Final Checklist Before Responding

Before sending your response, verify:
- □ No orphan parentheses on separate lines
- □ No orphan commas on separate lines
- □ **All content inside parentheses stays on ONE LINE** (unless using proper list format)
- □ No line breaks after opening `(` or before closing `)`
- □ Inline lists are actually inline
- □ Line breaks only at logical boundaries
- □ Commas inside parentheses have NO line breaks after them
- □ Markdown lists used for 3+ items
- □ **Single backticks for inline code** - No code blocks for single words/variables
- □ **No line breaks before/after inline code** - Keep technical terms in sentences
- □ Text flows naturally when read aloud

**Remember:** Compact, readable text respects the user's time and screen space!

---

### 📝 Korean-Specific Formatting Rules

When responding in Korean:

**✅ GOOD - Inline code in Korean sentences:**
```
`api.ts`는 `VITE_BACKEND_URL`과 `VITE_BACKEND_WSURL`을 사용합니다.
HTTP 상태 코드 검증(`response.ok`)을 추가했습니다.
로딩 상태 관리(`isCreating`, `isLoading`)를 구현했습니다.
```

**❌ BAD - Excessive line breaks:**
```
api.ts
는
VITE_BACKEND_URL
과
VITE_BACKEND_WSURL
을 사용

HTTP 상태 코드 검증 (

response.ok

)

로딩 상태 관리 (

isCreating

,

isLoading

)
```

**Critical Rule for Korean:**
- Korean particles (은/는, 이/가, 을/를) MUST stay attached to the preceding word/code
- ✅ CORRECT: `api.ts`는, `response.ok`을
- ❌ WRONG: Breaking line after code and before particle

