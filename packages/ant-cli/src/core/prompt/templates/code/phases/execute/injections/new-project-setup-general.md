━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 NEW PROJECT INITIALIZATION - LANGUAGE-AGNOSTIC GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  CRITICAL: This is a NEW PROJECT with no existing code.

UNIVERSAL PRINCIPLES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST follow this order for ANY language:

**STEP 1: Generate Project Configuration Files (Do this FIRST)**
   └─ These files define HOW the project works
   
**STEP 2: Generate Application Code**
   └─ These files define WHAT the project does

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: MANDATORY CONFIGURATION FILES (HIGHEST PRIORITY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Output these files BEFORE any application code:

1. **Dependency/Package File** - HIGHEST PRIORITY ⭐
   Language-specific examples:
   • TypeScript/JavaScript: package.json
   • Go: go.mod
   • Python: requirements.txt, pyproject.toml, Pipfile
   • Rust: Cargo.toml
   • Java: pom.xml, build.gradle
   
   ┌─────────────────────────────────────────────────────────────────────┐
   │ FIND IN DESIGN DOCUMENT:                                             │
   │ • "Technology Stack" section → lists ALL packages/dependencies       │
   │ • "Dependencies" table → lists versions                              │
   │ • "Build Tool" section → determines build tool                       │
   │                                                                       │
   │ EXTRACT AND ADD:                                                     │
   │ • Runtime dependencies (from design doc)                             │
   │ • Development dependencies (from design doc)                         │
   │ • Scripts/commands: dev, build, start, lint (based on build tool)   │
   └─────────────────────────────────────────────────────────────────────┘

2. **Language Configuration File**
   Language-specific examples:
   • TypeScript: tsconfig.json
   • Go: go.mod (already covered above)
   • Python: pyproject.toml, setup.py
   • Rust: Cargo.toml (already covered above)
   • Java: No separate config needed (pom.xml/build.gradle handles it)
   
   **See language-specific guidelines below for CRITICAL settings**

3. **Build Tool Config** (based on "Build Tool" in design)
   Examples:
   • TypeScript/JS: vite.config.ts, webpack.config.js, next.config.js
   • Go: Makefile (optional)
   • Python: setup.py, pyproject.toml
   • Rust: Cargo.toml (already covered)
   • Java: pom.xml, build.gradle (already covered)

4. **Style/Formatting Config** (if applicable)
   Examples:
   • TypeScript/JS: tailwind.config.js, postcss.config.js, .eslintrc
   • Go: .golangci.yml
   • Python: .pylintrc, pyproject.toml [tool.black]
   • Rust: rustfmt.toml

5. **.gitignore**
   Language-specific patterns:
   • TypeScript/JS: node_modules, dist, build, .env
   • Go: bin/, vendor/, *.exe
   • Python: __pycache__/, *.pyc, venv/, .env
   • Rust: target/, Cargo.lock (for apps)
   • Java: target/, *.class, .idea/

6. **README.md**
   • Project name, setup instructions
   • How to install dependencies
   • How to run (dev mode, build, test)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VERIFICATION CHECKLIST (Check BEFORE outputting):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ I read the DESIGN DOCUMENT's "Technology Stack" section completely
□ I extracted ALL dependencies listed
□ Dependency file includes EVERY package from design document
□ Scripts/commands match the build tool
□ Language configuration file is generated (if applicable)
□ Build config file matches build tool from design doc
□ Style config files match styling solution from design doc

WHAT HAPPENS AFTER YOU GENERATE THESE FILES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. User saves your output
2. System runs: `npm install` / `go mod download` / `pip install` / `cargo build`
   └─ Installs ALL packages from dependency file
3. User can now run: dev/build/test commands
   └─ Starts development

IF YOU SKIP dependency file → installation FAILS → Project is BROKEN

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOW: Output configuration files FIRST, then application code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


