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
   * Is this package's dev/start script a bundler running in --watch mode
   * (a library being rebuilt on change) rather than an actual dev server?
   *
   * Such a package serves no port — it only re-emits build artifacts. The
   * preview server must NOT spawn it as a runnable frontend (regression:
   * `packages/ui` with `dev: "tsup --watch"` was launched as a fake dev
   * server). Exclusion-based by design: only known bundler-watch shapes are
   * excluded, so apps with non-standard dev servers stay included.
   */
  isBundlerWatchScript(devScript: string | undefined): boolean {
    if (!devScript) return false;
    const s = devScript.toLowerCase();
    // `--watch` long form, or a short-flag cluster containing `w` (e.g. `-w`, `-cw`).
    const watch = /(--watch\b|-[a-z]*w[a-z]*\b)/;
    return (
      /\btsup\b/.test(s) ||
      (/\brollup\b/.test(s) && watch.test(s)) ||
      (/\btsc\b/.test(s) && watch.test(s)) ||
      (/\besbuild\b/.test(s) && watch.test(s)) ||
      /\bbuild\b[^&|]*--watch/.test(s)
    );
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

