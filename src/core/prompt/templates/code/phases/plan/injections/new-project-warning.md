━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 NEW PROJECT - Planning Project Initialization
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  This is a NEW PROJECT with no existing codebase.

YOUR PLAN STRUCTURE MUST BE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**PHASE 1: Project Setup (Configuration Files)**
   Step 1: Extract technology stack from DESIGN DOCUMENT
   Step 2: Generate dependency file
      • TypeScript/JavaScript: package.json
      • Go: go.mod
      • Python: requirements.txt or pyproject.toml
      • Rust: Cargo.toml
   Step 3: Generate language configuration (if needed)
      • TypeScript: tsconfig.json
      • Python: pyproject.toml or setup.py
      • Go: N/A (go.mod covers this)
   Step 4: Generate build tool config
      • Vite: vite.config.ts
      • Next.js: next.config.js
      • Go: Makefile (optional)
   Step 5: Generate style/lint config (if applicable)
      • TypeScript: tailwind.config.js, .eslintrc
      • Go: .golangci.yml
      • Python: .pylintrc, pyproject.toml [tool.black]
   Step 6: Generate .gitignore and README.md

**PHASE 2: Application Code**
   Step 7: Generate source code structure
   Step 8: Generate components, services, stores, etc.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL: ANALYZE DESIGN DOCUMENT FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before planning, READ these sections in DESIGN DOCUMENT:

1. **"Technology Stack" / "Dependencies"**
   → Lists all packages: React, Zustand, Axios, etc.
   → Versions: React 18.x, TypeScript 5.x, etc.

2. **"Build Tool" / "Development Environment"**
   → Vite, Next.js, or Webpack
   → Determines which config file to generate

3. **"Styling Solution"**
   → Tailwind CSS, CSS Modules, Styled Components
   → Determines style config files

4. **"Project Structure"**
   → Directory layout
   → File organization

YOUR PLAN MUST START WITH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Example for TypeScript project:
"Step 1: Generate package.json
- Extract dependencies from design: [list them]
- Add scripts: dev, build, start

Step 2: Generate tsconfig.json
- Configure paths, strict mode

Step 3: Generate vite.config.ts..."

Example for Go project:
"Step 1: Generate go.mod
- Set module path
- Add required dependencies

Step 2: Create project structure
- cmd/, internal/, pkg/ directories

Step 3: Generate Makefile..."

Example for Python project:
"Step 1: Generate pyproject.toml
- Add dependencies
- Configure tools (black, pytest)

Step 2: Create project structure
- src/, tests/ directories

Step 3: Setup virtual environment..."

WHY THIS MATTERS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After code generation, the system will:
1. Save all files
2. Install dependencies:
   • TypeScript/JS: npm install (from package.json)
   • Go: go mod download (from go.mod)
   • Python: pip install (from requirements.txt/pyproject.toml)
3. User runs dev command to start the project

If dependency file is missing → Install FAILS → Project is BROKEN

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

