import * as fs from 'fs';
import * as path from 'path';

/**
 * GitignoreGenerator
 * 
 * Generates .gitignore content based on project type detection.
 * Detects Next.js, Vite, React, Node.js projects and generates appropriate .gitignore.
 */
export class GitignoreGenerator {
  /**
   * Generate .gitignore content for a codebase
   * 
   * @param codebasePath - Path to codebase directory
   * @returns .gitignore content string
   */
  static async generate(codebasePath: string): Promise<string> {
    // Check for package.json to determine project type
    const packageJsonPath = path.join(codebasePath, 'package.json');
    let projectType = 'generic';
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
        
        // Detect Next.js
        if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
          projectType = 'nextjs';
        }
        // Detect Vite
        else if (packageJson.dependencies?.vite || packageJson.devDependencies?.vite) {
          projectType = 'vite';
        }
        // Detect React (CRA or generic)
        else if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
          projectType = 'react';
        }
        // Generic Node.js
        else {
          projectType = 'nodejs';
        }
      } catch {
        projectType = 'generic';
      }
    }
    
    console.log(`[GitignoreGenerator] Detected project type: ${projectType}`);
    
    // Base .gitignore (always include these)
    let gitignoreContent = `# Dependencies
node_modules/
/.pnp
.pnp.js

# Testing
/coverage

# Production builds
/build
/dist

# Misc
.DS_Store
*.pem
*.log
.env.local
.env.development.local
.env.test.local
.env.production.local

# Debug logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Editor directories
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea/
*.swp
*.swo
*~

`;
    
    // Add project-specific ignores
    switch (projectType) {
      case 'nextjs':
        gitignoreContent += `# Next.js
/.next/
/out/
next-env.d.ts

# Vercel
.vercel

`;
        break;
      
      case 'vite':
      case 'react':
        gitignoreContent += `# Vite / React
/dist
/dist-ssr
*.local

`;
        break;
      
      case 'nodejs':
        gitignoreContent += `# Node.js
*.tsbuildinfo

`;
        break;
    }
    
    return gitignoreContent;
  }
}

