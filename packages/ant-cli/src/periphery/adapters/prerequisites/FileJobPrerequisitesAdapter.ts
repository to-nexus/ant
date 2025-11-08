import * as fs from 'fs';
import * as path from 'path';
import {
  JobPrerequisitesPort,
  JobType,
  RequiredMaterial,
  PrerequisitesValidationResult,
} from '../../../core/ports/jobPrerequisites';

/**
 * File-based Job Prerequisites Adapter
 * 
 * Validates job prerequisites by checking filesystem for required files.
 * 
 * Job Requirements:
 * - Design Job: Requires directive AND PRD
 * - Code Job: Requires directive AND system design document
 * - Learn Job: Requires directive only
 */
export class FileJobPrerequisitesAdapter implements JobPrerequisitesPort {
  private readonly workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Get required materials for each job type
   */
  getRequiredMaterials(jobType: JobType): RequiredMaterial[] {
    switch (jobType) {
      case 'design':
        return [
          {
            name: 'Design Directive',
            path: 'inputs/directives/design/directive.md',
            description: 'Specific instructions or requirements for the design phase',
            mustHaveContent: true,
          },
          {
            name: 'PRD (Product Requirements Document)',
            path: 'inputs/sources/prd.md',
            description: 'Product requirements and specifications',
            mustHaveContent: true,
          },
        ];
      
      case 'code':
        return [
          {
            name: 'Code Directive',
            path: 'inputs/directives/code/directive.md',
            description: 'Specific instructions for code generation',
            mustHaveContent: true,
          },
          {
            name: 'System Design Document',
            path: 'outputs/design',  // Directory - checks for any .md files
            description: 'System design document from the design phase',
            mustHaveContent: true,
          },
        ];
      
      case 'learn':
        return [
          {
            name: 'Learn Directive',
            path: 'inputs/directives/learn/directive.md',
            description: 'Questions or topics to learn about',
            mustHaveContent: true,
          },
        ];
      
      default:
        return [];
    }
  }
  
  /**
   * Validate prerequisites for a job
   * 
   * For design and code jobs: At least ONE of the required materials must be present
   * For learn job: The directive must be present
   */
  async validate(
    projectId: string,
    featureName: string,
    jobType: JobType
  ): Promise<PrerequisitesValidationResult> {
    const requiredMaterials = this.getRequiredMaterials(jobType);
    const missingMaterials: RequiredMaterial[] = [];
    const presentMaterials: RequiredMaterial[] = [];
    
    for (const material of requiredMaterials) {
      const fullPath = path.join(
        this.workspaceRoot,
        projectId,
        featureName,
        material.path
      );
      
      const isMissing = await this.isMaterialMissing(fullPath, material);
      if (isMissing) {
        missingMaterials.push(material);
      } else {
        presentMaterials.push(material);
      }
    }
    
    // ✅ For design and code jobs: At least one material must be present
    // ✅ For learn job: The only material must be present
    if (jobType === 'design' || jobType === 'code') {
      // At least one material present = valid
      if (presentMaterials.length > 0) {
        return {
          isValid: true,
          missingMaterials: [],
        };
      }
      
      // All materials missing = invalid
      const materialList = requiredMaterials
        .map(m => `  • ${m.name}: ${m.description}`)
        .join('\n');
      
      const errorMessage = `Cannot start ${jobType} job. At least one of the following materials is required:\n\n${materialList}\n\nPlease provide at least one of these materials before starting the job.`;
      
      return {
        isValid: false,
        missingMaterials: requiredMaterials,
        errorMessage,
      };
    } else {
      // For learn job: all materials must be present
      if (missingMaterials.length === 0) {
        return {
          isValid: true,
          missingMaterials: [],
        };
      }
      
      const materialList = missingMaterials
        .map(m => `  • ${m.name}: ${m.description}`)
        .join('\n');
      
      const errorMessage = `Cannot start ${jobType} job. The following required material is missing:\n\n${materialList}\n\nPlease provide this material before starting the job.`;
      
      return {
        isValid: false,
        missingMaterials,
        errorMessage,
      };
    }
  }
  
  /**
   * Check if a material is missing or insufficient
   */
  private async isMaterialMissing(
    fullPath: string,
    material: RequiredMaterial
  ): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(fullPath);
      
      // If it's a directory (e.g., outputs/design), check for .md files
      if (stats.isDirectory()) {
        const files = await fs.promises.readdir(fullPath);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        
        if (mdFiles.length === 0) {
          return true; // No design documents found
        }
        
        // Check if at least one .md file has content
        if (material.mustHaveContent) {
          for (const mdFile of mdFiles) {
            const content = await fs.promises.readFile(
              path.join(fullPath, mdFile),
              'utf-8'
            );
            if (this.hasContent(content)) {
              return false; // Found a file with content
            }
          }
          return true; // All files are empty
        }
        
        return false; // Files exist
      }
      
      // If it's a file, check if it exists and has content
      if (material.mustHaveContent) {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        return !this.hasContent(content);
      }
      
      return false; // File exists
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return true; // File/directory doesn't exist
      }
      throw error; // Other errors should be thrown
    }
  }
  
  /**
   * Check if content is meaningful (not just whitespace or template comments)
   */
  private hasContent(content: string): boolean {
    // Remove common template patterns and placeholder text
    const cleaned = content
      .replace(/^#\s+.*\n*/gm, '') // Remove markdown headers
      .replace(/<!--.*?-->/gs, '') // Remove HTML comments
      .replace(/Describe\s+.*\s+here\.?/gi, '') // Remove "Describe ... here" placeholders
      .replace(/Add\s+.*\s+here\.?/gi, '') // Remove "Add ... here" placeholders
      .replace(/\(add\s+.*\)/gi, '') // Remove "(add ...)" placeholders
      .replace(/TODO:.*$/gm, '') // Remove TODO comments
      .replace(/FIXME:.*$/gm, '') // Remove FIXME comments
      .replace(/^\s*[-*]\s*$/gm, '') // Remove empty bullet points
      .replace(/^\s*$/gm, '') // Remove empty lines
      .trim();
    
    // Content is meaningful if it has at least 20 characters after cleaning
    // This ensures we have actual content, not just a few words
    return cleaned.length >= 20;
  }
}

