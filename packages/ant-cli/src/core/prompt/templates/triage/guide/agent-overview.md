# Ant Agents Overview

Ant is an AI-powered development assistant that helps you design and implement software projects.

## Core Principles

### Project Agnostic
Ant works with **any project type**:
- Frontend (React, Vue, Angular, Svelte, etc.)
- Backend (Node.js, Python, Go, Java, etc.)
- Fullstack applications
- Mobile (React Native, Flutter, etc.)
- Monorepo structures

Ant does **not** require special configuration for different project types. It adapts based on:
1. Your existing codebase structure (via Learn Job)
2. Your design documents
3. Your chat instructions

### Input-Driven
Ant's output quality depends on input quality:
- **Better inputs** → Better outputs
- Screen captures → Accurate UI implementation
- Detailed PRD → Comprehensive architecture
- Clear chat instructions → Precise modifications

### Iterative Development
Ant is designed for conversation-based iteration:
- Start with rough requirements
- Refine through dialogue
- Review and adjust outputs

## Available Agents

### Architect Agent

The main agent for software development tasks.

**Jobs:**

| Job | Purpose | Best For |
|-----|---------|----------|
| **design** | Creates specifications | New features, complex UI |
| **code** | Generates implementation | Building, modifying code |
| **learn** | Indexes codebase | Existing projects |

### Language & Framework Support

Ant supports any language/framework that can be expressed in text:
- **Frontend**: React, Vue, Angular, Svelte, Next.js, Nuxt, etc.
- **Backend**: Express, FastAPI, Django, Spring, Go, etc.
- **Styling**: Tailwind, CSS Modules, Styled Components, etc.
- **Testing**: Jest, Vitest, Pytest, etc.

The quality of generation depends on:
1. Model's training data coverage
2. Your codebase context (Learn Job)
3. Specificity of your instructions

### Project Structure Handling

**Single Project:**
```
my-app/
├── inputs/
├── outputs/
└── src/
```

**Monorepo:**
```
monorepo/
├── apps/
│   ├── web/          ← Run Ant here
│   └── mobile/       ← Or here
└── packages/
```

For monorepos, run Ant at the specific app/package level, not root.

## How Ant Works

1. **Input**: You provide requirements (PRD, screen captures, or chat instructions)
2. **Context**: Ant uses your codebase (if indexed) for consistency
3. **Design**: Ant creates detailed design documents
4. **Code**: Ant generates implementation matching your stack
5. **Iterate**: Refine through conversation

## Limitations

- **No runtime execution**: Ant generates code, doesn't run it
- **No external API calls**: Can't fetch live data
- **Context window**: Very large files may need chunking
- **Model knowledge cutoff**: Latest frameworks may have limited coverage
