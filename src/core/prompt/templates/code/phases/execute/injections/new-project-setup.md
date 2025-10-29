━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 NEW PROJECT INITIALIZATION - STEP 1: SETUP FILES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  CRITICAL: This is a NEW PROJECT with no existing code.

EXECUTION SEQUENCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST follow this order:

**STEP 1: Generate Project Configuration Files (Do this FIRST)**
   └─ These files define HOW the project works
   
**STEP 2: Generate Application Code**
   └─ These files define WHAT the project does

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: MANDATORY CONFIGURATION FILES (HIGHEST PRIORITY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Output these files BEFORE any application code:

1. **package.json** - HIGHEST PRIORITY ⭐
   ┌─────────────────────────────────────────────────────────────────────┐
   │ FIND IN DESIGN DOCUMENT:                                             │
   │ • "Technology Stack" section → lists ALL packages                    │
   │ • "Dependencies" table → lists versions                              │
   │ • "Build Tool" section → determines build tool (Vite/Next/etc)      │
   │                                                                       │
   │ EXTRACT AND ADD:                                                     │
   │ • Runtime deps: React, Zustand, Axios, etc. (from design doc)       │
   │ • Dev deps: TypeScript, Vite/Next, ESLint, etc. (from design doc)   │
   │ • Scripts: dev, build, start, lint (based on build tool)            │
   │                                                                       │
   │ EXAMPLE (if design says "Vite + React"):                            │
   │ {                                                                    │
   │   "scripts": {                                                       │
   │     "dev": "vite",                                                   │
   │     "build": "vite build",                                           │
   │     "preview": "vite preview"                                        │
   │   },                                                                 │
   │   "dependencies": { "react": "^18.2.0", ... },                      │
   │   "devDependencies": { "vite": "^5.0.0", "typescript": "^5.3.0" }   │
   │ }                                                                    │
   └─────────────────────────────────────────────────────────────────────┘

2. **tsconfig.json** (if TypeScript)
   → Based on "Language" section in design doc
   → Enable strict mode, configure paths from design doc

3. **Build Tool Config** (based on "Build Tool" in design)
   → vite.config.ts (if Vite)
   → next.config.js (if Next.js)
   → Include plugins from design doc (React plugin, etc.)

4. **Style Config** (based on "Styling" section in design)
   → tailwind.config.js (if Tailwind CSS mentioned)
   → postcss.config.js (if needed)

5. **.gitignore**
   → node_modules, dist, build, .env

6. **README.md**
   → Project name, setup instructions, npm install, npm run dev

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VERIFICATION CHECKLIST (Check BEFORE outputting):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ I read the DESIGN DOCUMENT's "Technology Stack" section completely
□ I extracted ALL dependencies listed (React, Zustand, Axios, etc.)
□ package.json includes EVERY package from design document
□ package.json scripts match the build tool (Vite → vite, Next → next)
□ tsconfig.json is generated (if TypeScript project)
□ Build config file matches build tool from design doc
□ Style config files match styling solution from design doc

WHAT HAPPENS AFTER YOU GENERATE THESE FILES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. User saves your output
2. System runs: `npm install` (or `pnpm install`)
   └─ Installs ALL packages from package.json
3. User can now run: `npm run dev`
   └─ Starts development server

IF YOU SKIP package.json → npm install FAILS → Project is BROKEN

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOW: Output configuration files FIRST, then application code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

