/**
 * Next.js Framework - Error Patterns & Compatibility Rules
 * 
 * Platform-neutral: This pattern can be replicated for other frameworks
 * (nuxt.ts, angular.ts, django.ts, etc.)
 */

import { ErrorPattern, ErrorLayer, CompatibilityRule, CompatibilityIssue, Framework } from '../types';

/**
 * Next.js Error Patterns (post-error diagnosis)
 */
export const NEXTJS_PATTERNS: ErrorPattern[] = [
  // ========================================
  // CONFIGURATION LAYER - Image Optimization + Static Export
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /Image Optimization using the default loader is not compatible with.*output.*export/i,
      /Image Optimization.*is not compatible with.*output:\s*['"]export['"]/i,
      /next\/image.*output.*export/i
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'config_incompatibility',
      layer: ErrorLayer.CONFIGURATION,
      message: 'Next.js Image Optimization is incompatible with static export mode',
      rootCause: 'next.config.js has { output: "export" } which enables static HTML export, but this mode does not support the default Image Optimization API which requires a server.',
      suggestedActions: [
        '🔧 FIX: Add images.unoptimized to next.config.js:',
        '',
        '/** @type {import("next").NextConfig} */',
        'const nextConfig = {',
        '  output: "export",',
        '  images: {',
        '    unoptimized: true  // ← ADD THIS LINE',
        '  }',
        '};',
        '',
        'This disables server-side image optimization and uses the images as-is.',
        '',
        '⚠️ Alternative: Remove { output: "export" } if you need Image Optimization',
        '   (but then you need a Node.js server to run the app)'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical'
    })
  },

  // ========================================
  // MODULE RESOLUTION ERRORS
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /Module not found: Can't resolve ['"]([^'"]+)['"]/i,
      /Error: Cannot find module ['"]([^'"]+)['"]/i
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => {
      const moduleName = match[1] || 'unknown';
      const isNodeModule = !moduleName.startsWith('.') && !moduleName.startsWith('@/');
      
      return {
        type: 'import_error',
        layer: isNodeModule ? ErrorLayer.DEPENDENCY : ErrorLayer.CODE,
        message: `Next.js cannot resolve module: ${moduleName}`,
        rootCause: isNodeModule 
          ? `NPM package "${moduleName}" is not installed`
          : `Local file or alias "${moduleName}" does not exist`,
        suggestedActions: isNodeModule ? [
          `Install the missing package: npm install ${moduleName}`,
          'Or if it\'s a dev dependency: npm install -D ' + moduleName,
          'Check if the package name is spelled correctly'
        ] : [
          `Verify the file exists at the import path`,
          'Check tsconfig.json paths/aliases configuration',
          'Ensure file extension is correct (.ts, .tsx, .js, .jsx)'
        ],
        isRetryable: true,
        canLLMFix: true,
        severity: 'major'
      };
    }
  },

  // ========================================
  // APP ROUTER ERRORS
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /You're importing a component that needs (['"]use client['"])/i,
      /useState|useEffect|useRef|useContext.*requires a Client Component/i
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'code_error',
      layer: ErrorLayer.CODE,
      message: 'Client component marker missing in Next.js App Router',
      rootCause: 'Using React hooks (useState, useEffect, etc.) or browser APIs in a Server Component',
      suggestedActions: [
        'Add "use client" directive at the top of the component file:',
        '',
        '"use client";',
        '',
        'import { useState } from "react";',
        '// ... rest of component',
        '',
        'This marks the component as a Client Component that can use hooks and browser APIs.'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  },

  // ========================================
  // BUILD OUTPUT ERRORS
  // ========================================
  {
    layer: ErrorLayer.BUILD,
    patterns: [
      /Error occurred prerendering page/i,
      /Failed to collect page data/i
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'build_error',
      layer: ErrorLayer.BUILD,
      message: 'Next.js static generation failed for a page',
      rootCause: 'An error occurred during build-time page rendering (SSG/ISR)',
      suggestedActions: [
        'Check the page component for errors that only occur during server rendering',
        'Ensure all data fetching functions (getStaticProps, generateStaticParams) are correct',
        'Verify dynamic routes have proper fallback or generateStaticParams',
        'Check for window/document access in server-rendered code'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  }
];

/**
 * Next.js Compatibility Rules (pre-error detection)
 * 
 * These rules analyze config files BEFORE running build/dev
 * to catch known incompatible settings early.
 */
export const NEXTJS_COMPATIBILITY_RULES: CompatibilityRule[] = [
  {
    framework: Framework.NEXTJS,
    name: 'image-optimization-static-export',
    description: 'Check Image Optimization compatibility with static export',
    check: (config: any, configFile: string): CompatibilityIssue | null => {
      // Check if output is 'export' and images.unoptimized is not set
      const hasStaticExport = config.output === 'export';
      const hasUnoptimizedImages = config.images?.unoptimized === true;
      
      if (hasStaticExport && !hasUnoptimizedImages) {
        return {
          framework: Framework.NEXTJS,
          severity: 'critical',
          issue: 'Image Optimization is incompatible with static export',
          configFile,
          conflictingSettings: ['output: "export"', 'images.unoptimized: undefined'],
          fix: 'Add { images: { unoptimized: true } } to next.config.js',
          documentation: 'https://nextjs.org/docs/messages/export-image-api'
        };
      }
      
      return null;
    }
  },
  {
    framework: Framework.NEXTJS,
    name: 'middleware-static-export',
    description: 'Check Middleware compatibility with static export',
    check: (config: any, configFile: string): CompatibilityIssue | null => {
      // This would need file system access to check for middleware.ts
      // For now, just document the pattern
      if (config.output === 'export' && config._hasMiddleware) {
        return {
          framework: Framework.NEXTJS,
          severity: 'critical',
          issue: 'Middleware is not supported with static export',
          configFile,
          conflictingSettings: ['output: "export"', 'middleware.ts exists'],
          fix: 'Remove middleware.ts or remove { output: "export" } from next.config.js',
          documentation: 'https://nextjs.org/docs/app/building-your-application/deploying/static-exports'
        };
      }
      
      return null;
    }
  },
  {
    framework: Framework.NEXTJS,
    name: 'api-routes-static-export',
    description: 'Check API Routes compatibility with static export',
    check: (config: any, configFile: string): CompatibilityIssue | null => {
      if (config.output === 'export' && config._hasApiRoutes) {
        return {
          framework: Framework.NEXTJS,
          severity: 'major',
          issue: 'API Routes are not supported with static export',
          configFile,
          conflictingSettings: ['output: "export"', 'pages/api/* or app/api/* exists'],
          fix: 'Remove API routes or remove { output: "export" } from next.config.js. For static sites, use external API services.',
          documentation: 'https://nextjs.org/docs/app/building-your-application/deploying/static-exports'
        };
      }
      
      return null;
    }
  }
];
