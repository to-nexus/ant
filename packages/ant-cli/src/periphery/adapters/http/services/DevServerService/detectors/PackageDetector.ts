import { FrameworkType } from '../types';

/**
 * PackageDetector
 * 
 * Detects package types (frontend, backend) and frameworks
 */
export class PackageDetector {
  /**
   * Detect if package is a frontend project
   */
  isFrontendPackage(packageJson: any): boolean {
    const deps = { 
      ...packageJson.dependencies, 
      ...packageJson.devDependencies 
    };
    
    // Frontend frameworks
    const frontendFrameworks = [
      'react', 'react-dom',
      'vue', '@vue/runtime-core',
      'svelte',
      '@angular/core',
      'solid-js'
    ];
    
    // Build tools (strong indicators)
    const frontendBuildTools = [
      'vite', '@vitejs/plugin-react', '@vitejs/plugin-vue',
      'next', 'nuxt',
      'webpack', '@angular/cli',
      'parcel-bundler', 'parcel',
      '@remix-run/dev',
      'astro'
    ];
    
    const hasFrontend = frontendFrameworks.some(fw => deps[fw]) || 
                       frontendBuildTools.some(tool => deps[tool]);
    
    // Check dev script
    const devScript = packageJson.scripts?.dev || packageJson.scripts?.start || '';
    const isFrontendScript = devScript.includes('vite') || 
                            devScript.includes('next') || 
                            devScript.includes('webpack') ||
                            devScript.includes('react-scripts') ||
                            devScript.includes('vue-cli-service') ||
                            devScript.includes('ng serve') ||
                            devScript.includes('astro');
    
    return hasFrontend || isFrontendScript;
  }
  
  /**
   * Detect if package is a backend project
   */
  isBackendPackage(packageJson: any): boolean {
    const deps = { 
      ...packageJson.dependencies, 
      ...packageJson.devDependencies 
    };
    
    // Backend frameworks
    const backendFrameworks = [
      'express', 'koa', 'fastify', 'hapi',
      '@nestjs/core', '@nestjs/platform-express',
      'ws', 'socket.io'
    ];
    
    const hasBackend = backendFrameworks.some(fw => deps[fw]);
    
    // Check dev script
    const devScript = packageJson.scripts?.dev || '';
    const isBackendScript = devScript.includes('tsx') || 
                           devScript.includes('nodemon') || 
                           devScript.includes('ts-node') ||
                           devScript.includes('nest start');
    
    return hasBackend || isBackendScript;
  }
  
  /**
   * Detect framework type from package.json
   */
  detectFrameworkType(packageJson: any): FrameworkType {
    const deps = { 
      ...packageJson.dependencies, 
      ...packageJson.devDependencies 
    };
    
    if (deps.next) return 'next';
    if (deps.nuxt) return 'nuxt';
    if (deps.react || deps['react-dom']) return 'react';
    if (deps.vue || deps['@vue/runtime-core']) return 'vue';
    if (deps.svelte) return 'svelte';
    
    return 'unknown';
  }
}

