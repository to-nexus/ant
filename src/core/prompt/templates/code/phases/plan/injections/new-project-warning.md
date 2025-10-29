━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 NEW PROJECT - Planning Project Initialization
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  This is a NEW PROJECT with no existing codebase.

YOUR PLAN STRUCTURE MUST BE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**PHASE 1: Project Setup (Configuration Files)**
   Step 1: Extract technology stack from DESIGN DOCUMENT
   Step 2: Generate package.json with ALL dependencies
   Step 3: Generate build tool config (vite.config.ts / next.config.js)
   Step 4: Generate TypeScript config (if applicable)
   Step 5: Generate style config (tailwind.config.js, etc.)
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

"Step 1: Generate package.json
- Extract dependencies from design: [list them]
- Add scripts based on build tool: [dev, build, start]

Step 2: Generate tsconfig.json (if TypeScript)
- Configure paths, strict mode

..."

WHY THIS MATTERS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After code generation, the system will:
1. Save all files
2. Run: npm install (installs packages from package.json)
3. User runs: npm run dev (starts the project)

If package.json is missing → npm install FAILS → Project is BROKEN

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

