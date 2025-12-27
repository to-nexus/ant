import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';
import { PackageDetector } from '../detectors/PackageDetector';
import { ReactValidator } from './ReactValidator';
import { VueValidator } from './VueValidator';

/**
 * ProjectValidator
 * 
 * Validates dev server setup for frontend projects
 */
export class ProjectValidator {
  private packageDetector: PackageDetector;
  private reactValidator: ReactValidator;
  private vueValidator: VueValidator;
  
  constructor() {
    this.packageDetector = new PackageDetector();
    this.reactValidator = new ReactValidator();
    this.vueValidator = new VueValidator();
  }
  
  /**
   * Validate dev server setup for frontend projects
   * Checks if basename configuration is present in router setup
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    try {
      // 1. Check if it's a frontend project
      const packageJsonPath = path.join(codebasePath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return { valid: true }; // No package.json = not a frontend project
      }
      
      const packageJson = JSON.parse(
        await fs.promises.readFile(packageJsonPath, 'utf-8')
      );
      
      if (!this.packageDetector.isFrontendPackage(packageJson)) {
        return { valid: true }; // Not a frontend project
      }
      
      const framework = this.packageDetector.detectFrameworkType(packageJson);
      
      // 2. Framework-specific validation
      switch (framework) {
        case 'react':
          return await this.reactValidator.validate(codebasePath);
        case 'vue':
          return await this.vueValidator.validate(codebasePath);
        case 'next':
        case 'nuxt':
          return { valid: true, framework }; // Meta-frameworks handle this automatically
        default:
          // Unknown framework - skip validation
          return { valid: true, framework: 'unknown' };
      }
    } catch (error: any) {
      console.error('[ProjectValidator] Validation error:', error);
      return { valid: true }; // Don't block on validation errors
    }
  }
}

